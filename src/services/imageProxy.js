const axios = require('axios');
const { validateUpstreamUrl } = require('./imageAssets');

async function fetchImage(url, config, signal) {
  const response = await axios.get(validateUpstreamUrl(url), {
    responseType: 'arraybuffer',
    timeout: config.proxyTimeoutMs,
    signal,
    maxRedirects: 0,
    maxContentLength: config.proxyMaxBytes,
    proxy: false,
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' }
  });
  const contentType = (response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(contentType)
    || response.status !== 200 || !response.data.length || response.data.length > config.proxyMaxBytes) {
    throw new Error('Invalid upstream image response');
  }
  return { body: response.data, contentType };
}

module.exports = { fetchImage };
