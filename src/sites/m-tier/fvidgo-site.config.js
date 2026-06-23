import crawlFvidgoSite from "./fvidgo-site.js";

export default {
  key: "fvidgo.com",
  description: "Dung browser bot de nhap link Facebook Reel va bat link download video.",
  crawler: {
    mode: "browser",
    rateLimit: { concurrency: 1, delayMs: 3000 },
    retry: { maxAttempts: 1 },
    outputSchema: {
      type: "object",
      required: ["best_download"],
      fields: {
        url: "string",
        facebook_url: "string",
        downloads: "array"
      }
    },
    layout: { minItems: 1 }
  },
  crawl: crawlFvidgoSite
};
