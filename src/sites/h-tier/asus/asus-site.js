import vm from "node:vm";

import * as cheerio from "cheerio";

import createAxiosInstance from "../../../lib/create-axios-instance.js";
import { detectProductAttributesFromContent } from "../../../services/ai-attribute-service.js";

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

function cleanAttributeName(value) {
  return normalizeText(value).replace(/:\s*$/, "");
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

function decodeHtmlToText(value) {
  if (!value) {
    return "";
  }

  const $ = cheerio.load(`<div>${value}</div>`);
  return normalizeText($.text());
}

function getNuxtState(html) {
  const $ = cheerio.load(html);
  const nuxtScript = $("script")
    .map((_, element) => $(element).html())
    .get()
    .find((value) => typeof value === "string" && value.includes("__NUXT__="));

  if (!nuxtScript) {
    return null;
  }

  try {
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(nuxtScript, context, { timeout: 5000 });
    return context.window.__NUXT__?.state || context.__NUXT__?.state || null;
  } catch {
    return null;
  }
}

function normalizeProductPath(pathname) {
  const cleaned = pathname.replace(/\/(?:techspec|helpdesk_knowledge|review|where-to-buy)\/?$/i, "/");
  return cleaned.endsWith("/") ? cleaned : `${cleaned}/`;
}

function buildPageUrls(url) {
  const basePath = normalizeProductPath(url.pathname);
  const baseUrl = new URL(basePath, `${url.origin}/`).toString();

  return {
    overviewUrl: baseUrl,
    techspecUrl: toAbsoluteUrl(`${basePath}techspec/`, url.origin),
    supportUrl: toAbsoluteUrl(`${basePath}helpdesk_knowledge/`, url.origin)
  };
}

function getProductFromJsonLd($) {
  const jsonLdEntries = getJsonLdEntries($);

  return (
    jsonLdEntries.find((entry) => hasType(entry, "Product")) ||
    jsonLdEntries.find((entry) => normalizeText(entry?.name) && entry?.image) ||
    null
  );
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

function getCanonicalUrl($, state, pageUrl) {
  const canonical =
    state?.Seo?.metaData?.Canonical ||
    $("link[rel='canonical']").first().attr("href") ||
    pageUrl;

  return toAbsoluteUrl(canonical, pageUrl);
}

function getBrand(product) {
  return {
    name: normalizeText(product?.brand?.name || product?.brand) || "ASUS",
    owner_domain: "asus.com",
    plugilo_name: null
  };
}

function getImagesFromState(state, pageUrl) {
  const images = [];
  const seen = new Set();
  const seoImages = [state?.Seo?.metaData?.Structure?.Image].flatMap((value) =>
    Array.isArray(value) ? value : [value]
  );
  const heroImages = [
    state?.PDPage?.PDInfo?.OPInfo?.ProductImage?.Desktop?.["1x"],
    state?.PDPage?.PDInfo?.OPInfo?.ProductImage?.Desktop?.["2x"],
    state?.PDPage?.PDInfo?.OPInfo?.ProductImage?.Tablet?.["1x"],
    state?.PDPage?.PDInfo?.OPInfo?.ProductImage?.Tablet?.["2x"],
    state?.PDPage?.PDInfo?.OPInfo?.ProductImage?.Mobile?.["1x"],
    state?.PDPage?.PDInfo?.OPInfo?.ProductImage?.Mobile?.["2x"]
  ];

  for (const rawUrl of [...seoImages, ...heroImages]) {
    addImage(images, seen, toImageObject(toAbsoluteUrl(rawUrl, pageUrl)));
  }

  return images;
}

function parseFeatureList(featureHtml) {
  if (!featureHtml) {
    return [];
  }

  const $ = cheerio.load(`<div>${featureHtml}</div>`);

  return $("li")
    .map((_, element) => {
      const node = $(element);
      let label = cleanAttributeName(node.find("strong, b").first().text());
      const rawText = normalizeText(node.text());
      if (!label && rawText.includes(":")) {
        label = cleanAttributeName(rawText.split(":")[0]);
      }
      const value = label
        ? normalizeText(rawText.replace(new RegExp(`^${label}\\s*:?\\s*`), ""))
        : rawText;

      if (!label && !value) {
        return null;
      }

      return {
        name: label || "Feature",
        value: value || rawText
      };
    })
    .get()
    .filter(Boolean);
}

function toSpecItemsFromObject(specList = {}) {
  return Object.entries(specList)
    .map(([name, value]) => ({
      name: cleanAttributeName(name),
      value: decodeHtmlToText(value)
    }))
    .filter((item) => item.name || item.value);
}

function toSpecItemsFromArray(specList = []) {
  return specList
    .map((item) => ({
      name: cleanAttributeName(item?.Title),
      value: decodeHtmlToText(item?.Content)
    }))
    .filter((entry) => entry.name || entry.value);
}

function getSpecGroupsFromState(techspecState, title) {
  const pdPage = techspecState?.PDPage || {};
  const grouped = [];
  const modelGroups = Array.isArray(pdPage.PDTechSpecM2List?.TechSpec)
    ? pdPage.PDTechSpecM2List.TechSpec
    : [];

  if (modelGroups.length > 0) {
    for (const model of modelGroups) {
      const items = toSpecItemsFromObject(model?.SpecList || {});

      if (items.length > 0) {
        grouped.push({
          group: normalizeText(model?.Name) || title || "Specifications",
          items
        });
      }
    }
  }

  const singleModelItems =
    modelGroups.length > 0 ? [] : toSpecItemsFromArray(pdPage.PDTechSpecM2?.SpecList || []);
  if (singleModelItems.length > 0) {
    grouped.push({
      group: "Specifications",
      items: singleModelItems
    });
  }

  return grouped;
}

function getOverviewGroupsFromState(overviewState) {
  const pdInfo = overviewState?.PDPage?.PDInfo;
  const featureItems = parseFeatureList(pdInfo?.OPInfo?.Feature);
  const groups = [];

  if (featureItems.length > 0) {
    groups.push({
      group: "Overview",
      items: featureItems
    });
  }

  const slogan = decodeHtmlToText(pdInfo?.OPInfo?.Slogan);
  if (slogan) {
    groups.push({
      group: "Summary",
      items: [
        {
          name: "Slogan",
          value: slogan
        }
      ]
    });
  }

  return groups;
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

function parseFallbackAttributeGroups(html) {
  const $ = cheerio.load(html);
  const grouped = [];
  const rows = [];

  $("[class*='TechSpec__rowTable__']").each((_, row) => {
    const node = $(row);
    const name = cleanAttributeName(
      normalizeText(node.find(".rowTableTitle, [class*='rowTableTitle']").first().text())
    );
    const value = normalizeText(
      node
        .find(".rowTableItemViewBox p, .rowTableItemViewBox li")
        .map((__, item) => $(item).text())
        .get()
        .join(" | ")
    );

    if (name || value) {
      rows.push({ name, value });
    }
  });

  if (rows.length > 0) {
    grouped.push({
      group: "Specifications",
      items: rows
    });
  }

  return grouped;
}

function getKeyFeatures(overviewState) {
  const featureItems = parseFeatureList(overviewState?.PDPage?.PDInfo?.OPInfo?.Feature);
  return featureItems.map((item) => normalizeText(`${item.name}: ${item.value}`)).filter(Boolean);
}

function getSupportLinksFromState(overviewState, pageUrls) {
  const productTabList = overviewState?.PDPage?.productTabList;
  const tabLinks = Array.isArray(productTabList?.TabList) ? productTabList.TabList : [];
  const links = [];
  const seen = new Set();

  const addLink = (name, url, kind = null) => {
    const absoluteUrl = toAbsoluteUrl(url, pageUrls.overviewUrl);
    if (!absoluteUrl || seen.has(absoluteUrl)) {
      return;
    }

    seen.add(absoluteUrl);
    links.push({
      name: normalizeText(name) || null,
      kind,
      url: absoluteUrl
    });
  };

  for (const tab of tabLinks) {
    addLink(tab?.Name, tab?.Link, normalizeText(tab?.Webpath || "").toLowerCase() || null);
  }

  addLink(productTabList?.WTB?.WTBText, productTabList?.WTB?.WTBLink, "where_to_buy");
  addLink(productTabList?.Buy?.ButtonText, productTabList?.Buy?.ButtonLink, "buy");
  addLink("Support", pageUrls.supportUrl, "support");
  addLink("Specifications", pageUrls.techspecUrl, "specifications");

  return links;
}

function getAttachmentsFromSupportLinks(supportLinks) {
  return supportLinks
    .filter((item) => ["support", "specifications"].includes(item.kind))
    .map((item) => ({
      name: item.name,
      download_url: item.url,
      description: null,
      type: item.kind,
      size: null,
      icon_url: null
    }));
}

function getBreadcrumbsFromUrl(pageUrl, title) {
  const url = new URL(pageUrl);
  const segments = url.pathname.split("/").filter(Boolean);
  const locale = segments[0]?.length <= 5 ? segments[0] : null;
  const startIndex = locale ? 1 : 0;
  const productSegments = segments.slice(startIndex).filter((segment) => !/^(techspec|helpdesk_knowledge|review|where-to-buy)$/i.test(segment));
  const breadcrumbSegments = productSegments.slice(0, -1);
  const breadcrumbs = [];

  let currentPath = locale ? `/${locale}` : "";
  for (const segment of breadcrumbSegments) {
    currentPath += `/${segment}`;
    breadcrumbs.push({
      name: normalizeText(decodeURIComponent(segment)),
      url: toAbsoluteUrl(`${currentPath}/`, url.origin)
    });
  }

  breadcrumbs.push({
    name: title,
    url: pageUrl
  });

  return breadcrumbs;
}

function buildContentText({ title, description, keyFeatures, attributeGroups }) {
  return normalizeText(
    [
      title,
      description,
      ...keyFeatures,
      ...attributeGroups.flatMap((group) => [
        group.group,
        ...group.items.map((item) => `${item.name}: ${item.value}`)
      ])
    ].join("\n")
  );
}

function extractVariantModels(techspecState) {
  const models = Array.isArray(techspecState?.PDPage?.PDTechSpecM2List?.TechSpec)
    ? techspecState.PDPage.PDTechSpecM2List.TechSpec
    : [];

  return models.map((model) => ({
    product_id: normalizeText(model?.ProductId) || null,
    name: normalizeText(model?.Name) || null,
    image_url: toAbsoluteUrl(model?.ImageLink, ASUS_BASE_URL)
  }));
}

export function parseAsusProduct(html, pageUrl = ASUS_BASE_URL) {
  const $ = cheerio.load(html);
  const state = getNuxtState(html);
  const product = getProductFromJsonLd($);
  const title =
    normalizeText(state?.PDPage?.PDInfo?.Name) ||
    normalizeText(product?.name) ||
    getFirstContent($, [
      "meta[property='og:title'][content]",
      "meta[name='twitter:title'][content]"
    ]) ||
    getFirstText($, ["h1", "[itemprop='name']", "title"]);

  if (!title) {
    throw new Error("ASUS product content was not found in the source page.");
  }

  const description =
    decodeHtmlToText(state?.PDPage?.PDInfo?.OPInfo?.Slogan) ||
    normalizeText(product?.description) ||
    getFirstContent($, [
      "meta[name='description'][content]",
      "meta[property='og:description'][content]"
    ]) ||
    "";
  const attributeGroups = dedupeAttributeGroups([
    ...getOverviewGroupsFromState(state)
  ]);
  const images = getImagesFromState(state, pageUrl);

  return {
    url: getCanonicalUrl($, state, pageUrl),
    product_id:
      normalizeText(state?.PDPage?.PDInfo?.ProductID) ||
      normalizeText(product?.productID) ||
      normalizeText(state?.Seo?.metaData?.Structure?.Sku) ||
      null,
    item_id: normalizeText(product?.sku) || null,
    title,
    sku: normalizeText(product?.sku) || null,
    manufacturer_number: normalizeText(product?.mpn) || null,
    ean:
      normalizeText(product?.gtin13 || product?.gtin || product?.gtin14 || product?.gtin12) ||
      null,
    description,
    brand: getBrand(product),
    price: getOfferValue(product, "price") || normalizeText(state?.Seo?.metaData?.Structure?.Price) || null,
    availability:
      getOfferValue(product, "availability") ||
      normalizeText(state?.Seo?.metaData?.Structure?.Availability) ||
      null,
    requires_login_for_price_availability: false,
    attributes: getFlatAttributes(attributeGroups),
    attribute_groups: attributeGroups,
    package_contents: [],
    warranty: [],
    attachments: [],
    images,
    primary_image: images[0]?.url ?? null,
    breadcrumbs: getBreadcrumbsFromUrl(pageUrl, title),
    category: normalizeText(state?.PDPage?.PDInfo?.ProductLevel2Code) || null,
    content_text: buildContentText({
      title,
      description,
      keyFeatures: getKeyFeatures(state),
      attributeGroups
    })
  };
}

export default async function crawlAsusSite(input) {
  const url = parseInputUrl(input);
  const pageUrls = buildPageUrls(url);
  let overviewResponse;
  let techspecResponse;

  try {
    [overviewResponse, techspecResponse] = await Promise.all([
      asusInstance.get(new URL(pageUrls.overviewUrl).pathname),
      asusInstance.get(new URL(pageUrls.techspecUrl).pathname)
    ]);
  } catch {
    throw new Error("ASUS crawler could not fetch source page.");
  }

  const overviewHtml = overviewResponse.data;
  const techspecHtml = techspecResponse.data;
  const overviewState = getNuxtState(overviewHtml);
  const techspecState = getNuxtState(techspecHtml);
  const baseProduct = parseAsusProduct(overviewHtml, pageUrls.overviewUrl);
  const overviewGroups = getOverviewGroupsFromState(overviewState);
  const specGroups = getSpecGroupsFromState(techspecState, baseProduct.title);
  const fallbackSpecGroups = specGroups.length > 0 ? [] : parseFallbackAttributeGroups(techspecHtml);
  const attributeGroups = dedupeAttributeGroups([
    ...overviewGroups,
    ...specGroups,
    ...fallbackSpecGroups
  ]);
  const supportLinks = getSupportLinksFromState(overviewState, pageUrls);
  const attachments = getAttachmentsFromSupportLinks(supportLinks);
  const keyFeatures = getKeyFeatures(overviewState);
  const modelVariants = extractVariantModels(techspecState);
  const contentText = buildContentText({
    title: baseProduct.title,
    description: baseProduct.description,
    keyFeatures,
    attributeGroups
  });
  const aiAttributes = await detectProductAttributesFromContent(contentText, {
    enabled: input?.detect_ai_attributes !== false,
    title: baseProduct.title,
    sourceUrl: pageUrls.overviewUrl
  });

  return {
    ...baseProduct,
    url: pageUrls.overviewUrl,
    canonical_url: baseProduct.url,
    attributes: getFlatAttributes(attributeGroups),
    attribute_groups: attributeGroups,
    key_features: keyFeatures,
    model_variants: modelVariants,
    attachments,
    support_links: supportLinks,
    breadcrumbs: getBreadcrumbsFromUrl(pageUrls.overviewUrl, baseProduct.title),
    category:
      normalizeText(overviewState?.PDPage?.PDInfo?.ProductLevel2Code) ||
      baseProduct.category,
    content_text: contentText,
    ai_attributes: aiAttributes,
    source_pages: {
      overview_url: pageUrls.overviewUrl,
      techspec_url: pageUrls.techspecUrl,
      support_url: pageUrls.supportUrl
    }
  };
}
