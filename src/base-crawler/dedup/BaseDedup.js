export class BaseDedup {
  async isSeen(url, domain) {
    throw new Error("Not implemented");
  }

  async markSeen(url, domain, metadata = {}) {
    throw new Error("Not implemented");
  }

  async close() {
    throw new Error("Not implemented");
  }
}
