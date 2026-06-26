import { BaseQueue } from "./BaseQueue.js";

/**
 * Redis-backed queue dùng sorted sets.
 * - Pending: zadd crawl:pending:{domain} score=priority member=jobId
 * - Jobs hash: hset crawl:job:{jobId} ...
 * - Processing: zadd crawl:processing:{domain} score=claimedUntil member=jobId
 * - Delayed: zadd crawl:delayed:{domain} score=scheduledAt member=jobId
 * - Failed: lpush crawl:failed:{domain} jobId
 */
export class RedisQueue extends BaseQueue {
  constructor(redis, options = {}) {
    super();
    this.redis = redis;
    this.keyPrefix = options.keyPrefix || "crawl";
    this.visibilityTimeout = options.visibilityTimeout || 120_000;
  }

  async push(job) {
    const jobKey = this._jobKey(job.id);
    const domain = job.domain;
    const score = job.priority || 0;
    const scheduledAt = job.scheduledAt || Date.now();

    await this.redis.hmset(jobKey, {
      ...this._serializeJob(job),
      status: "pending",
      scheduledAt: String(scheduledAt)
    });

    await this.redis.zadd(this._key("pending", domain), score, job.id);
  }

  async claim({ workerId, visibilityTimeout }) {
    const visibility = visibilityTimeout || this.visibilityTimeout;
    const now = Date.now();

    // 1. Promote delayed jobs
    const domains = await this._getDomains();
    for (const domain of domains) {
      const delayedKey = this._key("delayed", domain);
      const ready = await this.redis.zrangebyscore(delayedKey, 0, now);
      if (ready.length) {
        await this.redis.zrem(delayedKey, ...ready);
        const scores = await Promise.all(
          ready.map(async (id) => {
            const priority = await this.redis.hget(this._jobKey(id), "priority");
            return { id, score: Number(priority) || 0 };
          })
        );
        const args = scores.flatMap((s) => [s.score, s.id]);
        if (args.length) await this.redis.zadd(this._key("pending", domain), ...args);
      }
    }

    // 2. Claim highest priority job across all domains
    for (const domain of domains) {
      const pending = await this.redis.zrevrange(this._key("pending", domain), 0, 0);
      if (!pending.length) continue;

      const jobId = pending[0];
      const removed = await this.redis.zrem(this._key("pending", domain), jobId);
      if (!removed) continue; // another worker claimed it

      const claimedUntil = now + visibility;
      await this.redis.zadd(this._key("processing", domain), claimedUntil, jobId);
      await this.redis.hmset(this._jobKey(jobId), {
        status: "processing",
        claimedBy: workerId,
        claimedUntil: String(claimedUntil)
      });

      const data = await this.redis.hgetall(this._jobKey(jobId));
      return this._deserializeJob(data);
    }

    return null;
  }

  async complete(job, result) {
    const domain = job.domain;
    await this.redis.zrem(this._key("processing", domain), job.id);
    await this.redis.hmset(this._jobKey(job.id), {
      status: "done",
      completedAt: String(Date.now()),
      result: JSON.stringify(result || {})
    });
  }

  async reschedule(job, delayMs) {
    const domain = job.domain;
    const scheduledAt = Date.now() + delayMs;
    await this.redis.zrem(this._key("processing", domain), job.id);
    await this.redis.zadd(this._key("delayed", domain), scheduledAt, job.id);
    await this.redis.hmset(this._jobKey(job.id), {
      status: "pending",
      retryCount: String(job.retryCount || 0),
      scheduledAt: String(scheduledAt)
    });
  }

  async fail(job, error) {
    const domain = job.domain;
    await this.redis.zrem(this._key("processing", domain), job.id);
    await this.redis.lpush(this._key("failed", domain), job.id);
    await this.redis.hmset(this._jobKey(job.id), {
      status: "failed",
      failedAt: String(Date.now()),
      error: error.message
    });
  }

  async size() {
    const domains = await this._getDomains();
    let total = 0;
    for (const domain of domains) {
      const [pending, processing, delayed] = await Promise.all([
        this.redis.zcard(this._key("pending", domain)),
        this.redis.zcard(this._key("processing", domain)),
        this.redis.zcard(this._key("delayed", domain))
      ]);
      total += pending + processing + delayed;
    }
    return total;
  }

  async close() {
    // Keep Redis connection alive for other components
  }

  async _getDomains() {
    // Scan for pending domains
    const keys = await this.redis.keys(`${this.keyPrefix}:pending:*`);
    return keys.map((k) => k.replace(`${this.keyPrefix}:pending:`, ""));
  }

  _key(type, domain) {
    return `${this.keyPrefix}:${type}:${domain}`;
  }

  _jobKey(id) {
    return `${this.keyPrefix}:job:${id}`;
  }

  _serializeJob(job) {
    return {
      id: job.id,
      url: job.url,
      domain: job.domain,
      priority: String(job.priority || 0),
      depth: String(job.depth || 0),
      retryCount: String(job.retryCount || 0),
      maxRetries: String(job.maxRetries || 3),
      payload: JSON.stringify(job.payload || {}),
      scheduledAt: String(job.scheduledAt || Date.now())
    };
  }

  _deserializeJob(data) {
    return {
      id: data.id,
      url: data.url,
      domain: data.domain,
      priority: Number(data.priority),
      depth: Number(data.depth),
      retryCount: Number(data.retryCount),
      maxRetries: Number(data.maxRetries),
      payload: JSON.parse(data.payload || "{}"),
      status: data.status,
      claimedBy: data.claimedBy,
      claimedUntil: data.claimedUntil ? Number(data.claimedUntil) : null,
      scheduledAt: data.scheduledAt ? Number(data.scheduledAt) : null,
      result: data.result ? JSON.parse(data.result) : null,
      error: data.error
    };
  }
}
