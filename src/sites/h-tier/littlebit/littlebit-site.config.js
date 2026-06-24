import crawlLittlebitSite from "./littlebit-site.js";

export default {
  key: "littlebit.de",
  description: "Lay thong tin san pham Littlebit tu URL san pham.",
  crawler: {
    mode: "http",
    jsonLd: true,
    rateLimit: { concurrency: 1, delayMs: 1500 },
    retry: { maxAttempts: 2 },
    outputSchema: {
      type: "object",
      fields: {
        url: "string",
        document_type: "string",
        title: "string",
        attachments: "array",
        pdf_attachments: "array",
        pdf: "object",
        ai_attributes: "object",
        content_text: "string"
      }
    },
    layout: { minItems: 1 }
  },
  crawl: crawlLittlebitSite
};
