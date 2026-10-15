/**
 * 日志记录服务
 * 将请求日志写入SQLite数据库
 */

const db = require('./init');

const LOG_SORTS = Object.freeze({
  newest: 'timestamp DESC, id DESC',
  oldest: 'timestamp ASC, id ASC',
  slowest: 'response_time DESC, id DESC'
});
const LOG_RANGES = Object.freeze({ '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 });
const LOG_SOURCES = Object.freeze({
  cache: "source = 'cache'",
  direct: "source = 'unsplash'",
  rewritten: "source LIKE 'unsplash-retry-%'"
});
const LOG_FILTER_OPTIONS = Object.freeze({
  sort: Object.keys(LOG_SORTS),
  range: ['all', ...Object.keys(LOG_RANGES)],
  source: ['all', ...Object.keys(LOG_SOURCES)],
  status: ['all', 'success', 'failed']
});

let aggregateSnapshot;
let sourceSnapshot;
let snapshotVersion;

function updateSnapshot(logData) {
  if (!aggregateSnapshot) return;
  aggregateSnapshot.image_requests += 1;
  if (logData.success) aggregateSnapshot.success_count += 1;
  if (logData.from_cache) aggregateSnapshot.cache_hit_count += 1;
  if (logData.response_time !== null && logData.response_time !== undefined) {
    aggregateSnapshot.response_time_sum += logData.response_time;
    aggregateSnapshot.timed_requests += 1;
  }
  const matchType = logData.success && logData.source === 'unsplash'
    ? 'direct'
    : logData.success && logData.source?.startsWith('unsplash-retry-') ? 'rewritten' : null;
  if (matchType) {
    aggregateSnapshot[`${matchType}_unsplash_count`] += 1;
    if (logData.response_time !== null && logData.response_time !== undefined) {
      aggregateSnapshot[`${matchType}_time_sum`] += logData.response_time;
      aggregateSnapshot[`${matchType}_timed_count`] += 1;
    }
  }
  if (logData.source) sourceSnapshot[logData.source] = (sourceSnapshot[logData.source] || 0) + 1;
}

function cleanupLogs(now = Date.now()) {
  const configuredDays = Number(process.env.LOG_RETENTION_DAYS ?? 30);
  if (!Number.isFinite(configuredDays) || configuredDays <= 0) return 0;
  const cutoff = new Date(now - configuredDays * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const result = db.prepare(`
    DELETE FROM request_logs WHERE id IN (
      SELECT id FROM request_logs WHERE timestamp < ? ORDER BY timestamp LIMIT 1000
    )
  `).run(cutoff);
  if (result.changes) aggregateSnapshot = null;
  return result.changes;
}

const insertStatement = db.prepare(`
  INSERT INTO request_logs (
    original_url, query_term, retry_count, retry_1_term, retry_2_term, retry_3_term,
    success, final_url, source, response_time, error_message, from_cache
  ) VALUES (
    @original_url, @query_term, @retry_count, @retry_1_term, @retry_2_term, @retry_3_term,
    @success, @final_url, @source, @response_time, @error_message, @from_cache
  )
`);

/**
 * 记录请求日志
 * @param {Object} logData - 日志数据
 */
function logRequest(logData) {
  try {
    insertStatement.run({
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
    updateSnapshot(logData);
  } catch (error) {
    // 记录失败不应影响主流程
    console.error('Failed to write log to database:', error.message);
  }
}

/**
 * 获取请求日志（分页）
 * @param {number} page - 页码（从1开始）
 * @param {number} limit - 每页数量
 * @param {Object} filters - 搜索、时间、结果、来源与排序条件
 * @returns {{total: number, data: Array, page: number, limit: number}} 日志数据
 */
function getLogs(page = 1, limit = 20, filters = {}) {
  const offset = (page - 1) * limit;
  const conditions = ['query_term IS NOT NULL'];
  const bindings = [];
  if (filters.q) {
    const pattern = '%' + filters.q.replace(/[\\%_]/g, '\\$&') + '%';
    const columns = ['original_url', 'query_term', 'error_message', 'retry_1_term', 'retry_2_term', 'retry_3_term'];
    conditions.push('(' + columns.map(column => `${column} LIKE ? ESCAPE '\\'`).join(' OR ') + ')');
    bindings.push(...columns.map(() => pattern));
  }
  if (Object.hasOwn(LOG_SOURCES, filters.source)) conditions.push(LOG_SOURCES[filters.source]);
  if (filters.status === 'success') conditions.push('success = 1');
  if (filters.status === 'failed') conditions.push('(success = 0 OR success IS NULL)');
  if (Object.hasOwn(LOG_RANGES, filters.range)) {
    conditions.push('timestamp >= ?');
    bindings.push(new Date(Date.now() - LOG_RANGES[filters.range]).toISOString().slice(0, 19).replace('T', ' '));
  }
  const whereClause = conditions.join(' AND ');
  const orderBy = Object.hasOwn(LOG_SORTS, filters.sort) ? LOG_SORTS[filters.sort] : LOG_SORTS.newest;
  let total;
  if (conditions.length > 1) {
    total = db.prepare(`SELECT COUNT(*) AS count FROM request_logs WHERE ${whereClause}`).get(...bindings).count;
  } else {
    total = getStats().imageRequests;
  }

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
      final_url,
      source,
      response_time,
      error_message,
      from_cache
    FROM request_logs
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `);

  const data = stmt.all(...bindings, limit, offset);

  return {
    total,
    data,
    page,
    limit,
    totalPages: total > 0 ? Math.ceil(total / limit) : 0
  };
}

/**
 * 获取统计信息
 * @returns {Object} 统计数据
 */
function getStats() {
  const dataVersion = db.pragma('data_version', { simple: true });
  if (!aggregateSnapshot || snapshotVersion !== dataVersion) {
    const aggregateStmt = db.prepare(`
    SELECT
      COUNT(*) AS image_requests,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN from_cache = 1 THEN 1 ELSE 0 END) AS cache_hit_count,
      SUM(CASE WHEN success = 1 AND source = 'unsplash' THEN 1 ELSE 0 END) AS direct_unsplash_count,
      SUM(CASE WHEN success = 1 AND source LIKE 'unsplash-retry-%' THEN 1 ELSE 0 END) AS rewritten_unsplash_count,
      SUM(CASE WHEN success = 1 AND source = 'unsplash' THEN response_time ELSE 0 END) AS direct_time_sum,
      COUNT(CASE WHEN success = 1 AND source = 'unsplash' THEN response_time END) AS direct_timed_count,
      SUM(CASE WHEN success = 1 AND source LIKE 'unsplash-retry-%' THEN response_time ELSE 0 END) AS rewritten_time_sum,
      COUNT(CASE WHEN success = 1 AND source LIKE 'unsplash-retry-%' THEN response_time END) AS rewritten_timed_count,
      SUM(response_time) AS response_time_sum,
      COUNT(response_time) AS timed_requests
    FROM request_logs WHERE query_term IS NOT NULL
  `);
    aggregateSnapshot = aggregateStmt.get();
    for (const key of Object.keys(aggregateSnapshot)) aggregateSnapshot[key] ??= 0;
    sourceSnapshot = Object.create(null);
    const sources = db.prepare(`
      SELECT source, COUNT(*) AS count FROM request_logs
      WHERE query_term IS NOT NULL AND source IS NOT NULL GROUP BY source
    `).all();
    for (const item of sources) sourceSnapshot[item.source] = item.count;
    snapshotVersion = dataVersion;
  }
  const aggregate = aggregateSnapshot;
  const imageRequests = aggregate.image_requests || 0;
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
  const directUnsplashAvgResponseTime = roundNullableAverage(
    aggregate.direct_timed_count ? aggregate.direct_time_sum / aggregate.direct_timed_count : null
  );
  const rewrittenUnsplashAvgResponseTime = roundNullableAverage(
    aggregate.rewritten_timed_count ? aggregate.rewritten_time_sum / aggregate.rewritten_timed_count : null
  );
  const avgResponseTime = aggregate.timed_requests ? Math.round(aggregate.response_time_sum / aggregate.timed_requests) : 0;
  const sourcesDistribution = { ...sourceSnapshot };

  return {
    imageRequests,
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
    directUnsplashAvgResponseTime,
    rewrittenUnsplashAvgResponseTime,
    avgResponseTime,
    sourcesDistribution
  };
}

function toPercentage(value, total) {
  return total > 0 ? Number((value / total * 100).toFixed(1)) : 0;
}

function roundNullableAverage(value) {
  return value === null || value === undefined ? null : Math.round(value);
}

module.exports = {
  cleanupLogs,
  logRequest,
  getLogs,
  getStats,
  LOG_FILTER_OPTIONS
};
