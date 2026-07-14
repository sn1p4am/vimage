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

test('Unsplash match rates exclude cache, fallback, and failed searches', t => {
  t.after(() => {
    db.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
  });

  const emptyStats = getStats();
  assert.equal(emptyStats.unsplashMatchCount, 0);
  assert.equal(emptyStats.directUnsplashRate, 0);
  assert.equal(emptyStats.rewrittenUnsplashRate, 0);

  logRequest(createLog());
  logRequest(createLog({ original_url: 'vimage_002_direct.jpg' }));
  logRequest(createLog({ original_url: 'vimage_003_direct.jpg' }));
  logRequest(createLog({
    original_url: 'vimage_004_rewritten.jpg',
    retry_count: 1,
    retry_1_term: 'rewritten',
    source: 'unsplash-retry-1'
  }));
  logRequest(createLog({
    original_url: 'vimage_005_cached.jpg',
    source: 'cache',
    from_cache: true
  }));
  logRequest(createLog({
    original_url: 'vimage_006_fallback.jpg',
    success: false,
    source: 'picsum-all-failed'
  }));
  logRequest(createLog({
    original_url: 'vimage_007_failed-rewrite.jpg',
    retry_count: 2,
    source: 'unsplash-retry-2',
    success: false
  }));
  for (let index = 0; index < 12; index += 1) {
    logRequest(createLog({ original_url: `vimage_${String(index + 8).padStart(3, '0')}_direct.jpg` }));
  }
  logRequest(createLog({
    original_url: 'invalid.zip',
    query_term: null,
    success: false,
    final_url: null,
    source: null
  }));

  const stats = getStats();

  assert.equal(stats.directUnsplashCount, 15);
  assert.equal(stats.rewrittenUnsplashCount, 1);
  assert.equal(stats.unsplashMatchCount, 16);
  assert.equal(stats.directUnsplashRate, 93.8);
  assert.equal(stats.rewrittenUnsplashRate, 6.2);
  assert.equal(stats.cacheHitCount, 1);
  assert.equal(stats.imageRequests, 19);
  assert.equal(stats.errorRequests, 1);
});
