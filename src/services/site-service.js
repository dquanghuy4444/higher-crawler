import { siteRegistry } from "../config/sites.js";

export function getSiteSummaries() {
  return siteRegistry.map((site) => ({
    key: site.key,
    description: site.description,
    crawler: {
      mode: site.crawler?.mode || "http",
      prefer_api: Boolean(site.crawler?.preferApi),
      json_ld: Boolean(site.crawler?.jsonLd),
      tls_fingerprint: site.crawler?.tlsFingerprint || null,
      session: site.crawler?.session || null,
      rate_limit: site.crawler?.rateLimit || null,
      retry: site.crawler?.retry || null,
      output_schema: Boolean(site.crawler?.outputSchema)
    }
  }));
}

export function findSite(siteKey) {
  return siteRegistry.find((site) => site.key === siteKey);
}
