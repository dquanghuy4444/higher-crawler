import { classifyCrawlerError } from "./error-classifier.js";
import { logWarn } from "./logger.js";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function backoffDelayMs(attempt, options = {}) {
  const baseMs = Number(options.baseDelayMs || 500);
  const maxMs = Number(options.maxDelayMs || 10000);
  const jitterMs = Math.floor(Math.random() * Number(options.jitterMs || 250));

  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1)) + jitterMs;
}

export async function withRetry(task, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 1));
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task({ attempt });
    } catch (error) {
      lastError = error;
      const classification = classifyCrawlerError(error);

      if (!classification.retryable || attempt >= maxAttempts) {
        error.retryable = classification.retryable;
        error.errorCategory = classification.category;
        throw error;
      }

      const delayMs = backoffDelayMs(attempt, options);
      logWarn("crawl_retry_scheduled", {
        attempt,
        next_attempt: attempt + 1,
        delay_ms: delayMs,
        category: classification.category,
        status: classification.statusCode,
        message: error.message
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}
