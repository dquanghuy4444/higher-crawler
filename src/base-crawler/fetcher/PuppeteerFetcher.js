import { BaseFetcher } from "./BaseFetcher.js";
import { setTimeout } from "node:timers/promises";

/**
 * Puppeteer fetcher với stealth args.
 * Dùng khi Playwright bị detect hoặc cần Chrome-specific behavior.
 */
export class PuppeteerFetcher extends BaseFetcher {
  constructor(options = {}) {
    super();
    this.executablePath = options.executablePath || process.env.CHROME_EXECUTABLE;
    this.headless = options.headless ?? true;
    this.timeout = options.timeout || 30_000;
    this.waitUntil = options.waitUntil || "networkidle2";
    this.proxy = options.proxy;
    this.proxyRotator = options.proxyRotator || null;
    this.userAgent = options.userAgent;
    this.viewport = options.viewport || { width: 1920, height: 1080 };
    this.browser = null;
    this.puppeteer = null;
  }

  async fetch(url, options = {}) {
    const puppeteer = await this._getPuppeteer();
    const config = options.config || {};
    const domain = options.domain;

    let proxy = config.proxy || this.proxy;
    if (this.proxyRotator && !proxy) {
      const rotated = await this.proxyRotator.getProxy({ domain, sessionId: options.sessionId });
      proxy = rotated?.url || proxy;
    }

    if (!this.browser) {
      this.browser = await this._launchBrowser(puppeteer, config, proxy);
    }

    const page = await this.browser.newPage();
    try {
      await this._applyStealth(page);
      await page.setViewport(this.viewport);
      await page.setUserAgent(this.userAgent || this._getRandomUserAgent());
      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9"
      });

      const response = await page.goto(url, {
        waitUntil: this.waitUntil,
        timeout: this.timeout
      });

      await this._humanDelay(1000, 3000);
      await this._randomScroll(page);

      const body = await page.content();
      const finalUrl = page.url();
      const headers = response?.headers() || {};
      const status = response?.status() || 200;

      return {
        url: finalUrl,
        status,
        headers,
        body,
        contentType: headers["content-type"] || null
      };
    } finally {
      await page.close();
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async _getPuppeteer() {
    if (this.puppeteer) return this.puppeteer;
    const puppeteer = await import("puppeteer-core");
    this.puppeteer = puppeteer.default || puppeteer;
    return this.puppeteer;
  }

  async _launchBrowser(puppeteer, config, proxy) {
    const args = [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-site-isolation-trials",
      "--disable-web-security",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--window-size=1920,1080",
      "--start-maximized",
      "--hide-scrollbars"
    ];

    if (proxy) {
      args.push(`--proxy-server=${proxy}`);
    }

    return puppeteer.launch({
      headless: this.headless,
      executablePath: config.executablePath || this.executablePath,
      args,
      ignoreDefaultArgs: ["--enable-automation"]
    });
  }

  async _applyStealth(page) {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined
      });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5]
      });
      window.chrome = { runtime: {} };
      Object.defineProperty(window, "chrome", {
        get: () => ({ runtime: {} })
      });
    });
  }

  async _randomScroll(page) {
    try {
      const height = await page.evaluate(() => document.body.scrollHeight);
      const steps = Math.floor(Math.random() * 3) + 1;
      for (let i = 1; i <= steps; i++) {
        const y = Math.floor((height / steps) * i);
        await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
        await this._humanDelay(300, 800);
      }
    } catch {
      // ignore
    }
  }

  async _humanDelay(min, max) {
    await setTimeout(Math.floor(Math.random() * (max - min + 1)) + min);
  }

  _getRandomUserAgent() {
    const uas = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0"
    ];
    return uas[Math.floor(Math.random() * uas.length)];
  }
}
