const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const test = require('node:test');
const { loadImageConfig } = require('../src/config/imageAccess');
const { createImageApiAuth } = require('../src/middleware/imageApiAuth');
const { createImageApiQuota } = require('../src/services/imageApiQuota');
const { validateUpstreamUrl } = require('../src/services/imageAssets');
const { fetchImage } = require('../src/services/imageProxy');
const axios = require('axios');

test('public origins are configured explicitly and proxy mode requires acknowledgement', () => {
  assert.equal(loadImageConfig({}).publicBaseUrl, 'http://localhost:7749');
  assert.equal(loadImageConfig({ PUBLIC_BASE_URL: 'https://images.example.com/' }).publicBaseUrl, 'https://images.example.com');
  for (const value of ['ftp://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com/?key=secret', 'https://example.com/#hash']) {
    assert.throws(() => loadImageConfig({ PUBLIC_BASE_URL: value }));
  }
  assert.throws(() => loadImageConfig({ IMAGE_API_KEY_HASHES: 'plaintext-is-not-a-hash' }));
  assert.throws(() => loadImageConfig({ IMAGE_API_RATE_LIMIT: '-1' }));
  assert.throws(() => loadImageConfig({ IMAGE_DELIVERY_MODE: 'unknown' }));
  assert.throws(() => loadImageConfig({ IMAGE_DELIVERY_MODE: 'proxy' }));
  assert.equal(loadImageConfig({ IMAGE_DELIVERY_MODE: 'proxy', UNSPLASH_PROXY_APPROVED: 'true' }).deliveryMode, 'proxy');
});

test('key authentication is fail closed, accepts rotated keys and rejects query credentials', () => {
  const first = 'first-test-key-'.repeat(4);
  const second = 'second-test-key-'.repeat(4);
  const digest = value => createHash('sha256').update(value).digest('hex');
  function authenticate(hashes, header, query = {}) {
    const req = { get: () => header, query };
    const res = { set: () => res, status: status => { res.code = status; return res; }, json: () => res };
    let passed = false;
    createImageApiAuth(hashes)(req, res, () => { passed = true; });
    return { passed, status: res.code, hash: req.imageApiKeyHash };
  }
  assert.equal(authenticate([], `Bearer ${first}`).status, 503);
  for (const key of [first, second]) {
    assert.equal(authenticate([digest(first), digest(second)], `Bearer ${key}`).passed, true);
  }
  assert.equal(authenticate([digest(second)], `Bearer ${first}`).status, 401);
  assert.equal(authenticate([digest(first)], undefined, { key: first }).status, 401);
  assert.equal(authenticate([digest(first)], `Basic ${first}`).status, 401);
});

test('per-key minute and UTC daily quotas persist across limiter instances', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE image_api_usage (key_hash TEXT PRIMARY KEY, minute_start INTEGER, minute_count INTEGER, day_start INTEGER, day_count INTEGER)');
  const config = { minuteLimit: 2, dailyLimit: 3 };
  const consume = createImageApiQuota(db, config);
  assert.equal(consume('client-one', 1000).allowed, true);
  assert.equal(consume('client-one', 1001).allowed, true);
  assert.deepEqual(consume('client-one', 1002), { allowed: false, retryAfter: 59 });
  assert.equal(consume('client-two', 1002).allowed, true);
  const restarted = createImageApiQuota(db, config);
  assert.equal(restarted('client-one', 1003).allowed, false);
  assert.equal(restarted('client-one', 60001).allowed, true);
  assert.equal(restarted('client-one', 120001).allowed, false);
  assert.equal(restarted('client-one', 86400001).allowed, true);
  db.close();
});

test('upstream allowlist rejects arbitrary URLs and preserves Unsplash tracking', () => {
  const valid = 'https://images.unsplash.com/photo-test?ixid=tracking&w=640';
  assert.equal(validateUpstreamUrl(valid), valid);
  for (const url of ['http://images.unsplash.com/photo-test', 'https://127.0.0.1/photo-test', 'https://images.unsplash.com.evil.test/photo-test', 'https://images.unsplash.com:8080/photo-test', 'https://user:secret@images.unsplash.com/photo-test', 'https://images.unsplash.com/photo-test#fragment', 'https://images.unsplash.com/other-path', 'file:///etc/passwd']) {
    assert.throws(() => validateUpstreamUrl(url));
  }
});

test('proxy restricts transfers and never forwards client credentials or follows redirects', async context => {
  const config = loadImageConfig({});
  let received;
  let response = { status: 200, headers: { 'content-type': 'image/png' }, data: Buffer.from('image-bytes') };
  context.mock.method(axios, 'get', async (url, options) => {
    received = { url, options };
    return response;
  });
  const signal = new AbortController().signal;
  const image = await fetchImage('https://images.unsplash.com/photo-test', config, signal);
  assert.equal(image.body.toString(), 'image-bytes');
  assert.equal(received.options.maxRedirects, 0);
  assert.equal(received.options.proxy, false);
  assert.equal(received.options.signal, signal);
  assert.equal(received.options.maxContentLength, config.proxyMaxBytes);
  assert.equal(received.options.headers.Authorization, undefined);
  for (const invalid of [
    { status: 302 },
    { headers: { 'content-type': 'text/html' } },
    { headers: { 'content-type': 'image/svg+xml' } },
    { data: Buffer.alloc(0) },
    { data: Buffer.alloc(config.proxyMaxBytes + 1) }
  ]) {
    response = { status: 200, headers: { 'content-type': 'image/png' }, data: Buffer.from('image'), ...invalid };
    await assert.rejects(fetchImage('https://images.unsplash.com/photo-test', config, signal));
  }
});
