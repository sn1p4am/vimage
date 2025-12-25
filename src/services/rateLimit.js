/**
 * 速率限制服务
 * 限制Unsplash API调用频率，避免超出配额
 */

// 从环境变量读取限制，默认4800/小时
const RATE_LIMIT = parseInt(process.env.UNSPLASH_RATE_LIMIT) || 4800;

// 请求计数器
let requestCount = 0;

// 重置时间（毫秒时间戳）
let resetTime = Date.now() + 3600000; // 1小时后

/**
 * 检查是否达到速率限制
 * @returns {boolean} true表示已达到限制
 */
function isRateLimitReached() {
  // 检查是否需要重置计数器
  if (Date.now() > resetTime) {
    requestCount = 0;
    resetTime = Date.now() + 3600000;
  }

  return requestCount >= RATE_LIMIT;
}

/**
 * 增加请求计数
 */
function incrementRequestCount() {
  requestCount++;
}

/**
 * 获取速率限制状态
 * @returns {{current: number, limit: number, resetIn: number}} 状态信息
 */
function getRateLimitStatus() {
  // 检查是否需要重置
  if (Date.now() > resetTime) {
    requestCount = 0;
    resetTime = Date.now() + 3600000;
  }

  return {
    current: requestCount,
    limit: RATE_LIMIT,
    resetIn: Math.max(0, Math.floor((resetTime - Date.now()) / 1000)) // 秒
  };
}

/**
 * 重置速率限制（仅用于测试）
 */
function resetRateLimit() {
  requestCount = 0;
  resetTime = Date.now() + 3600000;
}

module.exports = {
  isRateLimitReached,
  incrementRequestCount,
  getRateLimitStatus,
  resetRateLimit
};
