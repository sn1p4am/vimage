const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vimage-match-stats-'));
process.env.DB_PATH = path.join(testDirectory, 'vimage.db');

const db = require('../src/db/init');
const { getStats, logRequest } = require('../src/db/logger');

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

test('Unsplash match rates and response times exclude non-matching requests', t => {
  t.after(() => {
    db.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
  });

  const emptyStats = getStats();
  assert.equal(emptyStats.unsplashMatchCount, 0);
  assert.equal(emptyStats.directUnsplashRate, 0);
  assert.equal(emptyStats.rewrittenUnsplashRate, 0);
  assert.equal(emptyStats.directUnsplashAvgResponseTime, null);
  assert.equal(emptyStats.rewrittenUnsplashAvgResponseTime, null);

  logRequest(createLog());
  logRequest(createLog());
  logRequest(createLog());
  logRequest(createLog({
    retry_count: 1,
    retry_1_term: 'rewritten',
    source: 'unsplash-retry-1',
    response_time: 120
  }));
  logRequest(createLog({
    source: 'cache',
    from_cache: true,
    response_time: 1
  }));
  logRequest(createLog({
    success: false,
    source: 'search-failed',
    final_url: null,
    response_time: 900
  }));
  logRequest(createLog({
    retry_count: 2,
    source: 'search-failed',
    final_url: null,
    success: false,
    response_time: 600
  }));
  for (let index = 0; index < 12; index += 1) {
    logRequest(createLog());
  }
  logRequest(createLog({
    retry_count: 3,
    retry_3_term: 'rewritten again',
    source: 'unsplash-retry-3',
    response_time: 80
  }));
  logRequest(createLog({
    response_time: null
  }));

  const stats = getStats();

  assert.equal(stats.directUnsplashCount, 16);
  assert.equal(stats.rewrittenUnsplashCount, 2);
  assert.equal(stats.unsplashMatchCount, 18);
  assert.equal(stats.directUnsplashRate, 88.9);
  assert.equal(stats.rewrittenUnsplashRate, 11.1);
  assert.equal(stats.directUnsplashAvgResponseTime, 20);
  assert.equal(stats.rewrittenUnsplashAvgResponseTime, 100);
  assert.equal(stats.cacheHitCount, 1);
  assert.equal(stats.imageRequests, 21);
});
