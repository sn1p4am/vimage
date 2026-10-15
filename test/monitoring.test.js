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
const imageRouter = require('../src/routes/image').createImageRouter();

function createLog(overrides = {}) {
  return {
    original_url: '/api/images/resolve',
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

test('monitoring reports search outcomes without counting image delivery or unknown routes', async context => {
  context.after(() => {
    db.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
  });

  logRequest(createLog());
  logRequest(createLog({
    query_term: 'cached',
    source: 'cache',
    response_time: 0,
    from_cache: true
  }));
  logRequest(createLog({
    query_term: 'failed',
    success: false,
    source: 'search-failed',
    final_url: null,
    response_time: 100,
    from_cache: false
  }));

  const stats = getStats();
  assert.equal(stats.imageRequests, 3);
  assert.equal(stats.successCount, 2);
  assert.equal(stats.successRate, 66.7);
  assert.equal(stats.cacheHitCount, 1);
  assert.equal(stats.cacheMissCount, 2);
  assert.equal(stats.cacheHitRate, 33.3);
  assert.equal(stats.avgResponseTime, 40);
  assert.equal(stats.sourcesDistribution['search-failed'], 1);

  const imageLogs = getLogs(1, 20);
  assert.equal(imageLogs.total, 3);
  assert.equal(getLogs(1, 20, { status: 'failed' }).data[0].final_url, null);
  assert.equal(imageLogs.data.find(log => log.source === 'cache').response_time, 0);

  const app = express();
  app.use('/api', apiRouter);
  app.use('/', imageRouter);
  const server = await listen(app);
  context.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  for (const route of ['/unknown.jpg', '/nested/unknown.jpg', '/i/unknown']) {
    const invalidResponse = await fetch(baseUrl + route, { redirect: 'manual' });
    assert.equal(invalidResponse.status, 404);
    assert.equal(invalidResponse.headers.get('location'), null);
  }
  assert.deepEqual(getStats(), stats);

  const filteredResponse = await fetch(`${baseUrl}/api/logs?status=failed&page=1&limit=1`);
  assert.equal(filteredResponse.status, 200);
  const filteredBody = await filteredResponse.json();
  assert.equal(filteredBody.total, 1);
  assert.equal(filteredBody.data.length, 1);
  assert.equal(filteredBody.data[0].source, 'search-failed');

  const invalidParameterResponse = await fetch(`${baseUrl}/api/logs?unknown=value`);
  assert.equal(invalidParameterResponse.status, 400);

  const excessiveLimitResponse = await fetch(`${baseUrl}/api/logs?limit=101`);
  assert.equal(excessiveLimitResponse.status, 400);
});
