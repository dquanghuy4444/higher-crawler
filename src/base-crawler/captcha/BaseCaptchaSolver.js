export class BaseCaptchaSolver {
  async solve(imageOrSiteKey, options = {}) {
    throw new Error("Not implemented");
  }

  async getBalance() {
    throw new Error("Not implemented");
  }

  async close() {
    throw new Error("Not implemented");
  }
}
