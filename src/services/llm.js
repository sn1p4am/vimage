/**
 * LLM service for generating alternative Unsplash search terms.
 */

const axios = require('axios');

const DASHSCOPE_API_BASE = process.env.DASHSCOPE_API_BASE
  || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const API_KEY = process.env.DASHSCOPE_API_KEY;
const MODEL = process.env.DASHSCOPE_MODEL || 'deepseek-v4-flash';
const DEFAULT_LLM_TIMEOUT_MS = 2500;
const candidateCache = new Map();

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

Use spaces between words, not hyphens. Do not repeat the original term. Return JSON only:
{"candidates":["first phrase","second phrase","core subject"]}`;
}

function normalizeCandidate(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/[-_\s]+/g, ' ')
    .trim();

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

  if (!Array.isArray(parsed?.candidates)) {
    throw new Error('Invalid LLM response format');
  }
  const candidates = uniqueCandidates(parsed.candidates, originalTerm);

  if (candidates.length === 0) {
    throw new Error('LLM returned no usable search candidates');
  }

  return candidates;
}

function getFallbackCandidates(originalTerm) {
  const words = originalTerm
    .split(/\s+/)
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
  const cacheKey = originalTerm.trim().toLowerCase();
  const cached = candidateCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return [...cached.candidates];
  candidateCache.delete(cacheKey);
  const timeout = getPositiveInteger(
    options.timeoutMs,
    getPositiveInteger(process.env.LLM_TIMEOUT_MS, DEFAULT_LLM_TIMEOUT_MS)
  );

  try {
    const response = await axios.post(
      `${DASHSCOPE_API_BASE}/chat/completions`,
      {
        model: MODEL,
        enable_thinking: process.env.DASHSCOPE_ENABLE_THINKING === 'true',
        max_tokens: getPositiveInteger(process.env.LLM_MAX_TOKENS, 256),
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

    const candidates = parseCandidates(content, originalTerm);
    const maxEntries = getPositiveInteger(process.env.LLM_CACHE_MAX_ENTRIES, 1000);
    if (candidateCache.size >= maxEntries) candidateCache.delete(candidateCache.keys().next().value);
    candidateCache.set(cacheKey, {
      candidates,
      expiresAt: Date.now() + getPositiveInteger(process.env.LLM_CACHE_TTL, 3600) * 1000
    });
    return [...candidates];
  } catch (error) {
    console.error('LLM candidate generation failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
    }

    return getFallbackCandidates(originalTerm);
  }
}

module.exports = {
  getLLMSearchCandidates,
  parseCandidates,
  getFallbackCandidates
};
