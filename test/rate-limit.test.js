const assert = require('node:assert/strict');
const test = require('node:test');

process.env.UNSPLASH_RATE_LIMIT = '2';

const {
  getRateLimitStatus,
  resetRateLimit,
  tryConsumeRequestSlot
} = require('../src/services/rateLimit');

test('Unsplash request slots never exceed the configured limit', () => {
  resetRateLimit();

  assert.equal(tryConsumeRequestSlot(), true);
  assert.equal(tryConsumeRequestSlot(), true);
  assert.equal(tryConsumeRequestSlot(), false);
  const status = getRateLimitStatus();
  assert.equal(status.current, 2);
  assert.equal(status.limit, 2);
  assert.ok(status.resetIn >= 3599 && status.resetIn <= 3600);
});
