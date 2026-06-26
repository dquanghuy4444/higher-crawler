import { BaseCaptchaSolver } from "./BaseCaptchaSolver.js";

/**
 * 2captcha.com solver.
 * Hỗ trợ: reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile, image captcha.
 */
export class TwoCaptchaSolver extends BaseCaptchaSolver {
  constructor(options = {}) {
    super();
    this.apiKey = options.apiKey || process.env.TWOCAPTCHA_API_KEY;
    this.baseUrl = options.baseUrl || "https://2captcha.com";
    this.defaultTimeout = options.defaultTimeout || 120_000;
    this.pollingInterval = options.pollingInterval || 5_000;
  }

  async solve(request, options = {}) {
    const { type } = request;
    const task = this._buildTask(request, options);
    const taskId = await this._createTask(task);
    return this._pollResult(taskId, options.timeout || this.defaultTimeout);
  }

  async getBalance() {
    const url = `${this.baseUrl}/res.php?key=${this.apiKey}&action=getbalance&json=1`;
    const response = await fetch(url);
    return response.json();
  }

  async close() {}

  _buildTask(request, options) {
    const { type } = request;
    const base = {
      key: this.apiKey,
      json: 1,
      soft_id: options.softId || 0
    };

    switch (type) {
      case "recaptcha_v2":
        return {
          ...base,
          method: "userrecaptcha",
          googlekey: request.siteKey,
          pageurl: request.url,
          invisible: request.invisible ? 1 : 0
        };
      case "recaptcha_v3":
        return {
          ...base,
          method: "userrecaptcha",
          googlekey: request.siteKey,
          pageurl: request.url,
          version: "v3",
          action: request.action,
          min_score: request.minScore || 0.3
        };
      case "hcaptcha":
        return {
          ...base,
          method: "hcaptcha",
          sitekey: request.siteKey,
          pageurl: request.url
        };
      case "turnstile":
        return {
          ...base,
          method: "turnstile",
          sitekey: request.siteKey,
          pageurl: request.url,
          data: request.data,
          pagedata: request.pageData
        };
      case "image":
        return {
          ...base,
          method: "base64",
          body: request.base64
        };
      default:
        throw new Error(`Unsupported captcha type: ${type}`);
    }
  }

  async _createTask(task) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(task)) {
      if (value !== undefined && value !== null) {
        params.append(key, value);
      }
    }

    const response = await fetch(`${this.baseUrl}/in.php`, {
      method: "POST",
      body: params.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    const text = await response.text();
    const data = JSON.parse(text);

    if (data.status !== 1) {
      throw new Error(`2captcha error: ${data.request}`);
    }

    return data.request;
  }

  async _pollResult(taskId, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const response = await fetch(
        `${this.baseUrl}/res.php?key=${this.apiKey}&action=get&id=${taskId}&json=1`
      );
      const data = await response.json();

      if (data.status === 1) {
        return { token: data.request, taskId };
      }

      if (data.request !== "CAPCHA_NOT_READY") {
        throw new Error(`2captcha solve error: ${data.request}`);
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollingInterval));
    }

    throw new Error("2captcha solve timeout");
  }
}
