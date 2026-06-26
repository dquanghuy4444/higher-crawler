import { BaseFetcher } from "./BaseFetcher.js";

/**
 * HTTP fetcher dùng curl_cffi (nếu có) để impersonate browser TLS/JA3/HTTP2.
 * Fallback về axios nếu curl_cffi không có.
 */
export class HttpFetcher extends BaseFetcher {
  constructor(options = {}) {
    super();
    this.defaultImpersonate = options.impersonate || "chrome";
    this.timeout = options.timeout || 30_000;
    this.maxRedirects = options.maxRedirects || 5;
    this.proxyRotator = options.proxyRotator || null;
    this._curl = null;
    this._axios = null;
  }

  async fetch(url, options = {}) {
    const impersonate = options.config?.impersonate || this.defaultImpersonate;
    let proxy = options.config?.proxy;

    if (this.proxyRotator && !proxy) {
      const rotated = await this.proxyRotator.getProxy({
        domain: options.domain,
        sessionId: options.sessionId
      });
      proxy = rotated?.url || proxy;
    }

    if (this._hasCurlCffi()) {
      return this._fetchWithCurl(url, impersonate, proxy);
    }

    return this._fetchWithAxios(url, proxy);
  }

  async _fetchWithCurl(url, impersonate, proxy) {
    const curl = await this._getCurlCffi();
    const response = await curl.get(url, {
      impersonate,
      timeout: this.timeout,
      proxy,
      follow_redirects: true,
      max_redirects: this.maxRedirects
    });

    return {
      url: response.url,
      status: response.status_code,
      headers: response.headers,
      body: response.text,
      contentType: response.headers?.get?.("content-type") || null
    };
  }

  async _fetchWithAxios(url, proxy) {
    const axios = await this._getAxios();
    const response = await axios.get(url, {
      timeout: this.timeout,
      maxRedirects: this.maxRedirects,
      proxy: proxy ? this._parseProxy(proxy) : undefined,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1"
      }
    });

    return {
      url: response.request?.res?.responseUrl || url,
      status: response.status,
      headers: response.headers,
      body: response.data,
      contentType: response.headers["content-type"] || null
    };
  }

  async close() {
    // curl_cffi session auto cleanup
  }

  _hasCurlCffi() {
    try {
      import.meta.resolve("curl_cffi");
      return true;
    } catch {
      return false;
    }
  }

  async _getCurlCffi() {
    if (this._curl) return this._curl;
    const { AsyncSession } = await import("curl_cffi");
    this._curl = new AsyncSession();
    return this._curl;
  }

  async _getAxios() {
    if (this._axios) return this._axios;
    const { default: axios } = await import("axios");
    this._axios = axios;
    return this._axios;
  }

  _parseProxy(proxy) {
    if (typeof proxy === "string") {
      const url = new URL(proxy);
      return {
        protocol: url.protocol.replace(":", ""),
        host: url.hostname,
        port: Number(url.port)
      };
    }
    return proxy;
  }
}
