import { BaseMetrics } from "./BaseMetrics.js";

/**
 * Prometheus-compatible metrics collector.
 * Expose /metrics endpoint dùng với prom-client.
 * Peer dependency: prom-client
 */
export class PrometheusMetrics extends BaseMetrics {
  constructor(options = {}) {
    super();
    this.register = options.register || null;
    this.client = null;
    this.metrics = new Map();
  }

  async _getClient() {
    if (this.client) return this.client;
    const promClient = await import("prom-client");
    this.client = promClient;
    if (!this.register) {
      this.register = new promClient.Registry();
    }
    return promClient;
  }

  async _getMetric(name, type, labels = []) {
    const key = `${type}:${name}`;
    if (this.metrics.has(key)) return this.metrics.get(key);

    const client = await this._getClient();
    let metric;

    switch (type) {
      case "counter":
        metric = new client.Counter({
          name,
          help: `Counter ${name}`,
          labelNames: labels,
          registers: [this.register]
        });
        break;
      case "gauge":
        metric = new client.Gauge({
          name,
          help: `Gauge ${name}`,
          labelNames: labels,
          registers: [this.register]
        });
        break;
      case "histogram":
        metric = new client.Histogram({
          name,
          help: `Histogram ${name}`,
          labelNames: labels,
          buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
          registers: [this.register]
        });
        break;
      default:
        throw new Error(`Unknown metric type: ${type}`);
    }

    this.metrics.set(key, metric);
    return metric;
  }

  async increment(name, labels = {}) {
    const metric = await this._getMetric(name, "counter", Object.keys(labels));
    metric.inc(labels);
  }

  async timing(name, value, labels = {}) {
    const metric = await this._getMetric(name, "histogram", Object.keys(labels));
    metric.observe(labels, value);
  }

  async gauge(name, value, labels = {}) {
    const metric = await this._getMetric(name, "gauge", Object.keys(labels));
    metric.set(labels, value);
  }

  async metrics() {
    const client = await this._getClient();
    return this.register.metrics();
  }

  async contentType() {
    const client = await this._getClient();
    return client.register.contentType;
  }
}
