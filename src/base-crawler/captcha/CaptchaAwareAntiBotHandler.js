import { AntiBotHandler } from "../anti-bot/AntiBotHandler.js";

/**
 * AntiBotHandler mở rộng: tự động phát hiện CAPTCHA và gọi solver.
 * Kết hợp với browser fetcher để inject token/cookie sau khi solve.
 */
export class CaptchaAwareAntiBotHandler extends AntiBotHandler {
  constructor(options = {}) {
    super(options);
    this.captchaSolver = options.captchaSolver || null;
    this.captchaSelectors = options.captchaSelectors || {
      recaptcha: "[data-sitekey], .g-recaptcha",
      hcaptcha: ".h-captcha",
      turnstile: "[data-sitekey].cf-turnstile, .cf-turnstile",
      image: "img[src*='captcha'], .captcha-image"
    };
  }

  async fetch(url, options = {}) {
    // Thử fetch bình thường trước
    try {
      return await super.fetch(url, options);
    } catch (error) {
      // Nếu có CAPTCHA và solver được cấu hình, solve rồi retry
      if (this.captchaSolver && this._isCaptchaError(error)) {
        this.logger.warn({ url, error: error.message }, "CAPTCHA detected, attempting solve");
        const captchaRequest = await this._detectCaptchaType(url, options);
        if (captchaRequest) {
          const solution = await this.captchaSolver.solve(captchaRequest);
          return this._applySolution(url, options, solution);
        }
      }
      throw error;
    }
  }

  _isCaptchaError(error) {
    const msg = error.message?.toLowerCase() || "";
    return (
      msg.includes("captcha") ||
      msg.includes("recaptcha") ||
      msg.includes("hcaptcha") ||
      msg.includes("turnstile") ||
      msg.includes("challenge")
    );
  }

  async _detectCaptchaType(url, options) {
    // Use playwright/puppeteer to inspect page and find captcha
    const browserFetcher = this.fetchers.get("playwright") || this.fetchers.get("puppeteer");
    if (!browserFetcher) return null;

    const response = await browserFetcher.fetch(url, options);
    const html = response.body || "";

    // Simple detection via HTML markers
    if (html.includes("data-sitekey") && html.includes("g-recaptcha")) {
      const siteKey = this._extractSiteKey(html, "g-recaptcha");
      return { type: "recaptcha_v2", url, siteKey };
    }
    if (html.includes("h-captcha")) {
      const siteKey = this._extractSiteKey(html, "h-captcha");
      return { type: "hcaptcha", url, siteKey };
    }
    if (html.includes("cf-turnstile")) {
      const siteKey = this._extractSiteKey(html, "cf-turnstile");
      return { type: "turnstile", url, siteKey };
    }

    return null;
  }

  _extractSiteKey(html, marker) {
    const regex = new RegExp(`data-sitekey=["']([^"']+)["']`, "i");
    const match = html.match(regex);
    return match?.[1] || null;
  }

  async _applySolution(url, options, solution) {
    // Retry with token using browser fetcher
    const browserFetcher = this.fetchers.get("playwright") || this.fetchers.get("puppeteer");
    if (!browserFetcher) {
      // HTTP retry is not enough for token-based captcha
      throw new Error("No browser fetcher available to apply captcha solution");
    }

    this.logger.info({ url, taskId: solution.taskId }, "Applying CAPTCHA solution");

    // Inject token then navigate
    return browserFetcher.fetch(url, {
      ...options,
      captchaToken: solution.token,
      captchaCookies: solution.cookies
    });
  }
}
