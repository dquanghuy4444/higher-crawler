import { articleSchema } from "../../config/schemas.js";
import crawlDantriSite from "./dantri-site.js";

export default {
  key: "dantri.com.vn",
  description: "Lay thong tin quan trong cua bai viet Dantri tu URL bai bao.",
  crawler: {
    mode: "http",
    rateLimit: { concurrency: 1, delayMs: 1200 },
    retry: { maxAttempts: 2 },
    outputSchema: articleSchema,
    layout: { minItems: 1 }
  },
  crawl: crawlDantriSite
};
