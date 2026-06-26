import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

/**
 * Crawler orchestrator.
 * Kết nối các module độc lập: Queue, RateLimiter, Dedup, Fetcher, SelectorEngine, Store, Metrics.
 * Không phụ thuộc vào implementation cụ thể — chỉ gọi interface.
 */
export class Crawler {
  constructor(options) {
    this.id = options.id || randomUUID();
    this.queue = options.queue;
    this.rateLimiter = options.rateLimiter;
    this.dedup = options.dedup;
    this.fetcher = options.fetcher;
    this.selectorEngine = options.selectorEngine;
    this.store = options.store;
    this.metrics = options.metrics;
    this.logger = options.logger;
    this.config = options.config || {};
    this.concurrency = options.concurrency || 3;
    this.visibilityTimeout = options.visibilityTimeout || 120_000;
    this.maxRetries = options.maxRetries || 3;
    this.running = false;
    this.workers = new Set();
  }

  async start() {
    this.running = true;
    this.logger.info({ crawlerId: this.id }, "Crawler started");

    const workers = Array.from({ length: this.concurrency }, () => this._workerLoop());
    await Promise.all(workers);
  }

  async stop() {
    this.running = false;
    this.logger.info({ crawlerId: this.id }, "Crawler stopping, waiting for workers...");
    await Promise.all([...this.workers].map((promise) => promise.catch(() => {})));
  }

  async schedule(url, options = {}) {
    const job = {
      id: options.id || randomUUID(),
      url,
      domain: options.domain || this._extractDomain(url),
      priority: options.priority ?? 0,
      depth: options.depth ?? 0,
      retryCount: 0,
      maxRetries: options.maxRetries ?? this.maxRetries,
      payload: options.payload || {},
      status: "pending",
      scheduledAt: Date.now(),
      ...options
    };

    await this.queue.push(job);
    this.logger.debug({ jobId: job.id, url }, "Job scheduled");
    return job;
  }

  async _workerLoop() {
    const workerPromise = (async () => {
      while (this.running) {
        try {
          const job = await this.queue.claim({
            workerId: this.id,
            visibilityTimeout: this.visibilityTimeout
          });

          if (!job) {
            await setTimeout(1000);
            continue;
          }

          await this._processJob(job);
        } catch (error) {
          this.logger.error({ error: error.message }, "Worker loop error");
          await setTimeout(1000);
        }
      }
    })();

    this.workers.add(workerPromise);
    await workerPromise;
    this.workers.delete(workerPromise);
  }

  async _processJob(job) {
    const start = Date.now();
    const domainConfig = this.config.domains?.[job.domain] || {};

    try {
      // 1. Deduplication
      const isDuplicate = await this.dedup.isSeen(job.url, job.domain);
      if (isDuplicate) {
        this.logger.debug({ jobId: job.id, url: job.url }, "Duplicate URL skipped");
        await this.queue.complete(job, { skipped: true });
        this.metrics.increment("crawl.skipped", { domain: job.domain });
        return;
      }
      await this.dedup.markSeen(job.url, job.domain);

      // 2. Rate limiting
      await this.rateLimiter.acquire(job.domain, domainConfig.rate);

      // 3. Fetch
      const response = await this.fetcher.fetch(job.url, {
        domain: job.domain,
        config: domainConfig
      });

      // 4. Parse
      const parsed = await this.selectorEngine.parse(response, job.domain);

      // 5. Store result
      await this.store.save(job, parsed, response);

      // 6. Complete job
      await this.queue.complete(job, { parsed });

      this.metrics.timing("crawl.duration", Date.now() - start, { domain: job.domain });
      this.metrics.increment("crawl.success", { domain: job.domain });
      this.logger.info({ jobId: job.id, url: job.url, duration: Date.now() - start }, "Crawl success");
    } catch (error) {
      await this._handleFailure(job, error, domainConfig);
    }
  }

  async _handleFailure(job, error, domainConfig) {
    job.retryCount = (job.retryCount || 0) + 1;
    const isRetryable = job.retryCount < job.maxRetries && this._isRetryableError(error);

    this.logger.warn({
      jobId: job.id,
      url: job.url,
      error: error.message,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries
    }, "Crawl failed");

    this.metrics.increment("crawl.failure", {
      domain: job.domain,
      errorType: error.name || "Unknown"
    });

    if (isRetryable) {
      const delay = this._calculateBackoff(job.retryCount, domainConfig);
      await this.queue.reschedule(job, delay);
      this.metrics.increment("crawl.retry", { domain: job.domain });
    } else {
      await this.queue.fail(job, error);
      this.metrics.increment("crawl.dead_letter", { domain: job.domain });
    }
  }

  _isRetryableError(error) {
    const retryable = [
      "ETIMEDOUT",
      "ECONNRESET",
      "ENOTFOUND",
      "ECONNREFUSED",
      "EAI_AGAIN"
    ];
    if (retryable.includes(error.code)) return true;
    if (error.statusCode === 429 || error.statusCode === 503) return true;
    if (error.message?.toLowerCase().includes("timeout")) return true;
    return false;
  }

  _calculateBackoff(retryCount, domainConfig) {
    const base = domainConfig.baseDelay || 1000;
    const max = domainConfig.maxDelay || 60_000;
    const delay = Math.min(base * 2 ** retryCount, max);
    const jitter = Math.random() * 0.3 * delay;
    return delay + jitter;
  }

  _extractDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return "unknown";
    }
  }
}
