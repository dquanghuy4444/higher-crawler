import * as cheerio from "cheerio";

import createAxiosInstance from "../../../lib/create-axios-instance.js";

const ASUS_BASE_URL = "https://www.asus.com";

const asusInstance = createAxiosInstance(ASUS_BASE_URL, {
  headers: {
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "de,en;q=0.9"
  }
});

function normalizeText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function toAbsoluteUrl(value, baseUrl = ASUS_BASE_URL) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function parseInputUrl(input) {
  const rawUrl = input?.url;

  if (!rawUrl || typeof rawUrl !== "string") {
    const error = new Error("Field 'url' is required for asus.com crawler.");
    error.statusCode = 400;
    throw error;
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    const error = new Error("Field 'url' must be a valid ASUS product URL.");
    error.statusCode = 400;
    throw error;
  }

  if (!["asus.com", "www.asus.com"].includes(url.hostname)) {
    const error = new Error("ASUS crawler only accepts URLs from asus.com.");
    error.statusCode = 400;
    throw error;
  }

  return url;
}

function parseJsonText(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function flattenJsonLdEntry(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(flattenJsonLdEntry);
  }

  if (Array.isArray(value["@graph"])) {
    return [value, ...value["@graph"].flatMap(flattenJsonLdEntry)];
  }

  return [value];
}

function getJsonLdEntries($) {
  return $("script[type='application/ld+json']")
    .map((_, element) => parseJsonText($(element).contents().text()))
    .get()
    .flatMap(flattenJsonLdEntry)
    .filter(Boolean);
}

function hasType(entry, expectedType) {
  const typeValue = entry?.["@type"];
  const types = Array.isArray(typeValue) ? typeValue : [typeValue];

  return types.some((item) => normalizeText(item).toLowerCase() === expectedType.toLowerCase());
}

function getFirstContent($, selectors) {
  for (const selector of selectors) {
    const value = $(selector).first().attr("content");

    if (normalizeText(value)) {
      return normalizeText(value);
    }
  }

  return null;
}

function getFirstText($, selectors) {
  for (const selector of selectors) {
    const value = normalizeText($(selector).first().text());

    if (value) {
      return value;
    }
  }

  return null;
}

function getFirstTextWithin($, root, selectors) {
  for (const selector of selectors) {
    const value = normalizeText(root.find(selector).first().text());

    if (value) {
      return value;
    }
  }

  return null;
}

function getFirstAttr($, selectors, attributeName) {
  for (const selector of selectors) {
    const value = $(selector).first().attr(attributeName);

    if (normalizeText(value)) {
      return value;
    }
  }

  return null;
}

function toImageObject(url, alt = "") {
  return {
    url,
    alt: normalizeText(alt)
  };
}

function addImage(images, seen, image) {
  const url = image?.url;

  if (!url || seen.has(url)) {
    return;
  }

  seen.add(url);
  images.push(image);
}

function collectImagesFromJsonLd(images, seen, product, pageUrl) {
  const candidates = [product?.image, product?.thumbnailUrl].flatMap((value) =>
    Array.isArray(value) ? value : [value]
  );

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      addImage(images, seen, toImageObject(toAbsoluteUrl(candidate, pageUrl)));
      continue;
    }

    addImage(
      images,
      seen,
      toImageObject(
        toAbsoluteUrl(candidate?.url || candidate?.contentUrl || candidate?.thumbnailUrl, pageUrl),
        candidate?.name || candidate?.caption || candidate?.description || ""
      )
    );
  }
}

function collectImagesFromDom($, images, seen, pageUrl) {
  const selectors = [
    "meta[property='og:image'][content]",
    "meta[name='twitter:image'][content]",
    "img[src]",
    "img[data-src]",
    "img[data-original]",
    "img[data-lazy]",
    "source[srcset]",
    "[style*='background-image']"
  ];

  $(selectors.join(", ")).each((_, element) => {
    const node = $(element);
    const style = node.attr("style") || "";
    const backgroundImageMatch = style.match(/background-image:\s*url\((['"]?)(.*?)\1\)/i);
    const srcSetRaw = node.attr("srcset");
    const srcSetValue = srcSetRaw?.split(",")[0]?.trim()?.split(/\s+/)[0] || null;
    const rawUrl =
      node.attr("content") ||
      node.attr("src") ||
      node.attr("data-src") ||
      node.attr("data-original") ||
      node.attr("data-lazy") ||
      srcSetValue ||
      backgroundImageMatch?.[2] ||
      null;

    addImage(
      images,
      seen,
      toImageObject(toAbsoluteUrl(rawUrl, pageUrl), node.attr("alt") || node.attr("title") || "")
    );
  });
}

function getImages($, product, pageUrl) {
  const images = [];
  const seen = new Set();

  collectImagesFromJsonLd(images, seen, product, pageUrl);
  collectImagesFromDom($, images, seen, pageUrl);

  return images;
}

function cleanAttributeName(value) {
  return normalizeText(value).replace(/:\s*$/, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTableRows($, table, groupName = null) {
  const rows = [];

  $(table)
    .find("tr")
    .each((_, row) => {
      const columns = $(row).find("th, td");

      if (columns.length < 2) {
        return;
      }

      const name = cleanAttributeName($(columns[0]).text());
      const value = normalizeText(
        columns
          .slice(1)
          .map((__, cell) => $(cell).text())
          .get()
          .join(" ")
      );

      if (name || value) {
        rows.push({ group: groupName, name, value });
      }
    });

  return rows;
}

function parseListAttributes($, scope, groupName = null) {
  const rows = [];

  $(scope)
    .find("li")
    .each((_, item) => {
      const node = $(item);
      const label = cleanAttributeName(
        node.find("strong, b, .label, .title, dt").first().text() || node.contents().first().text()
      );
      const value = label
        ? normalizeText(node.text()).replace(new RegExp(`^${escapeRegExp(label)}\\s*:?\\s*`), "")
        : normalizeText(node.text());

      if (label || value) {
        rows.push({ group: groupName, name: label, value });
      }
    });

  return rows;
}

function parseSpecificationGroups($) {
  const grouped = new Map();
  const containerSelectors = [
    "[id*='spec']",
    "[class*='spec']",
    "[data-auto-id*='spec']",
    "[data-testid*='spec']"
  ];

  $(containerSelectors.join(", ")).each((_, section) => {
    const node = $(section);
    const groupName =
      getFirstTextWithin($, node, ["h1", "h2", "h3", "h4", ".title", ".heading"]) ||
      null;

    for (const entry of parseTableRows($, section, groupName)) {
      const bucket = groupName || "General";
      if (!grouped.has(bucket)) {
        grouped.set(bucket, []);
      }
      grouped.get(bucket).push({ name: entry.name, value: entry.value });
    }

    for (const entry of parseListAttributes($, section, groupName)) {
      const bucket = groupName || "General";
      if (!grouped.has(bucket)) {
        grouped.set(bucket, []);
      }
      grouped.get(bucket).push({ name: entry.name, value: entry.value });
    }
  });

  const groups = [...grouped.entries()]
    .map(([group, items]) => ({
      group,
      items: items.filter((item) => item.name || item.value)
    }))
    .filter((entry) => entry.items.length > 0);

  if (groups.length > 0) {
    return groups;
  }

  const fallbackItems = [
    ...parseTableRows($, "table", null),
    ...parseListAttributes($, "main, body", null)
  ];

  if (fallbackItems.length === 0) {
    return [];
  }

  return [
    {
      group: "General",
      items: fallbackItems.map((item) => ({
        name: item.name,
        value: item.value
      }))
    }
  ];
}

function dedupeAttributeGroups(attributeGroups) {
  return attributeGroups
    .map((group) => {
      const seen = new Set();
      const items = group.items.filter((item) => {
        const key = `${item.name}:::${item.value}`;

        if (!item.name && !item.value) {
          return false;
        }

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });

      return {
        group: group.group || null,
        items
      };
    })
    .filter((group) => group.items.length > 0);
}

function getFlatAttributes(attributeGroups) {
  return attributeGroups.flatMap((group) =>
    group.items.map((item) => ({
      group: group.group,
      name: item.name,
      value: item.value
    }))
  );
}

function getBreadcrumbs($, pageUrl) {
  return $("nav a[href], .breadcrumb a[href], [aria-label='breadcrumb'] a[href]")
    .map((_, element) => ({
      name: normalizeText($(element).text()) || null,
      url: toAbsoluteUrl($(element).attr("href"), pageUrl)
    }))
    .get()
    .filter((item) => item.name || item.url);
}

function getDownloads($, pageUrl) {
  const downloadKeywords = /(manual|download|driver|bios|firmware|support|guide|handbuch)/i;

  return $("a[href]")
    .map((_, element) => {
      const node = $(element);
      const href = node.attr("href");
      const name = normalizeText(node.text()) || normalizeText(node.attr("title") || "");

      if (!downloadKeywords.test(`${href || ""} ${name}`)) {
        return null;
      }

      return {
        name: name || null,
        download_url: toAbsoluteUrl(href, pageUrl),
        description: null,
        type: null,
        size: null,
        icon_url: null
      };
    })
    .get()
    .filter(Boolean);
}

function getOfferValue(product, fieldName) {
  const offers = [product?.offers].flatMap((value) => (Array.isArray(value) ? value : [value]));

  for (const offer of offers) {
    const value = offer?.[fieldName];

    if (value !== undefined && value !== null && normalizeText(value)) {
      return normalizeText(value);
    }
  }

  return null;
}

function getProductDescription($, product) {
  return (
    normalizeText(product?.description) ||
    getFirstContent($, [
      "meta[name='description'][content]",
      "meta[property='og:description'][content]"
    ]) ||
    getFirstText($, [
      "[itemprop='description']",
      ".ProductOverview",
      ".overview",
      "main"
    ])
  );
}

export function parseAsusProduct(html, pageUrl = ASUS_BASE_URL) {
  const $ = cheerio.load(html);
  const jsonLdEntries = getJsonLdEntries($);
  const product =
    jsonLdEntries.find((entry) => hasType(entry, "Product")) ||
    jsonLdEntries.find((entry) => normalizeText(entry?.name) && entry?.image);

  const title =
    normalizeText(product?.name) ||
    getFirstContent($, [
      "meta[property='og:title'][content]",
      "meta[name='twitter:title'][content]"
    ]) ||
    getFirstText($, [
      "h1",
      "[itemprop='name']",
      "title"
    ]);

  if (!title) {
    throw new Error("ASUS product content was not found in the source page.");
  }

  const attributeGroups = dedupeAttributeGroups(parseSpecificationGroups($));
  const images = getImages($, product, pageUrl);
  const breadcrumbs = getBreadcrumbs($, pageUrl);
  const canonicalUrl = getFirstAttr($, ["link[rel='canonical']"], "href");

  return {
    url: canonicalUrl ? toAbsoluteUrl(canonicalUrl, pageUrl) : pageUrl,
    product_id:
      normalizeText(product?.productID) ||
      getFirstContent($, [
        "meta[name='product-id'][content]",
        "meta[property='product:retailer_item_id'][content]"
      ]) ||
      null,
    item_id:
      normalizeText(product?.sku) ||
      getFirstContent($, ["meta[name='sku'][content]"]) ||
      null,
    title,
    sku:
      normalizeText(product?.sku) ||
      getFirstText($, [
        "[data-auto-id='sku']",
        ".sku",
        "[class*='sku']"
      ]) ||
      null,
    manufacturer_number:
      normalizeText(product?.mpn) ||
      getFirstText($, [
        "[itemprop='mpn']",
        "[class*='mpn']"
      ]) ||
      null,
    ean:
      normalizeText(product?.gtin13 || product?.gtin || product?.gtin14 || product?.gtin12) ||
      null,
    description: getProductDescription($, product),
    brand: {
      name:
        normalizeText(product?.brand?.name || product?.brand) ||
        "ASUS",
      owner_domain: "asus.com",
      plugilo_name: null
    },
    price: getOfferValue(product, "price"),
    availability: getOfferValue(product, "availability"),
    requires_login_for_price_availability: false,
    attributes: getFlatAttributes(attributeGroups),
    attribute_groups: attributeGroups,
    package_contents: [],
    warranty: [],
    attachments: getDownloads($, pageUrl),
    images,
    primary_image: images[0]?.url ?? null,
    breadcrumbs,
    category: breadcrumbs.at(-1)?.name || null,
    content_text: normalizeText($("main").text() || $("body").text())
  };
}

export default async function crawlAsusSite(input) {
  const url = parseInputUrl(input);
  let response;

  try {
    response = await asusInstance.get(`${url.pathname}${url.search}`);
  } catch {
    throw new Error("ASUS crawler could not fetch source page.");
  }

  return parseAsusProduct(response.data, url.toString());
}
