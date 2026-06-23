import crawlYtdownSite from "./ytdown-site.js";

export default {
  key: "app.ytdown.to",
  description: "Dung persistent browser profile de nhap link YouTube va lay link download.",
  crawler: {
    mode: "browser",
    session: { persistent: true },
    tlsFingerprint: "camoufox",
    rateLimit: { concurrency: 1, delayMs: 5000 },
    retry: { maxAttempts: 1 }
  },
  crawl: crawlYtdownSite
};
