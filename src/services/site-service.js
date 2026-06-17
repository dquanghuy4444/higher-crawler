import { siteRegistry } from "../config/sites.js";

export function getSiteSummaries() {
  return siteRegistry.map((site) => ({
    key: site.key,
    description: site.description
  }));
}

export function findSite(siteKey) {
  return siteRegistry.find((site) => site.key === siteKey);
}
