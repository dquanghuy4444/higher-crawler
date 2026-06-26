/**
 * Queue interface. Mọi implementation phải implement các method này.
 */
export class BaseQueue {
  async push(job) {
    throw new Error("Not implemented");
  }

  async claim(options) {
    throw new Error("Not implemented");
  }

  async complete(job, result) {
    throw new Error("Not implemented");
  }

  async reschedule(job, delayMs) {
    throw new Error("Not implemented");
  }

  async fail(job, error) {
    throw new Error("Not implemented");
  }

  async size() {
    throw new Error("Not implemented");
  }

  async close() {
    throw new Error("Not implemented");
  }
}
