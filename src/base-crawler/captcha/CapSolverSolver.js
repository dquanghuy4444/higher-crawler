import { BaseCaptchaSolver } from "./BaseCaptchaSolver.js";

/**
 * CapSolver.com solver.
 * Hỗ trợ: reCAPTCHA, hCaptcha, Cloudflare Turnstile, DataDome, AWS WAF.
 */
export class CapSolverSolver extends BaseCaptchaSolver {
  constructor(options = {}) {
    super();
    this.apiKey = options.apiKey || process.env.CAPSOLVER_API_KEY;
    this.baseUrl = options.baseUrl || "https://api.capsolver.com";
    this.defaultTimeout = options.defaultTimeout || 120_000;
    this.pollingInterval = options.pollingInterval || 5_000;
  }

  async solve(request, options = {}) {
    const task = this._buildTask(request, options);
    const taskId = await this._createTask(task);
    return this._pollResult(taskId, options.timeout || this.defaultTimeout);
  }

  async getBalance() {
    const response = await fetch(`${this.baseUrl}/getBalance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: this.apiKey })
    });
    return response.json();
  }

  async close() {}

  _buildTask(request, options) {
    const { type } = request;
    const base = {
      clientKey: this.apiKey,
      appId: options.appId
    };

    switch (type) {
      case "recaptcha_v2":
        return {
          ...base,
          task: {
            type: "ReCaptchaV2TaskProxyLess",
            websiteURL: request.url,
            websiteKey: request.siteKey,
            isInvisible: request.invisible || false
          }
        };
      case "recaptcha_v3":
        return {
          ...base,
          task: {
            type: "ReCaptchaV3TaskProxyLess",
            websiteURL: request.url,
            websiteKey: request.siteKey,
            pageAction: request.action,
            minScore: request.minScore || 0.3
          }
        };
      case "hcaptcha":
        return {
          ...base,
          task: {
            type: "HCaptchaTaskProxyLess",
            websiteURL: request.url,
            websiteKey: request.siteKey
          }
        };
      case "turnstile":
        return {
          ...base,
          task: {
            type: "AntiTurnstileTaskProxyLess",
            websiteURL: request.url,
            websiteKey: request.siteKey
          }
        };
      case "datadome":
        return {
          ...base,
          task: {
            type: "AntiDataDomeTask",
            websiteURL: request.url,
            captchaUrl: request.captchaUrl,
            proxy: request.proxy,
            userAgent: request.userAgent
          }
        };
      default:
        throw new Error(`Unsupported captcha type: ${type}`);
    }
  }

  async _createTask(task) {
    const response = await fetch(`${this.baseUrl}/createTask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(task)
    });

    const data = await response.json();
    if (data.errorId !== 0) {
      throw new Error(`CapSolver error: ${data.errorDescription}`);
    }

    return data.taskId;
  }

  async _pollResult(taskId, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const response = await fetch(`${this.baseUrl}/getTaskResult`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: this.apiKey, taskId })
      });

      const data = await response.json();
      if (data.errorId !== 0) {
        throw new Error(`CapSolver error: ${data.errorDescription}`);
      }

      if (data.status === "ready") {
        return {
          token: data.solution?.gRecaptchaResponse || data.solution?.token,
          cookies: data.solution?.cookies,
          userAgent: data.solution?.userAgent,
          taskId
        };
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollingInterval));
    }

    throw new Error("CapSolver solve timeout");
  }
}
