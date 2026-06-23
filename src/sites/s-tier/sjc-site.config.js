import { priceListSchema } from "../../config/schemas.js";
import crawlSjcSite from "./sjc-site.js";

export default {
  key: "sjc.com.vn",
  description: "Lay bang gia vang SJC theo chi nhanh va loai vang.",
  crawler: {
    mode: "http",
    preferApi: true,
    rateLimit: { concurrency: 1, delayMs: 2000 },
    retry: { maxAttempts: 2 },
    outputSchema: priceListSchema,
    layout: { minItems: 1 }
  },
  crawl: crawlSjcSite
};
