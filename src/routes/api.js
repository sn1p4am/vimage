/**
 * API路由
 * 提供统计信息和日志查询接口
 */

const express = require('express');
const router = express.Router();

const { getStats, getLogs } = require('../db/logger');
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
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const logs = getLogs(page, limit);
    res.json(logs);
  } catch (error) {
    console.error('Logs API error:', error);
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

module.exports = router;
