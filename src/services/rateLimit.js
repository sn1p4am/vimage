/**
 * 速率限制服务
 * 限制Unsplash API调用频率，避免超出配额
 */

// 从环境变量读取限制，默认4800/小时
const RATE_LIMIT = parseInt(process.env.UNSPLASH_RATE_LIMIT, 10) || 4800;

// 请求计数器
let requestCount = 0;

// 重置时间（毫秒时间戳）
let resetTime = Date.now() + 3600000; // 1小时后

function resetCounterIfNeeded() {
  if (Date.now() >= resetTime) {
    requestCount = 0;
    resetTime = Date.now() + 3600000;
  }
}

/**
 * 检查是否达到速率限制
 * @returns {boolean} true表示已达到限制
 */
function isRateLimitReached() {
  resetCounterIfNeeded();
  return requestCount >= RATE_LIMIT;
}

/**
 * 原子占用一次Unsplash请求额度
 * @returns {boolean} 是否成功占用额度
 */
function tryConsumeRequestSlot() {
  resetCounterIfNeeded();
  if (requestCount >= RATE_LIMIT) {
    return false;
  }

  requestCount += 1;
  return true;
}

/**
 * 获取速率限制状态
 * @returns {{current: number, limit: number, resetIn: number}} 状态信息
 */
function getRateLimitStatus() {
  resetCounterIfNeeded();

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
  tryConsumeRequestSlot,
  getRateLimitStatus,
  resetRateLimit
};
