const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vimage-statistics-'));
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.LOG_RETENTION_DAYS = '30';
const db = require('../src/db/init');
const { getStats, getLogs, logRequest, cleanupLogs } = require('../src/db/logger');

test('statistics update incrementally, refresh external writes, and respect log retention', context => {
  context.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  let aggregateQueries = 0;
  const originalPrepare = db.prepare;
  context.mock.method(db, 'prepare', function (sql) {
    if (sql.includes('COUNT(*) AS image_requests')) aggregateQueries += 1;
    return originalPrepare.call(this, sql);
  });
  assert.equal(getStats().imageRequests, 0);
  logRequest({ original_url: '/api/images/resolve', query_term: 'cat', success: true, source: 'unsplash', response_time: 100 });
  const snapshot = getStats();
  logRequest({ original_url: '/api/images/resolve', query_term: 'cat', success: true, source: 'unsplash', response_time: 300 });
  assert.equal(getStats().directUnsplashAvgResponseTime, 200);
  assert.equal(getLogs(1, 20).total, 2);
  assert.equal(snapshot.imageRequests, 1);
  assert.equal(snapshot.sourcesDistribution.unsplash, 1);
  assert.equal(aggregateQueries, 1);
  const external = new Database(process.env.DB_PATH);
  external.prepare("INSERT INTO request_logs (original_url, query_term, success, source) VALUES ('/api/images/resolve', 'dog', 0, 'search-failed')").run();
  external.close();
  assert.equal(getStats().imageRequests, 3);
  assert.equal(aggregateQueries, 2);
  db.prepare("UPDATE request_logs SET timestamp = datetime('now', '-31 days') WHERE id = 1").run();
  process.env.LOG_RETENTION_DAYS = '0';
  assert.equal(cleanupLogs(), 0);
  process.env.LOG_RETENTION_DAYS = '30';
  assert.equal(cleanupLogs(), 1);
  assert.equal(getStats().imageRequests, 2);
  assert.equal(getStats().directUnsplashAvgResponseTime, 300);
  assert.equal(getLogs(1, 20).total, 2);
  assert.equal(aggregateQueries, 3);
});
