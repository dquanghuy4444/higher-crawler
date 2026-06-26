export class BaseFetcher {
  async fetch(url, options = {}) {
    throw new Error("Not implemented");
  }

  async close() {
    throw new Error("Not implemented");
  }
}
