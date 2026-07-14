/**
 * 主图片路由
 * 处理图片请求并返回302重定向
 */

const express = require('express');
const router = express.Router();

const { parseImageUrl, descriptionToQuery } = require('../utils/urlParser');
const { getCachedImage, setCachedImage } = require('../services/cache');
const { isRateLimitReached, incrementRequestCount } = require('../services/rateLimit');
const { searchPhotos, getPicsumRandomUrl, optimizeImageUrl } = require('../services/unsplash');
const { getLLMSynonym } = require('../services/llm');
const { logRequest } = require('../db/logger');

const REDIRECT_CACHE_TTL = parseInt(process.env.REDIRECT_CACHE_TTL, 10)
  || parseInt(process.env.CACHE_TTL, 10)
  || 43200;

/**
 * 延迟辅助函数
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function redirectToImage(res, url) {
  res.set('Cache-Control', `public, max-age=${REDIRECT_CACHE_TTL}, s-maxage=${REDIRECT_CACHE_TTL}, stale-while-revalidate=86400`);
  return res.redirect(302, url);
}

/**
 * 尝试搜索图片，包含LLM重试逻辑和指数退避
 * @param {string} description - 原始描述词
 * @param {object} logData - 日志数据对象
 * @returns {Promise<{url: string, source: string}>} 图片URL和来源
 */
async function trySearchWithRetries(description, logData) {
  // 第一次尝试：使用原始查询词
  try {
    incrementRequestCount();
    const query = descriptionToQuery(description);
    let result = await searchPhotos(query);

    if (result.total > 0) {
      return { url: result.url, source: 'unsplash' };
    }
  } catch (error) {
    console.error('Unsplash initial search failed:', error.message);
    // API错误，继续尝试LLM重试
  }

  // 第1次重试：等待1秒后用LLM生成同义词
  console.log('Waiting 1s before retry 1...');
  await sleep(1000);

  try {
    const synonym1 = await getLLMSynonym(description, 1);
    logData.retry_1_term = synonym1;
    logData.retry_count = 1;

    incrementRequestCount();
    const result = await searchPhotos(descriptionToQuery(synonym1));

    if (result.total > 0) {
      return { url: result.url, source: 'unsplash-retry-1' };
    }
  } catch (error) {
    console.error('Unsplash retry 1 failed:', error.message);
  }

  // 第2次重试：等待2秒后用LLM生成另一个同义词
  console.log('Waiting 2s before retry 2...');
  await sleep(2000);

  try {
    const synonym2 = await getLLMSynonym(description, 2);
    logData.retry_2_term = synonym2;
    logData.retry_count = 2;

    incrementRequestCount();
    const result = await searchPhotos(descriptionToQuery(synonym2));

    if (result.total > 0) {
      return { url: result.url, source: 'unsplash-retry-2' };
    }
  } catch (error) {
    console.error('Unsplash retry 2 failed:', error.message);
  }

  // 第3次重试：等待3秒后用LLM简化查询
  console.log('Waiting 3s before retry 3...');
  await sleep(3000);

  try {
    const synonym3 = await getLLMSynonym(description, 3);
    logData.retry_3_term = synonym3;
    logData.retry_count = 3;

    incrementRequestCount();
    const result = await searchPhotos(descriptionToQuery(synonym3));

    if (result.total > 0) {
      return { url: result.url, source: 'unsplash-retry-3' };
    }
  } catch (error) {
    console.error('Unsplash retry 3 failed:', error.message);
  }

  // 全部失败，返回null
  return null;
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

    // 3. 尝试搜索图片（包含LLM重试和指数退避）
    const searchResult = await trySearchWithRetries(description, logData);

    if (searchResult) {
      // 成功获取Unsplash图片
      logData.success = true;
      logData.final_url = searchResult.url;
      logData.source = searchResult.source;
      logData.response_time = Date.now() - startTime;

      setCachedImage(description, searchResult.url);

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
