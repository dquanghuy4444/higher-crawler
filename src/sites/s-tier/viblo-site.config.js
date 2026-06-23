import { articleSchema } from "../../config/schemas.js";
import crawlVibloSite from "./viblo-site.js";

export default {
  key: "viblo.asia",
  description: "Lay thong tin quan trong cua bai viet Viblo tu URL bai post.",
  crawler: {
    mode: "http",
    rateLimit: { concurrency: 1, delayMs: 1200 },
    retry: { maxAttempts: 2 },
    outputSchema: articleSchema,
    layout: { minItems: 1 }
  },
  crawl: crawlVibloSite
};
