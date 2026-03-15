/**
 * Task 42: Retry/backoff utility for external API calls (Stripe, Google Calendar, etc.)
 *
 * Usage:
 *   const result = await withRetry(() => stripe.paymentIntents.create(params), { maxAttempts: 3 });
 *   const result = await withRetry(() => calendar.events.insert(...), {
 *     shouldRetry: (err) => err.code === 503 || err.message?.includes('ECONNRESET')
 *   });
 */

const DEFAULT_OPTS = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  shouldRetry: null
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function defaultShouldRetry(err) {
  if (!err) return false;
  if (err.type === 'StripeCardError' || err.code === 'card_declined') return false;
  if (err.type === 'StripeInvalidRequestError') return false;
  if (err.code === 429 || err.type === 'StripeRateLimitError') return true;
  if (err.type === 'StripeConnectionError' || err.type === 'StripeAPIError') return true;
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') return true;
  if (err.response?.status >= 500) return true;
  return false;
}

/**
 * Execute an async function with exponential backoff retry.
 * @param {Function} fn - Async function to execute (no args; use closure)
 * @param {Object} opts - { maxAttempts, baseDelayMs, maxDelayMs, backoffMultiplier, shouldRetry }
 * @returns {Promise<*>} Result of fn()
 * @throws Last error if all attempts fail
 */
async function withRetry(fn, opts = {}) {
  const { maxAttempts, baseDelayMs, maxDelayMs, backoffMultiplier, shouldRetry: customShouldRetry } = { ...DEFAULT_OPTS, ...opts };
  const shouldRetry = customShouldRetry || defaultShouldRetry;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !shouldRetry(err)) throw err;
      const delay = Math.min(baseDelayMs * Math.pow(backoffMultiplier, attempt - 1), maxDelayMs);
      console.warn(`Retry attempt ${attempt}/${maxAttempts} failed:`, err.message, `Retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastError;
}

module.exports = { withRetry, sleep };
