/**
 * Anti-bot handler: chọn fetcher phù hợp theo domain và escalation.
 * Mỗi fetcher là module độc lập, inject qua constructor.
 */
export class AntiBotHandler {
  constructor(options = {}) {
    this.fetchers = new Map();
    this.strategies = options.strategies || {};
    this.defaultStrategy = options.defaultStrategy || "http";
    this.proxyRotator = options.proxyRotator || null;
    this.metrics = options.metrics;
    this.logger = options.logger;
  }

  registerFetcher(name, fetcher) {
    this.fetchers.set(name, fetcher);
  }

  async fetch(url, options = {}) {
    const domain = options.domain;
    const domainConfig = options.config || {};
    const strategy = domainConfig.strategy || this.defaultStrategy;

    const fetcher = this.fetchers.get(strategy);
    if (!fetcher) {
      throw new Error(`No fetcher registered for strategy: ${strategy}`);
    }

    this.logger.debug({ url, strategy }, "Using anti-bot strategy");

    let currentProxy = null;
    if (this.proxyRotator) {
      currentProxy = await this.proxyRotator.getProxy({ domain, sessionId: options.sessionId });
      options = {
        ...options,
        config: { ...domainConfig, proxy: currentProxy?.url },
        _proxy: currentProxy
      };
    }

    try {
      const response = await fetcher.fetch(url, options);
      this.metrics?.increment("fetcher.success", { strategy, domain });
      if (this.proxyRotator && currentProxy) {
        await this.proxyRotator.reportSuccess(currentProxy, { domain });
      }
      return response;
    } catch (error) {
      this.metrics?.increment("fetcher.failure", { strategy, domain, error: error.name });
      if (this.proxyRotator && currentProxy) {
        await this.proxyRotator.reportFailure(currentProxy, error, { domain });
      }

      const escalation = this._escalate(strategy, error);
      if (escalation) {
        this.logger.warn({ url, from: strategy, to: escalation }, `Escalating strategy to ${escalation}`);
        const nextFetcher = this.fetchers.get(escalation);
        if (nextFetcher) {
          return nextFetcher.fetch(url, { ...options, config: { ...domainConfig, strategy: escalation } });
        }
      }

      throw error;
    }
  }

  _escalate(strategy, error) {
    if (!this._isBotDetected(error)) return null;

    const chain = ["http", "playwright", "puppeteer"];
    const index = chain.indexOf(strategy);
    if (index === -1 || index >= chain.length - 1) return null;

    return chain[index + 1];
  }

  _isBotDetected(error) {
    const msg = error.message?.toLowerCase() || "";
    const status = error.statusCode || error.status || 0;
    if (status === 403 || status === 429 || status === 503) return true;
    if (msg.includes("captcha")) return true;
    if (msg.includes("cloudflare")) return true;
    if (msg.includes("blocked")) return true;
    if (msg.includes("forbidden")) return true;
    if (msg.includes("challenge")) return true;
    return false;
  }

  async close() {
    await Promise.all([...this.fetchers.values()].map((f) => f.close?.().catch(() => {})));
  }
}
