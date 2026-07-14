/**
 * API路由
 * 提供统计信息和日志查询接口
 */

const express = require('express');
const router = express.Router();

const { getStats, getLogs, LOG_TYPES } = require('../db/logger');
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
      cacheStats
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
    const type = typeof req.query.type === 'string' ? req.query.type : LOG_TYPES.ALL;

    if (limit > 100) {
      return res.status(400).json({ error: 'Limit must be between 1 and 100' });
    }

    if (!Object.values(LOG_TYPES).includes(type)) {
      return res.status(400).json({
        error: 'Invalid log type',
        allowedTypes: Object.values(LOG_TYPES)
      });
    }

    const logs = getLogs(page, limit, type);
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
