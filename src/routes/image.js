/**
 * 主图片路由
 * 处理图片请求并返回302重定向
 */

const express = require('express');
const router = express.Router();

const { parseImageUrl } = require('../utils/urlParser');
const { getCachedImage, setCachedImage } = require('../services/cache');
const { isRateLimitReached } = require('../services/rateLimit');
const { getPicsumRandomUrl, optimizeImageUrl } = require('../services/unsplash');
const { searchImage } = require('../services/imageSearch');
const { logRequest } = require('../db/logger');

const REDIRECT_CACHE_TTL = parseInt(process.env.REDIRECT_CACHE_TTL, 10)
  || parseInt(process.env.CACHE_TTL, 10)
  || 43200;

function redirectToImage(res, url) {
  res.set('Cache-Control', `public, max-age=${REDIRECT_CACHE_TTL}, s-maxage=${REDIRECT_CACHE_TTL}, stale-while-revalidate=86400`);
  return res.redirect(302, url);
}

/**
 * 主图片处理逻辑
 */
router.get('/:filename', async (req, res) => {
  const startTime = Date.now();
  const filename = req.params.filename;

  const logData = {
    original_url: filename,
    query_term: null,
    retry_count: 0,
    retry_1_term: null,
    retry_2_term: null,
    retry_3_term: null,
    success: false,
    final_url: null,
    source: null,
    response_time: null,
    error_message: null,
    from_cache: false
  };

  try {
    const { description } = parseImageUrl(filename);
    logData.query_term = description;
  } catch (error) {
    logData.error_message = error.message;
    logData.response_time = Date.now() - startTime;
    logRequest(logData);

    return res.status(404).json({
      error: 'Not Found',
      message: 'The requested resource was not found'
    });
  }

  try {
    const description = logData.query_term;

    // 1. 检查缓存
    const cached = getCachedImage(description);
    if (cached) {
      logData.success = true;
      logData.final_url = cached.url;
      logData.source = 'cache';
      logData.from_cache = true;
      logData.response_time = Date.now() - startTime;

      logRequest(logData);
      return redirectToImage(res, optimizeImageUrl(cached.url, req.query));
    }

    // 2. 检查速率限制
    if (isRateLimitReached()) {
      const url = getPicsumRandomUrl(req.query);
      logData.success = false;
      logData.final_url = url;
      logData.source = 'picsum-rate-limit';
      logData.response_time = Date.now() - startTime;

      logRequest(logData);
      return redirectToImage(res, url);
    }

    // 3. 在统一时间预算内尝试直搜和一次LLM候选词搜索
    const searchResult = await searchImage(description, logData);

    if (searchResult?.rateLimited) {
      const url = getPicsumRandomUrl(req.query);
      logData.success = false;
      logData.final_url = url;
      logData.source = 'picsum-rate-limit';
      logData.response_time = Date.now() - startTime;

      logRequest(logData);
      return redirectToImage(res, url);
    } else if (searchResult) {
      // 成功获取Unsplash图片
      logData.success = true;
      logData.final_url = searchResult.url;
      logData.source = searchResult.source;

      setCachedImage(description, searchResult.url);
      logData.response_time = Date.now() - startTime;

      logRequest(logData);
      return redirectToImage(res, optimizeImageUrl(searchResult.url, req.query));
    } else {
      // 全部失败，使用Picsum兜底
      const url = getPicsumRandomUrl(req.query);
      logData.success = false;
      logData.final_url = url;
      logData.source = 'picsum-all-failed';
      logData.response_time = Date.now() - startTime;

      logRequest(logData);
      return redirectToImage(res, url);
    }

  } catch (error) {
    console.error('Image route error:', error);

    logData.success = false;
    logData.error_message = error.message;
    logData.response_time = Date.now() - startTime;

    // 错误时使用Picsum兜底
    const url = getPicsumRandomUrl(req.query);
    logData.final_url = url;
    logData.source = 'picsum-error';

    logRequest(logData);
    return redirectToImage(res, url);
  }
});

module.exports = router;
