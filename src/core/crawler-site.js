import { classifyCrawlerError } from "./error-classifier.js";
import { logError, logEvent, logWarn } from "./logger.js";
import { saveOutput } from "./output-store.js";
import { withDomainRateLimit } from "./rate-limiter.js";
import { withRetry } from "./retry.js";
import { createVisitKey, isVisited, markVisited } from "./state-store.js";
import { validateOutput } from "./schema.js";

function countItems(data) {
  if (Array.isArray(data)) {
    return data.length;
  }

  if (Array.isArray(data?.items)) {
    return data.items.length;
  }

  if (Array.isArray(data?.results)) {
    return data.results.length;
  }

  return data ? 1 : 0;
}

function createValidationError(siteKey, errors) {
  const error = new Error(`Output schema validation failed for '${siteKey}'.`);
  error.statusCode = 500;
  error.details = { errors };
  error.retryable = false;
  error.errorCategory = "schema_validation_failed";
  return error;
}

function detectEmptyLayout(site, data) {
  const minItems = site.crawler?.layout?.minItems;

  if (typeof minItems !== "number") {
    return null;
  }

  const itemCount = countItems(data);
  if (itemCount >= minItems) {
    return null;
  }

  return {
    expected_min_items: minItems,
    item_count: itemCount
  };
}

export function defineSite(site) {
  const crawler = {
    mode: "http",
    rateLimit: {
      concurrency: 1,
      delayMs: 0
    },
    retry: {
      maxAttempts: 1,
      baseDelayMs: 500,
      maxDelayMs: 5000,
      jitterMs: 250
    },
    output: {
      enabled: true
    },
    ...site.crawler,
    rateLimit: {
      concurrency: 1,
      delayMs: 0,
      ...(site.crawler?.rateLimit || {})
    },
    retry: {
      maxAttempts: 1,
      baseDelayMs: 500,
      maxDelayMs: 5000,
      jitterMs: 250,
      ...(site.crawler?.retry || {})
    },
    output: {
      enabled: true,
      ...(site.crawler?.output || {})
    }
  };

  const wrapped = {
    ...site,
    crawler,
    async crawl(input = {}) {
      const startedAt = Date.now();
      const visitKey = createVisitKey(site.key, input);

      if ((input.resume === true || input.dedupe === true) && isVisited(site.key, input)) {
        logEvent("crawl_skipped_visited", {
          site: site.key,
          mode: crawler.mode,
          visit_key: visitKey
        });
        return {
          skipped: true,
          reason: "visited",
          site: site.key
        };
      }

      logEvent("crawl_start", {
        site: site.key,
        mode: crawler.mode,
        visit_key: visitKey,
        url: input.url || input.facebook_url || input.youtube_url || null
      });

      try {
        const data = await withDomainRateLimit(site.key, crawler.rateLimit, () =>
          withRetry(() => site.crawl(input), crawler.retry)
        );

        const validation = validateOutput(data, crawler.outputSchema);
        if (!validation.ok) {
          throw createValidationError(site.key, validation.errors);
        }

        const layoutIssue = detectEmptyLayout(wrapped, data);
        if (layoutIssue) {
          logWarn("layout_empty_or_changed", {
            site: site.key,
            ...layoutIssue
          });
        }

        const durationMs = Date.now() - startedAt;
        const itemCount = countItems(data);
        let output = null;

        if (crawler.output?.enabled !== false && input.save !== false) {
          output = saveOutput(site.key, data, {
            duration_ms: durationMs,
            item_count: itemCount,
            source_url: input.url || input.facebook_url || input.youtube_url || null
          });
        }

        markVisited(site.key, input, {
          item_count: itemCount,
          duration_ms: durationMs,
          output_file: output?.filePath || null
        });

        logEvent("crawl_done", {
          site: site.key,
          mode: crawler.mode,
          duration_ms: durationMs,
          item_count: itemCount,
          output_count: output?.count || 0,
          output_file: output?.filePath || null
        });

        return data;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const classification = classifyCrawlerError(error);
        logError("crawl_failed", {
          site: site.key,
          mode: crawler.mode,
          duration_ms: durationMs,
          category: error.errorCategory || classification.category,
          status: error.statusCode || classification.statusCode,
          retryable: error.retryable ?? classification.retryable,
          blocked: error.blocked || false,
          block_type: error.blockType || null,
          message: error.message
        });
        throw error;
      }
    }
  };

  return wrapped;
}
