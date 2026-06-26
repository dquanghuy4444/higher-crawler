import { BaseMetrics } from "./BaseMetrics.js";

export class ConsoleMetrics extends BaseMetrics {
  constructor(logger = console) {
    super();
    this.logger = logger;
    this.counts = new Map();
  }

  increment(name, labels = {}) {
    const key = this._key(name, labels);
    this.counts.set(key, (this.counts.get(key) || 0) + 1);
    this.logger.debug({ metric: name, labels, count: this.counts.get(key) }, "Metric increment");
  }

  timing(name, value, labels = {}) {
    this.logger.debug({ metric: name, value, labels }, "Metric timing");
  }

  gauge(name, value, labels = {}) {
    this.logger.debug({ metric: name, value, labels }, "Metric gauge");
  }

  _key(name, labels) {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return labelStr ? `${name}:{${labelStr}}` : name;
  }
}
