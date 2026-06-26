export class BaseRateLimiter {
  async acquire(domain, config) {
    throw new Error("Not implemented");
  }

  async close() {
    throw new Error("Not implemented");
  }
}
