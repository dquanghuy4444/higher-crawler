import { BaseProxyRotator } from "./BaseProxyRotator.js";

/**
 * Static proxy rotator: xoay vòng trong danh sách proxy cố định.
 * Hỗ trợ sticky mode (giữ proxy cho cùng session/domain).
 */
export class StaticProxyRotator extends BaseProxyRotator {
  constructor(options = {}) {
    super();
    this.proxies = this._normalize(options.proxies || []);
    this.mode = options.mode || "round_robin"; // round_robin | random | sticky
    this.stickyKey = options.stickyKey || "domain"; // domain | session
    this.currentIndex = 0;
    this.stickyMap = new Map();
    this.failureCounts = new Map();
    this.maxFailures = options.maxFailures || 3;
  }

  async getProxy(options = {}) {
    if (this.proxies.length === 0) return null;

    const key = this._getStickyKey(options);

    if (this.mode === "sticky" && this.stickyMap.has(key)) {
      const proxy = this.stickyMap.get(key);
      if (this.failureCounts.get(proxy) < this.maxFailures) {
        return this._formatProxy(proxy);
      }
    }

    let proxy;
    if (this.mode === "random") {
      const available = this.proxies.filter((p) => this.failureCounts.get(p) < this.maxFailures);
      proxy = available[Math.floor(Math.random() * available.length)] || this.proxies[0];
    } else {
      // round_robin
      const available = this.proxies.filter((p) => this.failureCounts.get(p) < this.maxFailures);
      if (available.length === 0) {
        // all proxies exhausted, reset
        this.failureCounts.clear();
        proxy = this.proxies[this.currentIndex % this.proxies.length];
      } else {
        proxy = available[this.currentIndex % available.length];
      }
      this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    }

    if (this.mode === "sticky") {
      this.stickyMap.set(key, proxy);
    }

    return this._formatProxy(proxy);
  }

  async reportSuccess(proxy, options = {}) {
    if (!proxy) return;
    const raw = this._toRaw(proxy);
    this.failureCounts.set(raw, 0);
  }

  async reportFailure(proxy, error, options = {}) {
    if (!proxy) return;
    const raw = this._toRaw(proxy);
    const count = (this.failureCounts.get(raw) || 0) + 1;
    this.failureCounts.set(raw, count);

    // If too many failures, remove sticky binding
    if (count >= this.maxFailures) {
      const key = this._getStickyKey(options);
      if (this.stickyMap.get(key) === raw) {
        this.stickyMap.delete(key);
      }
    }
  }

  async close() {}

  _normalize(proxies) {
    return proxies.map((p) => {
      if (typeof p === "string") return p;
      if (p.url) return p.url;
      const auth = p.username && p.password ? `${p.username}:${p.password}@` : "";
      const protocol = p.protocol || "http";
      return `${protocol}://${auth}${p.host}:${p.port}`;
    });
  }

  _formatProxy(proxy) {
    return {
      url: proxy,
      http: proxy,
      https: proxy
    };
  }

  _toRaw(proxy) {
    return typeof proxy === "string" ? proxy : proxy.url;
  }

  _getStickyKey(options) {
    if (this.stickyKey === "session") return options.sessionId || "default";
    return options.domain || "default";
  }
}
