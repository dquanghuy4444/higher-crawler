export class BaseProxyRotator {
  async getProxy(options = {}) {
    throw new Error("Not implemented");
  }

  async reportSuccess(proxy, options = {}) {
    // optional feedback
  }

  async reportFailure(proxy, error, options = {}) {
    // optional feedback
  }

  async close() {
    throw new Error("Not implemented");
  }
}
