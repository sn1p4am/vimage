/**
 * 缓存服务
 * 使用 node-cache 进行内存缓存
 */

const NodeCache = require('node-cache');

// 从环境变量读取TTL，默认12小时
const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 43200;

// 创建缓存实例
const imageCache = new NodeCache({
  stdTTL: CACHE_TTL,        // 默认过期时间
  checkperiod: 600,         // 每10分钟清理过期缓存
  useClones: false          // 直接返回引用，提升性能
});

/**
 * 获取缓存的图片URL
 * @param {string} description - 描述词（如 "cute-cat"）
 * @returns {{url: string, timestamp: number}|undefined} 缓存数据
 */
function getCachedImage(description) {
  return imageCache.get(description);
}

/**
 * 设置缓存的图片URL
 * @param {string} description - 描述词
 * @param {string} url - 图片URL
 */
function setCachedImage(description, url) {
  imageCache.set(description, {
    url: url,
    timestamp: Date.now()
  });
}

/**
 * 获取缓存统计信息
 * @returns {{keys: number, hits: number, misses: number, ksize: number, vsize: number}}
 */
function getCacheStats() {
  const stats = imageCache.getStats();
  const lookups = stats.hits + stats.misses;

  return {
    ...stats,
    activeEntries: stats.keys,
    processHits: stats.hits,
    processMisses: stats.misses,
    processHitRate: lookups > 0 ? Number((stats.hits / lookups * 100).toFixed(1)) : 0,
    ttlSeconds: CACHE_TTL
  };
}

/**
 * 清空所有缓存
 */
function clearCache() {
  imageCache.flushAll();
}

module.exports = {
  getCachedImage,
  setCachedImage,
  getCacheStats,
  clearCache
};
