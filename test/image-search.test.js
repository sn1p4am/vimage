const assert = require('node:assert/strict');
const test = require('node:test');

const { createImageSearcher } = require('../src/services/imageSearch');

function createLogData() {
  return {
    retry_count: 0,
    retry_1_term: null,
    retry_2_term: null,
    retry_3_term: null
  };
}

function createSearcher(overrides = {}) {
  return createImageSearcher({
    descriptionToQuery: value => value,
    tryConsumeRequestSlot: () => true,
    getFallbackCandidates: () => [],
    searchBudgetMs: 500,
    unsplashTimeoutMs: 100,
    llmTimeoutMs: 100,
    ...overrides
  });
}

test('direct Unsplash hit does not call the LLM', async () => {
  let llmCalls = 0;
  const search = createSearcher({
    searchPhotos: async term => ({ total: 1, url: `https://images.test/${term}` }),
    getLLMSearchCandidates: async () => {
      llmCalls += 1;
      return ['alternative'];
    }
  });
  const logData = createLogData();

  const result = await search('cute-girl', logData);

  assert.deepEqual(result, {
    url: 'https://images.test/cute-girl',
    source: 'unsplash'
  });
  assert.equal(llmCalls, 0);
  assert.equal(logData.retry_count, 0);
});

test('one LLM call supplies sequential candidates and preserves retry fields', async () => {
  const searchedTerms = [];
  let llmCalls = 0;
  const search = createSearcher({
    searchPhotos: async term => {
      searchedTerms.push(term);
      return term === 'young-woman'
        ? { total: 1, url: 'https://images.test/match' }
        : { total: 0, url: null };
    },
    getLLMSearchCandidates: async () => {
      llmCalls += 1;
      return ['portrait', 'young-woman', 'woman'];
    }
  });
  const logData = createLogData();

  const result = await search('cute-girl', logData);

  assert.equal(llmCalls, 1);
  assert.deepEqual(searchedTerms, ['cute-girl', 'portrait', 'young-woman']);
  assert.deepEqual(result, {
    url: 'https://images.test/match',
    source: 'unsplash-retry-2'
  });
  assert.equal(logData.retry_count, 2);
  assert.equal(logData.retry_1_term, 'portrait');
  assert.equal(logData.retry_2_term, 'young-woman');
  assert.equal(logData.retry_3_term, null);
});

test('only one LLM request is made and duplicate candidates are skipped', async () => {
  let llmCalls = 0;
  let unsplashCalls = 0;
  const search = createSearcher({
    searchPhotos: async () => {
      unsplashCalls += 1;
      return { total: 0, url: null };
    },
    getLLMSearchCandidates: async () => {
      llmCalls += 1;
      return ['original', 'one', 'ONE', 'two', 'three', 'ignored'];
    }
  });
  const logData = createLogData();

  const result = await search('original', logData);

  assert.equal(result, null);
  assert.equal(llmCalls, 1);
  assert.equal(unsplashCalls, 4);
  assert.equal(logData.retry_count, 3);
  assert.equal(logData.retry_3_term, 'three');
});

test('overall budget stops later candidates', async () => {
  const searchedTerms = [];
  const search = createSearcher({
    searchBudgetMs: 25,
    unsplashTimeoutMs: 100,
    llmTimeoutMs: 100,
    searchPhotos: async (term, options) => {
      searchedTerms.push(term);
      if (term === 'slow-candidate') {
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(resolve, 300);
          options.signal.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            reject(new Error('aborted'));
          }, { once: true });
        });
      }
      return { total: 0, url: null };
    },
    getLLMSearchCandidates: async () => ['slow-candidate', 'must-not-run']
  });
  const logData = createLogData();
  const startedAt = Date.now();

  const result = await search('original', logData);

  assert.equal(result, null);
  assert.deepEqual(searchedTerms, ['original', 'slow-candidate']);
  assert.equal(logData.retry_count, 1);
  assert.ok(Date.now() - startedAt < 200);
});

test('LLM timeout uses local candidates within the remaining budget', async () => {
  const searchedTerms = [];
  const search = createSearcher({
    searchBudgetMs: 120,
    llmTimeoutMs: 20,
    searchPhotos: async term => {
      searchedTerms.push(term);
      return term === 'local-fallback'
        ? { total: 1, url: 'https://images.test/local-fallback' }
        : { total: 0, url: null };
    },
    getLLMSearchCandidates: async (term, options) => {
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(resolve, 200);
        options.signal.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          reject(new Error('aborted'));
        }, { once: true });
      });
      return [];
    },
    getFallbackCandidates: () => ['local-fallback']
  });
  const logData = createLogData();

  const result = await search('original', logData);

  assert.deepEqual(result, {
    url: 'https://images.test/local-fallback',
    source: 'unsplash-retry-1'
  });
  assert.deepEqual(searchedTerms, ['original', 'local-fallback']);
  assert.equal(logData.retry_count, 1);
});

test('rate limit is checked before every Unsplash request', async () => {
  let availableSlots = 1;
  let unsplashCalls = 0;
  const search = createSearcher({
    tryConsumeRequestSlot: () => availableSlots-- > 0,
    searchPhotos: async () => {
      unsplashCalls += 1;
      return { total: 0, url: null };
    },
    getLLMSearchCandidates: async () => ['retry-one', 'retry-two']
  });
  const logData = createLogData();

  const result = await search('original', logData);

  assert.deepEqual(result, { rateLimited: true });
  assert.equal(unsplashCalls, 1);
  assert.equal(logData.retry_count, 0);
  assert.equal(logData.retry_1_term, null);
});

for (const status of [401, 403, 429, 503]) {
  test(`HTTP ${status} stops keyword retries and suppresses new upstream calls during cooldown`, async () => {
    let now = 1000;
    let searches = 0;
    let llmCalls = 0;
    const search = createSearcher({
      now: () => now,
      upstreamCooldownMs: 100,
      searchPhotos: async () => {
        searches += 1;
        if (searches === 1) throw Object.assign(new Error(`HTTP ${status}`), { status, retryAfterMs: 500 });
        return { total: 1, url: 'https://images.test/recovered' };
      },
      getLLMSearchCandidates: async () => { llmCalls += 1; return ['alternative']; }
    });
    const firstLog = createLogData();
    const first = await search('original', firstLog);
    assert.equal(firstLog.error_message, `HTTP ${status}`);
    assert.deepEqual(await search('different-term', createLogData()), first);
    now = status === 429 ? 1499 : 1099;
    assert.deepEqual(await search('another-term', createLogData()), first);
    assert.equal(searches, 1);
    assert.equal(llmCalls, 0);
    now += 2;
    assert.equal((await search('recovered', createLogData())).source, 'unsplash');
    assert.equal(searches, 2);
  });
}

test('an upstream authentication failure during candidate search stops later candidates', async () => {
  let searches = 0;
  const search = createSearcher({
    searchPhotos: async () => {
      searches += 1;
      if (searches > 1) throw Object.assign(new Error('Unauthorized'), { status: 401 });
      return { total: 0, url: null };
    },
    getLLMSearchCandidates: async () => ['first', 'second', 'third']
  });
  const result = await search('original', createLogData());
  assert.equal(result.error, 'Unauthorized');
  assert.equal(searches, 2);
});
