import { BaseFetcher } from "./BaseFetcher.js";
import { setTimeout } from "node:timers/promises";

/**
 * Playwright fetcher với stealth args và human-like behavior.
 * Phù hợp cho Cloudflare Turnstile, DataDome, PerimeterX.
 */
export class PlaywrightFetcher extends BaseFetcher {
  constructor(options = {}) {
    super();
    this.executablePath = options.executablePath || process.env.CHROME_EXECUTABLE;
    this.headless = options.headless ?? true;
    this.timeout = options.timeout || 30_000;
    this.waitUntil = options.waitUntil || "networkidle";
    this.proxy = options.proxy;
    this.proxyRotator = options.proxyRotator || null;
    this.userAgent = options.userAgent;
    this.viewport = options.viewport || { width: 1920, height: 1080 };
    this.browser = null;
    this.playwright = null;
  }

  async fetch(url, options = {}) {
    const pw = await this._getPlaywright();
    const config = options.config || {};
    const domain = options.domain;

    let proxy = config.proxy || this.proxy;
    if (this.proxyRotator && !proxy) {
      const rotated = await this.proxyRotator.getProxy({ domain, sessionId: options.sessionId });
      proxy = rotated?.url || proxy;
    }

    if (!this.browser) {
      this.browser = await this._launchBrowser(pw, config);
    }

    const context = await this.browser.newContext({
      viewport: this.viewport,
      userAgent: this.userAgent || this._getRandomUserAgent(),
      proxy: proxy ? this._parseProxyUrl(proxy) : undefined,
      locale: "en-US",
      timezoneId: "America/New_York",
      permissions: ["notifications"]
    });

    try {
      const page = await context.newPage();
      await this._applyStealth(page);

      const response = await page.goto(url, {
        waitUntil: this.waitUntil,
        timeout: this.timeout
      });

      // Wait a bit for lazy JS challenges
      await this._humanDelay(1000, 3000);
      await this._randomScroll(page);

      const body = await page.content();
      const finalUrl = page.url();
      const headers = response?.headers() || {};
      const status = response?.status() || 200;

      await page.close();

      return {
        url: finalUrl,
        status,
        headers,
        body,
        contentType: headers["content-type"] || null
      };
    } finally {
      await context.close();
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async _getPlaywright() {
    if (this.playwright) return this.playwright;
    const { chromium } = await import("playwright-core");
    this.playwright = chromium;
    return chromium;
  }

  async _launchBrowser(pw, config) {
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

    return pw.launch({
      headless: this.headless,
      executablePath: config.executablePath || this.executablePath,
      args,
      ignoreDefaultArgs: ["--enable-automation"]
    });
  }

  async _applyStealth(page) {
    // Override navigator.webdriver
    await page.addInitScript(() => {
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
      // ignore scroll errors
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

  _parseProxyUrl(proxy) {
    const url = new URL(proxy);
    const username = url.username || undefined;
    const password = url.password || undefined;
    return {
      server: `${url.protocol}//${url.hostname}:${url.port}`,
      username,
      password
    };
  }
}
