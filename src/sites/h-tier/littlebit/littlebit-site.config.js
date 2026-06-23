import { productSchema } from "../../../config/schemas.js";
import crawlLittlebitSite from "./littlebit-site.js";

export default {
  key: "littlebit.de",
  description: "Lay thong tin san pham Littlebit tu URL san pham.",
  crawler: {
    mode: "http",
    jsonLd: true,
    rateLimit: { concurrency: 1, delayMs: 1500 },
    retry: { maxAttempts: 2 },
    outputSchema: productSchema,
    layout: { minItems: 1 }
  },
  crawl: crawlLittlebitSite
};
