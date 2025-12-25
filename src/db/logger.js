/**
 * 日志记录服务
 * 将请求日志写入SQLite数据库
 */

const db = require('./init');

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
      response_time: logData.response_time || null,
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
 * @returns {{total: number, data: Array}} 日志数据
 */
function getLogs(page = 1, limit = 20) {
  const offset = (page - 1) * limit;

  const countStmt = db.prepare('SELECT COUNT(*) as total FROM request_logs');
  const total = countStmt.get().total;

  const stmt = db.prepare(`
    SELECT * FROM request_logs
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `);

  const data = stmt.all(limit, offset);

  return { total, data, page, limit };
}

/**
 * 获取统计信息
 * @returns {Object} 统计数据
 */
function getStats() {
  // 总请求数
  const totalStmt = db.prepare('SELECT COUNT(*) as total FROM request_logs');
  const totalRequests = totalStmt.get().total;

  // 成功率
  const successStmt = db.prepare('SELECT COUNT(*) as total FROM request_logs WHERE success = 1');
  const successCount = successStmt.get().total;
  const successRate = totalRequests > 0 ? (successCount / totalRequests * 100).toFixed(1) : 0;

  // 缓存命中率
  const cacheStmt = db.prepare('SELECT COUNT(*) as total FROM request_logs WHERE from_cache = 1');
  const cacheCount = cacheStmt.get().total;
  const cacheHitRate = totalRequests > 0 ? (cacheCount / totalRequests * 100).toFixed(1) : 0;

  // 平均响应时间
  const avgTimeStmt = db.prepare('SELECT AVG(response_time) as avg FROM request_logs WHERE response_time IS NOT NULL');
  const avgResponseTime = Math.round(avgTimeStmt.get().avg || 0);

  // 来源分布
  const sourceStmt = db.prepare(`
    SELECT source, COUNT(*) as count
    FROM request_logs
    GROUP BY source
  `);
  const sources = sourceStmt.all();
  const sourcesDistribution = {};
  sources.forEach(item => {
    sourcesDistribution[item.source || 'unknown'] = item.count;
  });

  return {
    totalRequests,
    successRate: parseFloat(successRate),
    cacheHitRate: parseFloat(cacheHitRate),
    avgResponseTime,
    sourcesDistribution
  };
}

module.exports = {
  logRequest,
  getLogs,
  getStats
};
