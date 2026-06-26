import { BaseDedup } from "./BaseDedup.js";

export class MemoryDedup extends BaseDedup {
  constructor() {
    super();
    this.seen = new Set();
  }

  async isSeen(url) {
    return this.seen.has(url);
  }

  async markSeen(url) {
    this.seen.add(url);
  }

  async close() {}
}
