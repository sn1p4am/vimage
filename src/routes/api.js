/**
 * API路由
 * 提供统计信息和日志查询接口
 */

const express = require('express');
const router = express.Router();

const { getStats, getLogs, LOG_FILTER_OPTIONS } = require('../db/logger');
const { getRateLimitStatus } = require('../services/rateLimit');
const { getCacheStats } = require('../services/cache');

/**
 * GET /api/stats
 * 获取服务统计信息
 */
router.get('/stats', (req, res) => {
  try {
    const stats = getStats();
    const rateLimitStatus = getRateLimitStatus();
    const cacheStats = getCacheStats();

    res.json({
      ...stats,
      rateLimitStatus,
      cacheStats,
      retentionDays: Math.max(0, Number(process.env.LOG_RETENTION_DAYS ?? 30) || 0)
    });
  } catch (error) {
    console.error('Stats API error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * GET /api/logs?page=1&limit=20
 * 获取请求日志（分页）
 */
router.get('/logs', (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const limit = parsePositiveInteger(req.query.limit, 20);
    const allowedParameters = ['page', 'limit', 'q', ...Object.keys(LOG_FILTER_OPTIONS)];
    if (Object.keys(req.query).some(name => !allowedParameters.includes(name))) {
      return res.status(400).json({ error: 'Unsupported log query parameter' });
    }

    if (limit > 100) {
      return res.status(400).json({ error: 'Limit must be between 1 and 100' });
    }

    const filters = {};
    for (const [name, options] of Object.entries(LOG_FILTER_OPTIONS)) {
      const value = req.query[name];
      if (value !== undefined && !options.includes(value)) {
        return res.status(400).json({ error: `Invalid ${name}`, allowedValues: options });
      }
      if (value !== undefined) filters[name] = value;
    }
    if (req.query.q !== undefined) {
      if (typeof req.query.q !== 'string' || req.query.q.length > 200) {
        return res.status(400).json({ error: 'Search text must be a string of at most 200 characters' });
      }
      filters.q = req.query.q.trim();
    }
    const logs = getLogs(page, limit, filters);
    res.json(logs);
  } catch (error) {
    console.error('Logs API error:', error);
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

function parsePositiveInteger(value, fallback) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number(rawValue);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = router;
