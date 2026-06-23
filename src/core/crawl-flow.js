import { withDomainRateLimit } from "./rate-limiter.js";
import { withRetry } from "./retry.js";

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export async function crawlListDetailFlow({
  siteKey,
  startUrls = [],
  fetchListPage,
  parseListPage,
  fetchDetailPage,
  parseDetailPage,
  getNextPageUrl,
  rateLimit = {},
  retry = {},
  maxPages = 20,
  maxItems = 200
}) {
  const queue = [...startUrls];
  const visitedListPages = new Set();
  const visitedDetails = new Set();
  const items = [];

  while (queue.length > 0 && visitedListPages.size < maxPages && items.length < maxItems) {
    const listUrl = queue.shift();
    if (!listUrl || visitedListPages.has(listUrl)) {
      continue;
    }

    visitedListPages.add(listUrl);

    const listResponse = await withDomainRateLimit(siteKey, rateLimit, () =>
      withRetry(() => fetchListPage(listUrl), retry)
    );

    const detailUrls = unique(await parseListPage(listResponse, listUrl));

    for (const detailUrl of detailUrls) {
      if (visitedDetails.has(detailUrl) || items.length >= maxItems) {
        continue;
      }

      visitedDetails.add(detailUrl);
      const detailResponse = await withDomainRateLimit(siteKey, rateLimit, () =>
        withRetry(() => fetchDetailPage(detailUrl), retry)
      );
      items.push(await parseDetailPage(detailResponse, detailUrl));
    }

    const nextPageUrl = getNextPageUrl ? await getNextPageUrl(listResponse, listUrl) : null;
    if (nextPageUrl && !visitedListPages.has(nextPageUrl)) {
      queue.push(nextPageUrl);
    }
  }

  return {
    items,
    visited_list_pages: visitedListPages.size,
    visited_detail_pages: visitedDetails.size
  };
}
