const assert = require('node:assert/strict');
const test = require('node:test');
const { createSearchCoordinator } = require('../src/services/searchCoordinator');

test('concurrent requests share one search and preserve per-request retry logs', async () => {
  let searches = 0;
  let writes = 0;
  const lookup = createSearchCoordinator({
    searchImage: async (description, log) => {
      searches += 1;
      await new Promise(resolve => setTimeout(resolve, 20));
      log.retry_count = 1;
      log.retry_1_term = 'cat';
      return { url: 'https://images.unsplash.com/cat', source: 'unsplash-retry-1' };
    },
    setCachedImage: () => { writes += 1; }
  });
  const logs = Array.from({ length: 20 }, () => ({}));
  const results = await Promise.all(logs.map(log => lookup('cute-cat', log)));
  assert.equal(searches, 1);
  assert.equal(writes, 1);
  assert.ok(results.every(result => result.source === 'unsplash-retry-1'));
  assert.ok(logs.every(log => log.retry_count === 1 && log.retry_1_term === 'cat'));
});

test('different keywords remain independent and rejected searches can be retried', async () => {
  let searches = 0;
  const lookup = createSearchCoordinator({
    searchImage: async () => { searches += 1; throw new Error('temporary failure'); },
    setCachedImage: () => assert.fail('failed searches must not be cached')
  });
  await Promise.all([
    assert.rejects(lookup('cat', {}), /temporary failure/),
    assert.rejects(lookup('dog', {}), /temporary failure/)
  ]);
  await assert.rejects(lookup('cat', {}), /temporary failure/);
  assert.equal(searches, 3);
});
