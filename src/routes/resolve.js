const express = require('express');
const db = require('../db/init');
const { loadImageConfig } = require('../config/imageAccess');
const { createImageApiAuth } = require('../middleware/imageApiAuth');
const { createImageApiQuota } = require('../services/imageApiQuota');
const { createAssetStore } = require('../services/imageAssets');
const { getCachedImage, setCachedImage } = require('../services/cache');
const { optimizeImageUrl } = require('../services/unsplash');
const { searchImage } = require('../services/imageSearch');
const { createSearchCoordinator } = require('../services/searchCoordinator');
const { logRequest } = require('../db/logger');
const { asyncHandler } = require('../utils/asyncHandler');

function validInput(body) {
  if (!body || Array.isArray(body) || typeof body.query !== 'string') return false;
  if (Object.keys(body).some(key => !['query', 'w', 'q'].includes(key))) return false;
  const query = body.query.trim();
  if (!query || query.length > 200 || /[\u0000-\u001f\u007f]/.test(query)) return false;
  return [['w', 80, 2400], ['q', 1, 100]].every(([key, minimum, maximum]) =>
    body[key] === undefined || (Number.isInteger(body[key]) && body[key] >= minimum && body[key] <= maximum));
}

function createResolveRouter(options = {}) {
  const config = options.config || loadImageConfig();
  const store = options.store || createAssetStore(db);
  const consumeQuota = options.consumeQuota || createImageApiQuota(db, config);
  const findImage = createSearchCoordinator({ searchImage: options.searchImage || searchImage, setCachedImage });
  const router = express.Router();
  let activeRequests = 0;
  router.use(createImageApiAuth(config.keyHashes));
  router.post('/resolve', asyncHandler(async (req, res, next) => {
    if (Object.keys(req.query).length || !validInput(req.body)) {
      return res.status(400).json({ error: 'Expected query (1-200 characters), optional integer w (80-2400) and q (1-100)' });
    }
    if (activeRequests >= config.searchConcurrency) {
      return res.set('Retry-After', '1').status(503).json({ error: 'Image search is busy' });
    }
    const quota = consumeQuota(req.imageApiKeyHash);
    if (!quota.allowed) {
      return res.set('Retry-After', String(quota.retryAfter)).status(429).json({ error: 'Image API quota exceeded' });
    }
    activeRequests += 1;
    const started = Date.now();
    const description = req.body.query.trim();
    const logData = { original_url: '/api/images/resolve', query_term: description, success: false };
    try {
      const cached = getCachedImage(description);
      const result = cached ? { url: cached.url, source: 'cache' } : await findImage(description, logData);
      if (!result?.url) {
        logData.source = 'search-failed';
        logData.error_message ||= 'No image could be resolved';
        return res.status(result?.rateLimited ? 503 : 502).json({ error: 'Image search unavailable; retry later' });
      }
      const asset = store.save(optimizeImageUrl(result.url, req.body));
      logData.success = true;
      logData.final_url = asset.upstream_url;
      logData.source = result.source;
      logData.from_cache = Boolean(cached);
      return res.json({
        id: asset.id,
        url: `${config.publicBaseUrl}/i/${asset.id}`,
        upstream_url: asset.upstream_url,
        delivery_mode: config.deliveryMode,
        cached: Boolean(cached)
      });
    } catch (error) {
      logData.source = 'search-failed';
      logData.error_message = 'Image resolution failed';
      next(error);
    } finally {
      activeRequests -= 1;
      logData.response_time = Date.now() - started;
      logRequest(logData);
    }
  }));
  router.use((req, res) => res.status(404).json({ error: 'Image API endpoint not found' }));
  return router;
}

module.exports = { createResolveRouter, validInput };
