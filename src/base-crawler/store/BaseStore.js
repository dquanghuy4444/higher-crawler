export class BaseStore {
  async save(job, parsed, response) {
    throw new Error("Not implemented");
  }

  async close() {
    throw new Error("Not implemented");
  }
}
