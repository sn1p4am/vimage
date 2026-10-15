function positiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`Invalid ${name}`);
  return number;
}

function loadImageConfig(env = process.env) {
  const base = new URL(env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || 7749}`);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password
    || base.search || base.hash || base.pathname !== '/') {
    throw new Error('PUBLIC_BASE_URL must be an HTTP(S) origin without a path or credentials');
  }
  const keyHashes = (env.IMAGE_API_KEY_HASHES || '').split(',').map(value => value.trim()).filter(Boolean);
  if (keyHashes.some(value => !/^[a-f0-9]{64}$/i.test(value))) {
    throw new Error('IMAGE_API_KEY_HASHES must contain comma-separated SHA-256 hashes');
  }
  const deliveryMode = env.IMAGE_DELIVERY_MODE || 'redirect';
  if (!['redirect', 'proxy'].includes(deliveryMode)) throw new Error('Invalid IMAGE_DELIVERY_MODE');
  if (deliveryMode === 'proxy' && env.UNSPLASH_PROXY_APPROVED !== 'true') {
    throw new Error('Unsplash proxy delivery requires UNSPLASH_PROXY_APPROVED=true after provider approval');
  }
  return {
    publicBaseUrl: base.origin,
    keyHashes: [...new Set(keyHashes.map(value => value.toLowerCase()))],
    deliveryMode,
    minuteLimit: positiveInteger(env.IMAGE_API_RATE_LIMIT, 60, 'IMAGE_API_RATE_LIMIT'),
    dailyLimit: positiveInteger(env.IMAGE_API_DAILY_LIMIT, 1000, 'IMAGE_API_DAILY_LIMIT'),
    searchConcurrency: positiveInteger(env.IMAGE_SEARCH_MAX_CONCURRENT, 4, 'IMAGE_SEARCH_MAX_CONCURRENT'),
    proxyConcurrency: positiveInteger(env.IMAGE_PROXY_MAX_CONCURRENT, 8, 'IMAGE_PROXY_MAX_CONCURRENT'),
    proxyTimeoutMs: positiveInteger(env.IMAGE_PROXY_TIMEOUT_MS, 10000, 'IMAGE_PROXY_TIMEOUT_MS'),
    proxyMaxBytes: positiveInteger(env.IMAGE_PROXY_MAX_BYTES, 10485760, 'IMAGE_PROXY_MAX_BYTES'),
    cacheTtl: positiveInteger(env.REDIRECT_CACHE_TTL, 43200, 'REDIRECT_CACHE_TTL')
  };
}

module.exports = { loadImageConfig };
