import { productSchema } from "../../config/schemas.js";
import crawlHorizontJobsSite from "./horizont-jobs-site.js";

export default {
  key: "horizont.jobs",
  description: "Lay thong tin job posting tu URL tren Horizont Jobs.",
  crawler: {
    mode: "http",
    jsonLd: true,
    rateLimit: { concurrency: 1, delayMs: 1200 },
    retry: { maxAttempts: 2 },
    outputSchema: productSchema,
    layout: { minItems: 1 }
  },
  crawl: crawlHorizontJobsSite
};
