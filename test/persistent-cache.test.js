const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vimage-cache-test-'));
process.env.DB_PATH = path.join(testDirectory, 'vimage.db');
process.env.CACHE_TTL = '43200';

const db = require('../src/db/init');
const {
  clearCache,
  clearMemoryCache,
  getCachedImage,
  getCacheStats,
  setCachedImage
} = require('../src/services/cache');

test('persistent cache survives an L1 clear and reports layer-specific stats', t => {
  t.after(() => {
    if (db.open) {
      db.close();
    }
    fs.rmSync(testDirectory, { recursive: true, force: true });
  });

  clearCache();
  setCachedImage('persistent-image', 'https://images.unsplash.com/persistent-image');

  const memoryEntry = getCachedImage('persistent-image');
  assert.equal(memoryEntry.url, 'https://images.unsplash.com/persistent-image');
  assert.equal(typeof memoryEntry.timestamp, 'number');

  let stats = getCacheStats();
  assert.equal(stats.activeEntries, 1);
  assert.equal(stats.persistentEntries, 1);
  assert.equal(stats.memoryHits, 1);
  assert.equal(stats.persistentHits, 0);
  assert.equal(stats.processHits, 1);
  assert.equal(stats.processMisses, 0);
  assert.equal(stats.processHitRate, 100);
  assert.equal(stats.ttlSeconds, 43200);
  assert.equal(stats.keys, 1);
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 0);
  assert.equal(typeof stats.ksize, 'number');
  assert.equal(typeof stats.vsize, 'number');

  clearMemoryCache();
  assert.equal(getCacheStats().activeEntries, 0);

  const restored = getCachedImage('persistent-image');
  assert.equal(restored.url, 'https://images.unsplash.com/persistent-image');
  assert.equal(typeof restored.timestamp, 'number');

  stats = getCacheStats();
  assert.equal(stats.activeEntries, 1);
  assert.equal(stats.persistentEntries, 1);
  assert.equal(stats.memoryHits, 1);
  assert.equal(stats.persistentHits, 1);
  assert.equal(stats.processHits, 2);

  assert.equal(getCachedImage('missing-image'), undefined);
  stats = getCacheStats();
  assert.equal(stats.processMisses, 1);
  assert.equal(stats.processHitRate, 66.7);

  db.prepare('UPDATE image_cache SET expires_at = ? WHERE cache_key = ?')
    .run(Date.now() - 1, 'persistent-image');
  clearMemoryCache();

  assert.equal(getCachedImage('persistent-image'), undefined);
  assert.equal(getCacheStats().persistentEntries, 0);

  clearCache();
  stats = getCacheStats();
  assert.equal(stats.activeEntries, 0);
  assert.equal(stats.persistentEntries, 0);
  assert.equal(stats.memoryHits, 0);
  assert.equal(stats.persistentHits, 0);
  assert.equal(stats.processHits, 0);
  assert.equal(stats.processMisses, 0);
  assert.equal(stats.processHitRate, 0);
  assert.equal(stats.ttlSeconds, 43200);
  assert.equal(stats.keys, 0);
  assert.equal(stats.hits, 0);
  assert.equal(stats.misses, 0);

  setCachedImage('before-close', 'https://images.unsplash.com/before-close');
  db.close();

  assert.doesNotThrow(() => {
    setCachedImage('after-close', 'https://images.unsplash.com/after-close');
  });
  assert.equal(getCachedImage('after-close').url, 'https://images.unsplash.com/after-close');

  clearMemoryCache();
  assert.doesNotThrow(() => getCachedImage('not-in-memory'));
  assert.doesNotThrow(() => getCacheStats());
  assert.doesNotThrow(() => clearCache());
});
