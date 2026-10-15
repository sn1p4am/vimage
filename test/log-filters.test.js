const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vimage-filters-'));
process.env.DB_PATH = path.join(directory, 'test.db');
const express = require('express');
const db = require('../src/db/init');
const { getLogs, logRequest } = require('../src/db/logger');
const apiRouter = require('../src/routes/api');

test('log filters search all records, combine safely, sort and paginate', async context => {
  const records = [
    { query_term: 'cat', source: 'unsplash', response_time: 80, success: true },
    { query_term: 'cat', source: 'cache', response_time: 0, success: true },
    { query_term: 'night sky', source: 'unsplash-retry-1', retry_1_term: 'stars', response_time: 2400, success: true },
    { query_term: '100%_literal', source: 'search-failed', response_time: 120, success: false, error_message: 'HTTP 429' }
  ];
  records.forEach(record => logRequest({ original_url: '/api/images/resolve', ...record }));
  db.prepare("UPDATE request_logs SET timestamp = datetime('now', '-2 days') WHERE id = 1").run();
  assert.equal(getLogs(1, 20, { q: 'cat' }).total, 2);
  assert.equal(getLogs(1, 20, { q: 'stars' }).total, 1);
  assert.equal(getLogs(1, 20, { q: '%' }).total, 1);
  assert.equal(getLogs(1, 20, { q: "' OR 1=1 --" }).total, 0);
  assert.equal(getLogs(1, 20, { q: 'cat', source: 'cache', status: 'success', range: '24h' }).total, 1);
  assert.equal(getLogs(1, 20, { range: '24h' }).total, 3);
  assert.equal(getLogs(1, 20, { source: 'direct', range: '24h' }).total, 0);
  assert.equal(getLogs(1, 20, { status: 'failed' }).data[0].error_message, 'HTTP 429');
  assert.equal(getLogs(1, 20, { q: 'HTTP 429' }).total, 1);
  assert.equal(getLogs(1, 1, { sort: 'slowest' }).data[0].query_term, 'night sky');
  assert.equal(getLogs(1, 1, { sort: 'oldest' }).data[0].id, 1);
  const secondPage = getLogs(2, 1, { q: 'cat', sort: 'oldest' });
  assert.equal(secondPage.total, 2);
  assert.equal(secondPage.totalPages, 2);
  assert.equal(secondPage.data[0].source, 'cache');

  const app = express();
  app.use('/api', apiRouter);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  context.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  for (const query of ['sort=invalid', 'source=invalid', 'status=invalid', 'range=invalid', 'q[]=cat', 'q=' + 'x'.repeat(201)]) {
    assert.equal((await fetch(`${endpoint}/api/logs?${query}`)).status, 400, query);
  }
  const filtered = await (await fetch(`${endpoint}/api/logs?q=cat&source=cache`)).json();
  assert.equal(filtered.total, 1);
  assert.equal(filtered.data[0].source, 'cache');
  const stats = await (await fetch(`${endpoint}/api/stats`)).json();
  assert.equal(stats.retentionDays, 30);
});
