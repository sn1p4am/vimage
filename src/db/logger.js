/**
 * 日志记录服务
 * 将请求日志写入SQLite数据库
 */

const db = require('./init');

const LOG_TYPES = Object.freeze({
  ALL: 'all',
  IMAGE: 'image',
  ERROR: 'error'
});

const LOG_FILTERS = Object.freeze({
  [LOG_TYPES.ALL]: '1 = 1',
  [LOG_TYPES.IMAGE]: 'query_term IS NOT NULL',
  [LOG_TYPES.ERROR]: 'query_term IS NULL'
});

/**
 * 记录请求日志
 * @param {Object} logData - 日志数据
 */
function logRequest(logData) {
  try {
    const stmt = db.prepare(`
      INSERT INTO request_logs (
        original_url,
        query_term,
        retry_count,
        retry_1_term,
        retry_2_term,
        retry_3_term,
        success,
        final_url,
        source,
        response_time,
        error_message,
        from_cache
      ) VALUES (
        @original_url,
        @query_term,
        @retry_count,
        @retry_1_term,
        @retry_2_term,
        @retry_3_term,
        @success,
        @final_url,
        @source,
        @response_time,
        @error_message,
        @from_cache
      )
    `);

    stmt.run({
      original_url: logData.original_url || null,
      query_term: logData.query_term || null,
      retry_count: logData.retry_count || 0,
      retry_1_term: logData.retry_1_term || null,
      retry_2_term: logData.retry_2_term || null,
      retry_3_term: logData.retry_3_term || null,
      success: logData.success ? 1 : 0,
      final_url: logData.final_url || null,
      source: logData.source || null,
      response_time: logData.response_time ?? null,
      error_message: logData.error_message || null,
      from_cache: logData.from_cache ? 1 : 0
    });
  } catch (error) {
    // 记录失败不应影响主流程
    console.error('Failed to write log to database:', error.message);
  }
}

/**
 * 获取请求日志（分页）
 * @param {number} page - 页码（从1开始）
 * @param {number} limit - 每页数量
 * @param {'all'|'image'|'error'} type - 日志类型
 * @returns {{total: number, data: Array, page: number, limit: number, type: string}} 日志数据
 */
function getLogs(page = 1, limit = 20, type = LOG_TYPES.ALL) {
  const offset = (page - 1) * limit;
  const normalizedType = Object.hasOwn(LOG_FILTERS, type) ? type : LOG_TYPES.ALL;
  const whereClause = LOG_FILTERS[normalizedType];

  const countStmt = db.prepare(`
    SELECT COUNT(*) as total
    FROM request_logs
    WHERE ${whereClause}
  `);
  const total = countStmt.get().total;

  const stmt = db.prepare(`
    SELECT
      id,
      timestamp,
      original_url,
      query_term,
      retry_count,
      retry_1_term,
      retry_2_term,
      retry_3_term,
      success,
      CASE WHEN query_term IS NULL THEN NULL ELSE final_url END AS final_url,
      CASE WHEN query_term IS NULL THEN NULL ELSE source END AS source,
      response_time,
      error_message,
      from_cache
    FROM request_logs
    WHERE ${whereClause}
    ORDER BY timestamp DESC, id DESC
    LIMIT ? OFFSET ?
  `);

  const data = stmt.all(limit, offset);

  return {
    total,
    data,
    page,
    limit,
    type: normalizedType,
    totalPages: total > 0 ? Math.ceil(total / limit) : 0
  };
}

/**
 * 获取统计信息
 * @returns {Object} 统计数据
 */
function getStats() {
  const aggregateStmt = db.prepare(`
    SELECT
      COUNT(*) AS total_logged_requests,
      SUM(CASE WHEN query_term IS NOT NULL THEN 1 ELSE 0 END) AS image_requests,
      SUM(CASE WHEN query_term IS NULL THEN 1 ELSE 0 END) AS error_requests,
      SUM(CASE WHEN query_term IS NOT NULL AND success = 1 THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN query_term IS NOT NULL AND from_cache = 1 THEN 1 ELSE 0 END) AS cache_hit_count,
      SUM(CASE WHEN query_term IS NOT NULL AND success = 1 AND source = 'unsplash' THEN 1 ELSE 0 END) AS direct_unsplash_count,
      SUM(CASE WHEN query_term IS NOT NULL AND success = 1 AND source LIKE 'unsplash-retry-%' THEN 1 ELSE 0 END) AS rewritten_unsplash_count,
      AVG(CASE WHEN query_term IS NOT NULL THEN response_time END) AS avg_response_time
    FROM request_logs
  `);
  const aggregate = aggregateStmt.get();
  const imageRequests = aggregate.image_requests || 0;
  const errorRequests = aggregate.error_requests || 0;
  const successCount = aggregate.success_count || 0;
  const cacheHitCount = aggregate.cache_hit_count || 0;
  const cacheMissCount = Math.max(0, imageRequests - cacheHitCount);
  const directUnsplashCount = aggregate.direct_unsplash_count || 0;
  const rewrittenUnsplashCount = aggregate.rewritten_unsplash_count || 0;
  const unsplashMatchCount = directUnsplashCount + rewrittenUnsplashCount;
  const successRate = toPercentage(successCount, imageRequests);
  const cacheHitRate = toPercentage(cacheHitCount, imageRequests);
  const directUnsplashRate = toPercentage(directUnsplashCount, unsplashMatchCount);
  const rewrittenUnsplashRate = unsplashMatchCount > 0
    ? Number((100 - directUnsplashRate).toFixed(1))
    : 0;
  const avgResponseTime = Math.round(aggregate.avg_response_time || 0);

  // 来源分布
  const sourceStmt = db.prepare(`
    SELECT source, COUNT(*) as count
    FROM request_logs
    WHERE query_term IS NOT NULL AND source IS NOT NULL
    GROUP BY source
  `);
  const sources = sourceStmt.all();
  const sourcesDistribution = {};
  sources.forEach(item => {
    sourcesDistribution[item.source || 'unknown'] = item.count;
  });

  return {
    // totalRequests keeps its original all-logs meaning for existing API consumers.
    totalRequests: aggregate.total_logged_requests || 0,
    totalLoggedRequests: aggregate.total_logged_requests || 0,
    imageRequests,
    errorRequests,
    successCount,
    successRate,
    cacheHitCount,
    cacheMissCount,
    cacheHitRate,
    directUnsplashCount,
    rewrittenUnsplashCount,
    unsplashMatchCount,
    directUnsplashRate,
    rewrittenUnsplashRate,
    avgResponseTime,
    sourcesDistribution
  };
}

function toPercentage(value, total) {
  return total > 0 ? Number((value / total * 100).toFixed(1)) : 0;
}

module.exports = {
  logRequest,
  getLogs,
  getStats,
  LOG_TYPES
};
