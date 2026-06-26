import { BaseDedup } from "./BaseDedup.js";
import { createHash } from "node:crypto";

export class RedisDedup extends BaseDedup {
  constructor(redis, options = {}) {
    super();
    this.redis = redis;
    this.keyPrefix = options.keyPrefix || "dedup";
    this.ttl = options.ttl || 86400 * 7; // 7 days
  }

  async isSeen(url) {
    const key = this._key(url);
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  async markSeen(url, domain, metadata = {}) {
    const key = this._key(url);
    const value = JSON.stringify({
      url,
      domain,
      firstSeen: Date.now(),
      ...metadata
    });
    await this.redis.setex(key, this.ttl, value);
  }

  async close() {}

  _key(url) {
    const hash = createHash("sha256").update(url).digest("hex");
    return `${this.keyPrefix}:${hash}`;
  }
}
