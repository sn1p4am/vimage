const express = require('express');
const db = require('../db/init');
const { loadImageConfig } = require('../config/imageAccess');
const { createAssetStore, validateUpstreamUrl } = require('../services/imageAssets');
const { fetchImage } = require('../services/imageProxy');
const { asyncHandler } = require('../utils/asyncHandler');
const { logRequest } = require('../db/logger');

function createImageRouter(options = {}) {
  const config = options.config || loadImageConfig();
  const store = options.store || createAssetStore(db);
  const loadImage = options.fetchImage || fetchImage;
  const router = express.Router();
  let activeRequests = 0;
  router.get('/i/:id', asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'Fixed image URLs do not accept parameters' });
    const asset = store.get(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Image not found' });
    try {
      validateUpstreamUrl(asset.upstream_url);
    } catch {
      return res.status(502).json({ error: 'Image upstream unavailable' });
    }
    const cacheControl = `public, max-age=${config.cacheTtl}, s-maxage=${config.cacheTtl}`;
    if (config.deliveryMode === 'redirect') {
      return res.set('Cache-Control', cacheControl).redirect(302, asset.upstream_url);
    }
    if (activeRequests >= config.proxyConcurrency) {
      return res.set('Retry-After', '1').status(503).json({ error: 'Image delivery is busy' });
    }
    activeRequests += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.proxyTimeoutMs);
    const abort = () => controller.abort();
    res.once('close', abort);
    try {
      const image = await loadImage(asset.upstream_url, config, controller.signal);
      if (res.destroyed) return;
      if (controller.signal.aborted) throw new Error('Image delivery timed out');
      res.set({
        'Cache-Control': cacheControl,
        'Content-Type': image.contentType,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox"
      });
      res.send(image.body);
    } catch {
      if (!res.destroyed) res.status(502).json({ error: 'Image upstream unavailable' });
    } finally {
      clearTimeout(timeout);
      res.off('close', abort);
      activeRequests -= 1;
    }
  }));
  router.get('/:filename', (req, res) => {
    if (!/^vimage_/i.test(req.params.filename)) {
      logRequest({ original_url: req.params.filename, error_message: 'Not Found', response_time: 0 });
      return res.status(404).json({ error: 'Not Found' });
    }
    return res.set('Cache-Control', 'no-store').status(410).json({
      error: 'Dynamic image URLs are disabled. Use the authenticated POST /api/images/resolve endpoint.'
    });
  });
  return router;
}

module.exports = { createImageRouter };
