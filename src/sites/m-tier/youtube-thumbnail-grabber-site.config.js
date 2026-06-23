import crawlYoutubeThumbnailGrabberSite from "./youtube-thumbnail-grabber-site.js";

export default {
  key: "youtube-thumbnail-grabber.com",
  description: "Dung browser bot de nhap link YouTube va lay cac thumbnail.",
  crawler: {
    mode: "browser",
    rateLimit: { concurrency: 1, delayMs: 3000 },
    retry: { maxAttempts: 1 },
    outputSchema: {
      type: "object",
      required: ["thumbnails"],
      fields: {
        url: "string",
        youtube_url: "string",
        thumbnails: "array"
      }
    },
    layout: { minItems: 1 }
  },
  crawl: crawlYoutubeThumbnailGrabberSite
};
