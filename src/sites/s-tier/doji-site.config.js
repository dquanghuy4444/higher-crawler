import { priceListSchema } from "../../config/schemas.js";
import crawlDojiSite from "./doji-site.js";

export default {
  key: "doji.vn",
  description: "Lay bang gia vang DOJI tu bang gia theo khu vuc.",
  crawler: {
    mode: "http",
    preferApi: true,
    rateLimit: { concurrency: 1, delayMs: 1000 },
    retry: { maxAttempts: 3 },
    outputSchema: priceListSchema,
    layout: { minItems: 1 }
  },
  crawl: crawlDojiSite
};
