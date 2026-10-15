/**
 * 缓存服务
 * 使用 node-cache 作为一级缓存，SQLite 作为持久化二级缓存
 */

const NodeCache = require('node-cache');
const db = require('../db/init');

// 从环境变量读取TTL，默认12小时
const configuredTtl = parseInt(process.env.CACHE_TTL, 10);
const CACHE_TTL = Number.isSafeInteger(configuredTtl) && configuredTtl > 0
  ? configuredTtl
  : 43200;
const PERSISTENT_CLEANUP_INTERVAL = 10 * 60 * 1000;

// 创建缓存实例
const imageCache = new NodeCache({
  stdTTL: CACHE_TTL,        // 默认过期时间
  checkperiod: 600,         // 每10分钟清理过期缓存
  useClones: false          // 直接返回引用，提升性能
});

const statements = {
  get: db.prepare(`
    SELECT url, created_at, expires_at
    FROM image_cache
    WHERE cache_key = ? AND expires_at > ?
  `),
  set: db.prepare(`
    INSERT INTO image_cache (cache_key, url, created_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      url = excluded.url,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  `),
  deleteExpired: db.prepare(`
    DELETE FROM image_cache
    WHERE expires_at <= ?
  `),
  countActive: db.prepare(`
    SELECT COUNT(*) AS count
    FROM image_cache
    WHERE expires_at > ?
  `),
  clear: db.prepare('DELETE FROM image_cache')
};

let memoryHits = 0;
let persistentHits = 0;
let processMisses = 0;
let lastPersistentCleanup = 0;

function cleanupExpiredPersistentEntries(force = false) {
  const now = Date.now();
  if (!force && now - lastPersistentCleanup < PERSISTENT_CLEANUP_INTERVAL) {
    return;
  }

  try {
    statements.deleteExpired.run(now);
    lastPersistentCleanup = now;
  } catch (error) {
    console.error('Persistent cache cleanup failed:', error.message);
  }
}

/**
 * 获取缓存的图片URL
 * @param {string} description - 搜索词组（如 "cute cat"）
 * @returns {{url: string, timestamp: number}|undefined} 缓存数据
 */
function getCachedImage(description) {
  const memoryEntry = imageCache.get(description);
  if (memoryEntry) {
    memoryHits += 1;
    return memoryEntry;
  }

  const now = Date.now();

  try {
    const persistentEntry = statements.get.get(description, now);
    if (persistentEntry) {
      const entry = {
        url: persistentEntry.url,
        timestamp: persistentEntry.created_at
      };
      const remainingTtl = (persistentEntry.expires_at - now) / 1000;

      imageCache.set(description, entry, remainingTtl);
      persistentHits += 1;
      cleanupExpiredPersistentEntries();
      return entry;
    }

    cleanupExpiredPersistentEntries();
  } catch (error) {
    console.error('Persistent cache read failed:', error.message);
  }

  processMisses += 1;
  return undefined;
}

/**
 * 设置缓存的图片URL
 * @param {string} description - 描述词
 * @param {string} url - 图片URL
 */
function setCachedImage(description, url) {
  const timestamp = Date.now();
  const entry = { url, timestamp };

  imageCache.set(description, entry);

  try {
    statements.set.run(
      description,
      url,
      timestamp,
      timestamp + CACHE_TTL * 1000
    );
    cleanupExpiredPersistentEntries();
  } catch (error) {
    console.error('Persistent cache write failed:', error.message);
  }
}

/**
 * 获取缓存统计信息
 * @returns {{keys: number, hits: number, misses: number, ksize: number, vsize: number,
 * activeEntries: number, persistentEntries: number, memoryHits: number,
 * persistentHits: number, processHits: number, processMisses: number,
 * processHitRate: number, ttlSeconds: number}}
 */
function getCacheStats() {
  const now = Date.now();
  const activeEntries = imageCache.keys()
    .filter(key => imageCache.getTtl(key) > now)
    .length;
  let persistentEntries = 0;

  cleanupExpiredPersistentEntries();

  try {
    persistentEntries = statements.countActive.get(now).count;
  } catch (error) {
    console.error('Persistent cache stats failed:', error.message);
  }

  const processHits = memoryHits + persistentHits;
  const lookups = processHits + processMisses;
  const memoryStats = imageCache.getStats();

  return {
    ...memoryStats,
    activeEntries,
    persistentEntries,
    memoryHits,
    persistentHits,
    processHits,
    processMisses,
    processHitRate: lookups > 0 ? Number((processHits / lookups * 100).toFixed(1)) : 0,
    ttlSeconds: CACHE_TTL
  };
}

/**
 * 仅清空一级缓存，供测试持久缓存回填和运行时诊断使用。
 */
function clearMemoryCache() {
  imageCache.flushAll();
}

/**
 * 清空所有缓存
 */
function clearCache() {
  clearMemoryCache();

  try {
    statements.clear.run();
  } catch (error) {
    console.error('Persistent cache clear failed:', error.message);
  }

  memoryHits = 0;
  persistentHits = 0;
  processMisses = 0;
  lastPersistentCleanup = 0;
}

module.exports = {
  getCachedImage,
  setCachedImage,
  getCacheStats,
  clearCache,
  clearMemoryCache
};
