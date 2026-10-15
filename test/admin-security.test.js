const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createHash } = require('node:crypto');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vimage-security-'));
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.ADMIN_AUTH_ENABLED = 'true';
process.env.ADMIN_USERNAME = 'test-admin';
process.env.ADMIN_PASSWORD = 'test-password';
const imageApiKey = 'isolated-image-test-key-'.repeat(3);
process.env.IMAGE_API_KEY_HASHES = createHash('sha256').update(imageApiKey).digest('hex');
process.env.IMAGE_API_RATE_LIMIT = '1';
process.env.IMAGE_API_DAILY_LIMIT = '1';
process.env.PUBLIC_BASE_URL = 'https://images.example.com';
process.env.IMAGE_DELIVERY_MODE = 'redirect';
const { app } = require('../src/index');
const { setCachedImage } = require('../src/services/cache');
const { loginRateLimiter } = require('../src/middleware/adminAuth');
const db = require('../src/db/init');

test('admin endpoints enforce authentication, safe redirects and login throttling', async context => {
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  context.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options = {}) => fetch(`${endpoint}${route}`, { redirect: 'manual', ...options });
  const login = redirect => request('/login', {
    method: 'POST',
    body: new URLSearchParams({ username: 'test-admin', password: 'test-password', redirect })
  });
  assert.equal((await request('/healthz')).status, 200);
  assert.equal((await request('/api/stats')).status, 401);
  assert.equal((await request('/api/logs')).status, 401);
  assert.equal((await request('/dashboard')).status, 302);
  assert.equal((await request('/dashboard.html')).status, 302);
  assert.equal((await request('/dashboard.css')).status, 302);
  assert.equal((await request('/dashboard.js')).status, 302);
  for (const route of ['/%64ashboard.html', '/dashboard%2ehtml', '//dashboard.html']) {
    assert.equal((await request(route)).status, 404);
  }
  for (const redirect of ['/\\example.invalid', '//example.invalid', '/\n/example.invalid', '/a/..//example.invalid', 'https://example.invalid']) {
    const response = await login(redirect);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/dashboard');
  }
  const valid = await login('/dashboard?tab=image');
  assert.equal(valid.headers.get('location'), '/dashboard?tab=image');
  const cookie = valid.headers.get('set-cookie').split(';')[0];
  setCachedImage('authenticated-cat', 'https://images.unsplash.com/photo-cat');
  const resolveImage = headers => request('/api/images/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ query: 'authenticated-cat' })
  });
  assert.equal((await resolveImage({})).status, 401);
  assert.equal((await resolveImage({ Cookie: cookie })).status, 401);
  const authorizedImage = await resolveImage({ Authorization: `Bearer ${imageApiKey}` });
  assert.equal(authorizedImage.status, 200);
  assert.equal(authorizedImage.headers.get('cache-control'), 'no-store');
  const resolved = await authorizedImage.json();
  assert.equal((await request(new URL(resolved.url).pathname)).status, 302);
  const quotaExceeded = await resolveImage({ Authorization: `Bearer ${imageApiKey}` });
  assert.equal(quotaExceeded.status, 429);
  assert.ok(Number(quotaExceeded.headers.get('retry-after')) > 0);
  assert.equal((await request('/api/stats', { headers: { Authorization: `Bearer ${imageApiKey}` } })).status, 401);
  assert.equal((await request('/vimage_001_cat.jpg')).status, 410);
  for (const route of ['/dashboard', '/dashboard.html', '/dashboard.css', '/dashboard.js']) {
    const dashboard = await request(route, { headers: { Cookie: cookie } });
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.headers.get('cache-control'), 'no-store');
  }
  const stats = await request('/api/stats', { headers: { Cookie: cookie } });
  assert.equal(stats.status, 200);
  assert.equal(stats.headers.get('cache-control'), 'no-store');
  assert.equal(stats.headers.get('x-frame-options'), 'DENY');
  assert.equal(stats.headers.get('x-powered-by'), null);
  const malformedCredentials = await request('/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: {}, password: [] })
  });
  assert.equal(malformedCredentials.status, 302);
  loginRateLimiter.resetKey('127.0.0.1');
  for (let attempt = 0; attempt < 12; attempt += 1) assert.equal((await login('/dashboard')).status, 302);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await request('/login', {
      method: 'POST', body: new URLSearchParams({ username: 'test-admin', password: 'wrong' })
    });
    assert.equal(response.status, 302);
  }
  const limited = await login('/dashboard');
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await request('/healthz')).status, 200);
});
