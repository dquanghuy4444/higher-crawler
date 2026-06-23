import crawlCrunchbaseSite from "./crunchbase-site.js";

export default {
  key: "crunchbase.com",
  description: "Tim kiem va lay thong tin cong ty tu Crunchbase bang ten cong ty.",
  crawler: {
    mode: "browser",
    tlsFingerprint: "scrapling",
    rateLimit: { concurrency: 1, delayMs: 5000 },
    retry: { maxAttempts: 1 }
  },
  crawl: crawlCrunchbaseSite
};
