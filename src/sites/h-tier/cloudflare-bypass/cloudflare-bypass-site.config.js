import crawlCloudflareBypassSite from "./cloudflare-bypass-site.js";

export default {
  key: "cloudflare-bypass",
  description: "Mo URL bang engine anti-detect duoc chon de debug Cloudflare clearance.",
  crawler: {
    mode: "browser",
    session: { persistent: true },
    tlsFingerprint: "scrapling|botasaurus|seleniumbase-cdp",
    rateLimit: { concurrency: 1, delayMs: 3000 },
    retry: { maxAttempts: 1 },
    outputSchema: {
      type: "object",
      required: ["ok"],
      fields: {
        ok: "boolean"
      }
    }
  },
  crawl: crawlCloudflareBypassSite
};
