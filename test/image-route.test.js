const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const express = require('express');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vimage-routes-'));
process.env.DB_PATH = path.join(directory, 'test.db');
const db = require('../src/db/init');
const { createResolveRouter } = require('../src/routes/resolve');
const { createImageRouter } = require('../src/routes/image');
const { createAssetStore } = require('../src/services/imageAssets');
const { clearCache } = require('../src/services/cache');
const { loadImageConfig } = require('../src/config/imageAccess');

test('authenticated resolution and fixed image delivery remain separate', async context => {
  const key = 'test-image-api-key-'.repeat(3);
  const config = loadImageConfig({
    IMAGE_API_KEY_HASHES: createHash('sha256').update(key).digest('hex'),
    PUBLIC_BASE_URL: 'https://images.example.com',
    IMAGE_SEARCH_MAX_CONCURRENT: '24',
    IMAGE_API_RATE_LIMIT: '1000'
  });
  let outcome = { url: 'https://images.unsplash.com/photo-test?ixid=tracking', source: 'unsplash' };
  let searches = 0;
  let proxyRequests = 0;
  let proxyFailure = false;
  const app = express();
  app.use(express.json({ limit: '8kb' }));
  app.use('/api/images', createResolveRouter({
    config,
    searchImage: async () => {
      searches += 1;
      await new Promise(resolve => setTimeout(resolve, 30));
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }
  }));
  app.use('/proxy', createImageRouter({
    config: { ...config, deliveryMode: 'proxy', proxyConcurrency: 1 },
    fetchImage: async (url, settings, signal) => {
      proxyRequests += 1;
      assert.equal(url.startsWith('https://images.unsplash.com/'), true);
      assert.ok(signal);
      await new Promise(resolve => setTimeout(resolve, 30));
      if (proxyFailure) throw new Error('upstream error with secret details');
      return { body: Buffer.from('test-image-bytes'), contentType: 'image/png' };
    }
  }));
  app.use('/', createImageRouter({ config }));
  app.use((error, req, res, next) => res.status(500).json({ error: 'Internal error' }));
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  context.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options = {}) => fetch(endpoint + route, { redirect: 'manual', ...options });
  const resolveImage = (query, options = {}) => request('/api/images/resolve', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Host: 'attacker.invalid', 'X-Forwarded-Host': 'attacker.invalid' },
    body: JSON.stringify({ query, w: 640 }),
    ...options
  });
  let asset;

  await context.test('authentication happens before cache or search and rejects URL keys', async () => {
    for (const headers of [{}, { Authorization: 'Bearer wrong' }, { Cookie: 'vimage_admin_session=fake' }]) {
      assert.equal((await resolveImage('same term', { headers })).status, 401);
    }
    assert.equal((await request(`/api/images/resolve?key=${key}`, { method: 'POST' })).status, 401);
    assert.equal(searches, 0);
  });

  await context.test('concurrent resolutions share work and return persistent IDs with configured origin', async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, () => resolveImage('same term')));
    assert.equal(searches, 1);
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json();
      asset ||= result;
      assert.equal(result.id, asset.id);
      assert.equal(result.url, `https://images.example.com/i/${asset.id}`);
      assert.equal(new URL(result.upstream_url).searchParams.get('w'), '640');
      assert.equal(new URL(result.upstream_url).searchParams.get('ixid'), 'tracking');
    }
    assert.equal((await (await resolveImage('same term')).json()).cached, true);
    assert.equal(searches, 1);
  });

  await context.test('fixed URLs survive search-cache clearing and reopening the database', async () => {
    clearCache();
    const reopened = new Database(process.env.DB_PATH);
    assert.equal(createAssetStore(reopened).get(asset.id).upstream_url, asset.upstream_url);
    reopened.close();
    const countBefore = db.prepare('SELECT COUNT(*) AS count FROM request_logs').get().count;
    for (const method of ['GET', 'HEAD']) {
      const response = await request(`/i/${asset.id}`, { method });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), asset.upstream_url);
    }
    assert.equal(searches, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM request_logs').get().count, countBefore);
  });

  await context.test('invalid image IDs and query parameters never trigger search', async () => {
    for (const [route, status] of [
      ['/i/not-an-id', 404],
      [`/i/${'f'.repeat(32)}`, 404],
      [`/i/${asset.id}?query=dog`, 400],
      [`/i/${asset.id}?url=http://127.0.0.1`, 400]
    ]) {
      const response = await request(route);
      assert.equal(response.status, status);
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal(searches, 1);
  });

  await context.test('proxy mode returns bytes at the same URL and caps concurrent transfers', async () => {
    const responses = await Promise.all([request(`/proxy/i/${asset.id}`), request(`/proxy/i/${asset.id}`)]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 503]);
    const response = responses.find(result => result.status === 200);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.match(response.headers.get('cache-control'), /public/);
    assert.equal(await response.text(), 'test-image-bytes');
    assert.equal(proxyRequests, 1);
    proxyFailure = true;
    const failed = await request(`/proxy/i/${asset.id}`);
    assert.equal(failed.status, 502);
    assert.equal(failed.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await failed.text(), /secret/);
    assert.equal(searches, 1);
  });

  await context.test('invalid payloads and unsupported methods cannot search', async () => {
    for (const body of [{}, { query: '' }, { query: 'a'.repeat(201) }, { query: 'cat', w: 99999 }, { query: 'cat', url: 'https://example.com' }]) {
      assert.equal((await resolveImage('ignored', { body: JSON.stringify(body) })).status, 400);
    }
    assert.equal((await request('/api/images/resolve', { headers: { Authorization: `Bearer ${key}` } })).status, 404);
    assert.equal(searches, 1);
  });

  await context.test('upstream failures return errors without creating image mappings', async () => {
    const countBefore = db.prepare('SELECT COUNT(*) AS count FROM image_assets').get().count;
    for (const [query, result, status] of [
      ['empty', null, 502],
      ['limited', { rateLimited: true }, 503],
      ['unauthorized', { error: 'Unauthorized' }, 502],
      ['failed', new Error('Unexpected failure'), 500],
      ['bad url', { url: 'https://127.0.0.1/private' }, 500]
    ]) {
      outcome = result;
      const response = await resolveImage(query);
      assert.equal(response.status, status);
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_assets').get().count, countBefore);
    const logs = JSON.stringify(db.prepare('SELECT * FROM request_logs').all());
    assert.equal(logs.includes(key), false);
  });
});
