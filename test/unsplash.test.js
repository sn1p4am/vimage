const assert = require('node:assert/strict');
const test = require('node:test');
const axios = require('axios');
const { searchPhotos, UnsplashError, parseRetryAfter } = require('../src/services/unsplash');

test('upstream status and Retry-After survive error translation', async context => {
  context.mock.method(axios, 'get', async () => {
    throw { response: { status: 429, headers: { 'retry-after': '120' } }, message: 'rate limited' };
  });
  await assert.rejects(searchPhotos('cat'), error => error instanceof UnsplashError
    && error.status === 429 && error.retryAfterMs === 120000);
});

test('a quota-exhausted 403 is treated as rate limiting', async context => {
  context.mock.method(axios, 'get', async () => {
    throw { response: { status: 403, headers: { 'x-ratelimit-remaining': '0' } }, message: 'quota exhausted' };
  });
  await assert.rejects(searchPhotos('cat'), error => error.status === 429);
});

test('Retry-After accepts HTTP dates and rejects malformed values', context => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-15T00:00:00Z') });
  assert.equal(parseRetryAfter('Thu, 15 Oct 2026 00:01:00 GMT'), 60000);
  assert.equal(parseRetryAfter('invalid'), 0);
  assert.equal(parseRetryAfter(undefined), 0);
});
