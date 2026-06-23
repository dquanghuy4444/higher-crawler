import { priceListSchema } from "../../config/schemas.js";
import crawlBtmhSite from "./btmh-site.js";

export default {
  key: "baotinmanhhai.vn",
  description: "Lay lich su gia vang Bao Tin Manh Hai tu API chart.",
  crawler: {
    mode: "http",
    rateLimit: { concurrency: 1, delayMs: 1000 },
    retry: { maxAttempts: 3 },
    outputSchema: priceListSchema,
    layout: { minItems: 1 }
  },
  crawl: crawlBtmhSite
};
