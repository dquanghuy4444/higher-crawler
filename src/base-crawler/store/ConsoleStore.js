import { BaseStore } from "./BaseStore.js";

export class ConsoleStore extends BaseStore {
  async save(job, parsed, response) {
    console.log("[STORE]", {
      jobId: job.id,
      url: job.url,
      domain: job.domain,
      parsed: parsed?.title || parsed
    });
  }

  async close() {}
}
