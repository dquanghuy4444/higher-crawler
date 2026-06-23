import { productSchema } from "../../config/schemas.js";
import crawlLazadaSite from "./lazada-site.js";

export default {
  key: "lazada.vn",
  description: "Lay thong tin san pham Lazada tu URL san pham.",
  crawler: {
    mode: "http",
    rateLimit: { concurrency: 1, delayMs: 2000 },
    retry: { maxAttempts: 2 },
    outputSchema: productSchema,
    layout: { minItems: 1 }
  },
  crawl: crawlLazadaSite
};
