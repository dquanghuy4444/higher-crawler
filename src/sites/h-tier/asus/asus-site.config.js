import { productSchema } from "../../../config/schemas.js";
import crawlAsusSite from "./asus-site.js";

export default {
  key: "asus.com",
  description: "Lay thong tin san pham ASUS tu URL san pham.",
  crawler: {
    mode: "http",
    jsonLd: true,
    rateLimit: { concurrency: 1, delayMs: 1500 },
    retry: { maxAttempts: 2 },
    outputSchema: productSchema,
    layout: { minItems: 1 }
  },
  crawl: crawlAsusSite
};
