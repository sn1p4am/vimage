/**
 * LLM service for generating alternative Unsplash search terms.
 */

const axios = require('axios');

const DASHSCOPE_API_BASE = process.env.DASHSCOPE_API_BASE
  || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const API_KEY = process.env.DASHSCOPE_API_KEY;
const MODEL = process.env.DASHSCOPE_MODEL || 'deepseek-v4-flash';
const DEFAULT_LLM_TIMEOUT_MS = 2500;

if (!API_KEY) {
  console.warn('Warning: DASHSCOPE_API_KEY not set in environment variables');
}

function getPositiveInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function generateCandidatesPrompt(originalTerm) {
  return `You optimize search terms for the Unsplash image library.

Original term: "${originalTerm}"

Return up to three distinct English search alternatives, ordered from most specific to broadest:
1. Replace uncommon words with common visual synonyms.
2. Try another common phrasing while preserving the subject.
3. Simplify to the core visual subject.

Do not repeat the original term. Return JSON only:
{"candidates":["first-term","second-term","core-subject"]}`;
}

function normalizeCandidate(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, '-');

  return normalized || null;
}

function uniqueCandidates(values, originalTerm) {
  const originalKey = normalizeCandidate(originalTerm)?.toLowerCase();
  const seen = new Set(originalKey ? [originalKey] : []);
  const candidates = [];

  for (const value of values) {
    const candidate = normalizeCandidate(value);
    const key = candidate?.toLowerCase();

    if (!candidate || seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(candidate);

    if (candidates.length === 3) {
      break;
    }
  }

  return candidates;
}

function parseCandidates(content, originalTerm) {
  const cleaned = content
    .trim()
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```\s*/g, '');

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    const jsonObject = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonObject) {
      throw new Error('Invalid LLM response format');
    }
    parsed = JSON.parse(jsonObject[0]);
  }

  const values = Array.isArray(parsed.candidates)
    ? parsed.candidates
    : [parsed.synonym];
  const candidates = uniqueCandidates(values, originalTerm);

  if (candidates.length === 0) {
    throw new Error('LLM returned no usable search candidates');
  }

  return candidates;
}

function getFallbackCandidates(originalTerm) {
  const words = originalTerm
    .split(/[-_\s]+/)
    .map(word => word.trim())
    .filter(Boolean);

  if (words.length <= 1) {
    return [];
  }

  const middleIndex = Math.floor(words.length / 2);
  return uniqueCandidates(
    [words[0], words[words.length - 1], words[middleIndex]],
    originalTerm
  );
}

/**
 * Generate all retry terms with one LLM request.
 *
 * @param {string} originalTerm
 * @param {{timeoutMs?: number, signal?: AbortSignal}} options
 * @returns {Promise<string[]>}
 */
async function getLLMSearchCandidates(originalTerm, options = {}) {
  const timeout = getPositiveInteger(
    options.timeoutMs,
    getPositiveInteger(process.env.LLM_TIMEOUT_MS, DEFAULT_LLM_TIMEOUT_MS)
  );

  try {
    const response = await axios.post(
      `${DASHSCOPE_API_BASE}/chat/completions`,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: 'You are a precise image search assistant.' },
          { role: 'user', content: generateCandidatesPrompt(originalTerm) }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout,
        signal: options.signal
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('Invalid LLM response format');
    }

    return parseCandidates(content, originalTerm);
  } catch (error) {
    console.error('LLM candidate generation failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data));
    }

    return getFallbackCandidates(originalTerm);
  }
}

/**
 * Backward-compatible helper for callers that still request one retry term.
 */
async function getLLMSynonym(originalTerm, retryNum = 1, options = {}) {
  const candidates = await getLLMSearchCandidates(originalTerm, options);
  return candidates[Math.min(Math.max(retryNum, 1), candidates.length) - 1] || originalTerm;
}

module.exports = {
  getLLMSearchCandidates,
  getLLMSynonym,
  parseCandidates,
  getFallbackCandidates
};
