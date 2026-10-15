/**
 * Unsplash API服务
 * 封装Unsplash图片搜索API调用
 */

const axios = require('axios');

const UNSPLASH_API_BASE = 'https://api.unsplash.com';
const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const DEFAULT_UNSPLASH_TIMEOUT_MS = 2500;

class UnsplashError extends Error {
  constructor(status, retryAfterMs = 0) {
    super(`Unsplash API error: ${status}`);
    this.name = 'UnsplashError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfter(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0;
}

if (!ACCESS_KEY) {
  console.warn('Warning: UNSPLASH_ACCESS_KEY not set in environment variables');
}

/**
 * 搜索Unsplash图片
 * @param {string} query - 查询词（空格分隔）
 * @param {{timeoutMs?: number, signal?: AbortSignal}} options - 请求选项
 * @returns {Promise<{total: number, url: string|null}>} 搜索结果
 */
async function searchPhotos(query, options = {}) {
  const configuredTimeout = parseInt(process.env.UNSPLASH_TIMEOUT_MS, 10);
  const requestedTimeout = parseInt(options.timeoutMs, 10);
  const timeout = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? requestedTimeout
    : (Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : DEFAULT_UNSPLASH_TIMEOUT_MS);

  try {
    const response = await axios.get(`${UNSPLASH_API_BASE}/search/photos`, {
      params: {
        query: query,
        per_page: 1
      },
      headers: { Authorization: `Client-ID ${ACCESS_KEY}` },
      timeout,
      signal: options.signal
    });

    const total = response.data.total || 0;
    const url = total > 0 ? response.data.results[0].urls.regular : null;

    return {
      total,
      url
    };
  } catch (error) {
    console.error('Unsplash API error:', error.message);

    // 区分不同类型的错误
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.code === 'ERR_CANCELED') {
      throw new Error('Unsplash API timeout');
    } else if (error.response) {
      // HTTP错误响应
      const status = error.response.status === 403
        && error.response.headers?.['x-ratelimit-remaining'] === '0'
        ? 429
        : error.response.status;
      throw new UnsplashError(status, parseRetryAfter(error.response.headers?.['retry-after']));
    } else {
      // 网络错误或其他
      throw new Error('Unsplash API network error');
    }
  }
}

function getPositiveInteger(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = parseInt(rawValue, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clamp(value, min, max) {
  if (!value) {
    return null;
  }

  return Math.min(max, Math.max(min, value));
}

/**
 * 按请求参数调整图片尺寸和质量。
 * 使用找图请求体中的 w、q，减少列表页和画廊页的图片体积。
 *
 * @param {string} url - 原始图片URL
 * @param {object} options - 图片宽度和质量
 * @returns {string} 调整后的图片URL
 */
function optimizeImageUrl(url, options = {}) {
  const width = clamp(getPositiveInteger(options.w), 80, 2400);
  const quality = clamp(getPositiveInteger(options.q), 1, 100);

  if (!width && !quality) {
    return url;
  }

  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.hostname === 'images.unsplash.com') {
      if (width) {
        parsedUrl.searchParams.set('w', width.toString());
      }

      if (quality) {
        parsedUrl.searchParams.set('q', quality.toString());
      }

      return parsedUrl.toString();
    }
  } catch (error) {
    return url;
  }

  return url;
}

module.exports = {
  UnsplashError,
  parseRetryAfter,
  searchPhotos,
  optimizeImageUrl
};
