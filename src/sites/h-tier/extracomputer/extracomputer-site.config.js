import { productSchema } from "../../../config/schemas.js";
import crawlExtracomputerSite from "./extracomputer-site.js";

export default {
  key: "extracomputer.de",
  description: "Lay thong tin san pham EXTRA Computer tu URL san pham.",
  crawler: {
    mode: "http",
    jsonLd: true,
    rateLimit: { concurrency: 1, delayMs: 1500 },
    retry: { maxAttempts: 2 },
    outputSchema: productSchema,
    layout: { minItems: 1 }
  },
  crawl: crawlExtracomputerSite
};
