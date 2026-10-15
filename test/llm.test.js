const assert = require('node:assert/strict');
const test = require('node:test');
const axios = require('axios');
process.env.LLM_CACHE_TTL = '1';
process.env.LLM_CACHE_MAX_ENTRIES = '2';
process.env.DASHSCOPE_ENABLE_THINKING = 'false';
const { getLLMSearchCandidates } = require('../src/services/llm');

test('candidate requests disable thinking, bound output, and cache only successful responses', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: 10000 });
  let calls = 0;
  let fail = false;
  context.mock.method(axios, 'post', async (url, body) => {
    calls += 1;
    assert.equal(body.enable_thinking, false);
    assert.equal(body.max_tokens, 256);
    if (fail) throw new Error('temporary failure');
    return { data: { choices: [{ message: { content: '{"candidates":["portrait","person"]}' } }] } };
  });
  const first = await getLLMSearchCandidates('original-term');
  first.push('must-not-pollute-cache');
  assert.deepEqual(await getLLMSearchCandidates('original-term'), ['portrait', 'person']);
  assert.equal(calls, 1);
  context.mock.timers.tick(1001);
  await getLLMSearchCandidates('original-term');
  assert.equal(calls, 2);
  await getLLMSearchCandidates('second-term');
  await getLLMSearchCandidates('third-term');
  await getLLMSearchCandidates('original-term');
  assert.equal(calls, 5);
  fail = true;
  await getLLMSearchCandidates('failure-term');
  fail = false;
  assert.deepEqual(await getLLMSearchCandidates('failure-term'), ['portrait', 'person']);
  assert.equal(calls, 7);
});
