/**
 * Coordinates direct and LLM-assisted Unsplash searches under one time budget.
 */

const { tryConsumeRequestSlot } = require('./rateLimit');

const DEFAULT_SEARCH_BUDGET_MS = 5000;
const DEFAULT_OPERATION_TIMEOUT_MS = 2500;

class SearchTimeoutError extends Error {
  constructor(operation) {
    super(`${operation} timed out`);
    this.name = 'SearchTimeoutError';
  }
}

class SearchRateLimitError extends Error {
  constructor() {
    super('Unsplash rate limit reached');
    this.name = 'SearchRateLimitError';
  }
}

function getPositiveInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function remainingTime(deadline, now) {
  return Math.max(0, deadline - now());
}

async function runWithDeadline(operation, {
  deadline,
  operationName,
  operationTimeoutMs,
  now
}) {
  const remaining = remainingTime(deadline, now);
  if (remaining <= 0) {
    throw new SearchTimeoutError('image search budget');
  }

  const timeoutMs = Math.max(1, Math.min(operationTimeoutMs, remaining));
  const controller = new AbortController();
  let timeoutId;

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation({
        timeoutMs,
        signal: controller.signal
      })),
      new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new SearchTimeoutError(operationName));
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function hasPhoto(result) {
  return Boolean(result && result.total > 0 && result.url);
}

function candidateKey(value) {
  return value.trim().toLowerCase().replace(/[-_\s]+/g, ' ');
}

function normalizeCandidates(candidates, originalTerm) {
  if (!Array.isArray(candidates)) {
    return [];
  }

  const seen = new Set([candidateKey(originalTerm)]);
  const unique = [];

  for (const value of candidates) {
    if (typeof value !== 'string' || !value.trim()) {
      continue;
    }

    const candidate = value.trim();
    const key = candidateKey(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(candidate);

    if (unique.length === 3) {
      break;
    }
  }

  return unique;
}

/**
 * Create an image search function. Dependencies are injectable for focused tests.
 */
function createImageSearcher(overrides = {}) {
  let blockedUntil = 0;
  let blockedResult = null;
  const dependencies = {
    searchPhotos: (...args) => require('./unsplash').searchPhotos(...args),
    getLLMSearchCandidates: (...args) => require('./llm').getLLMSearchCandidates(...args),
    getFallbackCandidates: (...args) => require('./llm').getFallbackCandidates(...args),
    tryConsumeRequestSlot,
    now: Date.now,
    ...overrides
  };

  const searchBudgetMs = getPositiveInteger(
    overrides.searchBudgetMs,
    getPositiveInteger(process.env.IMAGE_SEARCH_BUDGET_MS, DEFAULT_SEARCH_BUDGET_MS)
  );
  const unsplashTimeoutMs = getPositiveInteger(
    overrides.unsplashTimeoutMs,
    getPositiveInteger(process.env.UNSPLASH_TIMEOUT_MS, DEFAULT_OPERATION_TIMEOUT_MS)
  );
  const llmTimeoutMs = getPositiveInteger(
    overrides.llmTimeoutMs,
    getPositiveInteger(process.env.LLM_TIMEOUT_MS, DEFAULT_OPERATION_TIMEOUT_MS)
  );
  const upstreamCooldownMs = getPositiveInteger(
    overrides.upstreamCooldownMs,
    getPositiveInteger(process.env.UPSTREAM_COOLDOWN_MS, 60000)
  );

  function stopForUpstreamError(error, logData) {
    if (!Number.isInteger(error.status) || error.status < 400) return null;
    logData.error_message = error.message;
    const result = error.status === 429 ? { rateLimited: true } : { error: error.message };
    if ([401, 403, 429].includes(error.status) || error.status >= 500) {
      const duration = error.status === 429
        ? Math.max(upstreamCooldownMs, error.retryAfterMs || 0)
        : upstreamCooldownMs;
      blockedUntil = dependencies.now() + duration;
      blockedResult = { result, errorMessage: error.message };
    }
    return result;
  }

  return async function searchImage(description, logData) {
    if (blockedResult && dependencies.now() < blockedUntil) {
      logData.error_message = blockedResult.errorMessage;
      return blockedResult.result;
    }
    const deadline = dependencies.now() + searchBudgetMs;
    const searchUnsplash = async (term, operationName, onRequest = () => {}) => {
      if (!dependencies.tryConsumeRequestSlot()) {
        throw new SearchRateLimitError();
      }

      onRequest();
      return runWithDeadline(
        options => dependencies.searchPhotos(term, options),
        {
          deadline,
          operationName,
          operationTimeoutMs: unsplashTimeoutMs,
          now: dependencies.now
        }
      );
    };

    try {
      const directResult = await searchUnsplash(description, 'Unsplash direct search');
      if (hasPhoto(directResult)) {
        return { url: directResult.url, source: 'unsplash' };
      }
    } catch (error) {
      console.error('Unsplash initial search failed:', error.message);
      if (error instanceof SearchRateLimitError) {
        return { rateLimited: true };
      }
      const stopped = stopForUpstreamError(error, logData);
      if (stopped) return stopped;
    }

    if (remainingTime(deadline, dependencies.now) <= 0) {
      return null;
    }

    let candidates;
    try {
      candidates = await runWithDeadline(
        options => dependencies.getLLMSearchCandidates(description, options),
        {
          deadline,
          operationName: 'LLM candidate generation',
          operationTimeoutMs: llmTimeoutMs,
          now: dependencies.now
        }
      );
    } catch (error) {
      console.error('LLM search candidate generation failed:', error.message);
      candidates = dependencies.getFallbackCandidates(description);
    }

    const searchCandidates = normalizeCandidates(candidates, description);
    for (const [index, candidate] of searchCandidates.entries()) {
      if (remainingTime(deadline, dependencies.now) <= 0) {
        break;
      }

      const retryNumber = index + 1;

      try {
        const result = await searchUnsplash(
          candidate,
          `Unsplash retry ${retryNumber}`,
          () => {
            logData[`retry_${retryNumber}_term`] = candidate;
            logData.retry_count = retryNumber;
          }
        );

        if (hasPhoto(result)) {
          return {
            url: result.url,
            source: `unsplash-retry-${retryNumber}`
          };
        }
      } catch (error) {
        console.error(`Unsplash retry ${retryNumber} failed:`, error.message);
        if (error instanceof SearchRateLimitError) {
          return { rateLimited: true };
        }
        const stopped = stopForUpstreamError(error, logData);
        if (stopped) return stopped;
      }
    }

    return null;
  };
}

const searchImage = createImageSearcher();

module.exports = {
  searchImage,
  createImageSearcher,
  SearchTimeoutError,
  SearchRateLimitError,
  normalizeCandidates
};
