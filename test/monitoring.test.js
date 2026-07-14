const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vimage-test-'));
process.env.DB_PATH = path.join(testDirectory, 'vimage.db');

const express = require('express');
const db = require('../src/db/init');
const { getLogs, getStats, logRequest } = require('../src/db/logger');
const apiRouter = require('../src/routes/api');
const imageRouter = require('../src/routes/image');

function createLog(overrides = {}) {
  return {
    original_url: 'vimage_001_test.jpg',
    query_term: 'test',
    retry_count: 0,
    retry_1_term: null,
    retry_2_term: null,
    retry_3_term: null,
    success: true,
    final_url: 'https://images.unsplash.com/photo-test',
    source: 'unsplash',
    response_time: 20,
    error_message: null,
    from_cache: false,
    ...overrides
  };
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

test('monitoring metrics and log filters exclude malformed requests', async t => {
  t.after(() => {
    db.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
  });

  logRequest(createLog());
  logRequest(createLog({
    original_url: 'vimage_002_cached.jpg',
    query_term: 'cached',
    source: 'cache',
    response_time: 0,
    from_cache: true
  }));
  logRequest(createLog({
    original_url: 'vimage_003_failed.jpg',
    query_term: 'failed',
    success: false,
    source: 'picsum-all-failed',
    response_time: 100,
    from_cache: false
  }));

  // Simulate a historical row written before malformed requests were classified separately.
  logRequest(createLog({
    original_url: 'app_staging.zip',
    query_term: null,
    success: false,
    source: 'picsum-error',
    final_url: 'https://picsum.photos/1200/800',
    response_time: 1,
    error_message: 'Invalid URL format',
    from_cache: false
  }));

  const stats = getStats();
  assert.equal(stats.totalLoggedRequests, 4);
  assert.equal(stats.imageRequests, 3);
  assert.equal(stats.errorRequests, 1);
  assert.equal(stats.successCount, 2);
  assert.equal(stats.successRate, 66.7);
  assert.equal(stats.cacheHitCount, 1);
  assert.equal(stats.cacheMissCount, 2);
  assert.equal(stats.cacheHitRate, 33.3);
  assert.equal(stats.avgResponseTime, 40);
  assert.equal(stats.sourcesDistribution['picsum-error'], undefined);

  const imageLogs = getLogs(1, 20, 'image');
  const errorLogs = getLogs(1, 20, 'error');
  const allLogs = getLogs(1, 20, 'all');
  assert.equal(imageLogs.total, 3);
  assert.equal(errorLogs.total, 1);
  assert.equal(allLogs.total, imageLogs.total + errorLogs.total);
  assert.equal(errorLogs.data[0].source, null);
  assert.equal(errorLogs.data[0].final_url, null);
  assert.equal(imageLogs.data.find(log => log.source === 'cache').response_time, 0);

  const app = express();
  app.use('/api', apiRouter);
  app.use('/', imageRouter);
  const server = await listen(app);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const invalidResponse = await fetch(`${baseUrl}/app_backup.zip`, { redirect: 'manual' });
  assert.equal(invalidResponse.status, 404);
  assert.equal(invalidResponse.headers.get('location'), null);

  const statsAfterInvalidRequest = getStats();
  assert.equal(statsAfterInvalidRequest.imageRequests, stats.imageRequests);
  assert.equal(statsAfterInvalidRequest.errorRequests, stats.errorRequests + 1);
  assert.equal(statsAfterInvalidRequest.successRate, stats.successRate);
  assert.equal(statsAfterInvalidRequest.cacheHitRate, stats.cacheHitRate);
  assert.equal(statsAfterInvalidRequest.avgResponseTime, stats.avgResponseTime);

  const latestError = getLogs(1, 1, 'error').data[0];
  assert.equal(latestError.original_url, 'app_backup.zip');
  assert.equal(latestError.query_term, null);
  assert.equal(latestError.source, null);
  assert.equal(latestError.final_url, null);

  const filteredResponse = await fetch(`${baseUrl}/api/logs?type=error&page=1&limit=1`);
  assert.equal(filteredResponse.status, 200);
  const filteredBody = await filteredResponse.json();
  assert.equal(filteredBody.type, 'error');
  assert.equal(filteredBody.total, 2);
  assert.equal(filteredBody.data.length, 1);
  assert.equal(filteredBody.data[0].source, null);

  const invalidTypeResponse = await fetch(`${baseUrl}/api/logs?type=invalid`);
  assert.equal(invalidTypeResponse.status, 400);

  const excessiveLimitResponse = await fetch(`${baseUrl}/api/logs?limit=101`);
  assert.equal(excessiveLimitResponse.status, 400);
});
