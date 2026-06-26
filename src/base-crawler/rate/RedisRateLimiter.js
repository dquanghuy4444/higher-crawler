import { BaseRateLimiter } from "./BaseRateLimiter.js";
import { setTimeout } from "node:timers/promises";

/**
 * Token bucket rate limiter trên Redis, mỗi domain riêng biệt.
 */
export class RedisRateLimiter extends BaseRateLimiter {
  constructor(redis, options = {}) {
    super();
    this.redis = redis;
    this.defaultRate = options.defaultRate || { rate: 1, interval: 1000 };
    this.keyPrefix = options.keyPrefix || "rate";
    this.script = null;
  }

  async acquire(domain, config) {
    const rate = config?.rate || this.defaultRate.rate;
    const interval = config?.interval || this.defaultRate.interval;
    const tokens = 1;

    if (!this.script) {
      this.script = await this.redis.script("LOAD", this._luaScript());
    }

    const key = `${this.keyPrefix}:${domain}`;
    const now = Date.now();

    while (true) {
      const allowed = await this.redis.evalsha(
        this.script,
        1,
        key,
        rate,
        interval,
        now,
        tokens
      );

      if (allowed) return;

      const waitMs = Math.ceil(interval / rate);
      await setTimeout(waitMs);
    }
  }

  async close() {}

  _luaScript() {
    return `
      local key = KEYS[1]
      local rate = tonumber(ARGV[1])
      local interval = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      local tokens = tonumber(ARGV[4])

      local state = redis.call("hmget", key, "tokens", "last")
      local lastTokens = tonumber(state[1]) or rate
      local lastTime = tonumber(state[2]) or now

      local delta = math.max(0, now - lastTime)
      local newTokens = math.min(rate, lastTokens + (delta * rate / interval))

      if newTokens >= tokens then
        newTokens = newTokens - tokens
        redis.call("hmset", key, "tokens", newTokens, "last", now)
        redis.call("pexpire", key, interval * 2)
        return 1
      else
        redis.call("hmset", key, "tokens", newTokens, "last", now)
        redis.call("pexpire", key, interval * 2)
        return 0
      end
    `;
  }
}
