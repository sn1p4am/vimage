/**
 * Unsplash API服务
 * 封装Unsplash图片搜索API调用
 */

const axios = require('axios');

const UNSPLASH_API_BASE = 'https://api.unsplash.com';
const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

if (!ACCESS_KEY) {
  console.warn('Warning: UNSPLASH_ACCESS_KEY not set in environment variables');
}

/**
 * 搜索Unsplash图片
 * @param {string} query - 查询词（空格分隔）
 * @returns {Promise<{total: number, url: string|null}>} 搜索结果
 */
async function searchPhotos(query) {
  try {
    const response = await axios.get(`${UNSPLASH_API_BASE}/search/photos`, {
      params: {
        query: query,
        per_page: 1,  // 只返回1张图片
        client_id: ACCESS_KEY
      },
      timeout: 5000  // 5秒超时
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
    if (error.code === 'ECONNABORTED') {
      throw new Error('Unsplash API timeout');
    } else if (error.response) {
      // HTTP错误响应
      throw new Error(`Unsplash API error: ${error.response.status}`);
    } else {
      // 网络错误或其他
      throw new Error('Unsplash API network error');
    }
  }
}

/**
 * 生成Picsum随机图片URL
 * @returns {string} Picsum图片URL
 */
function getPicsumRandomUrl() {
  // 使用时间戳确保每次都是不同的随机图片
  return `https://picsum.photos/1200/800?random=${Date.now()}`;
}

module.exports = {
  searchPhotos,
  getPicsumRandomUrl
};
