export class BaseMetrics {
  increment(name, labels = {}) {
    throw new Error("Not implemented");
  }

  timing(name, value, labels = {}) {
    throw new Error("Not implemented");
  }

  gauge(name, value, labels = {}) {
    throw new Error("Not implemented");
  }
}
