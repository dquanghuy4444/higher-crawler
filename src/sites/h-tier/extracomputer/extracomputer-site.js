import * as cheerio from "cheerio";

import createAxiosInstance from "../../../lib/create-axios-instance.js";

const EXTRACOMPUTER_BASE_URL = "https://www.extracomputer.de";

const extracomputerInstance = createAxiosInstance(EXTRACOMPUTER_BASE_URL, {
  headers: {
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "de,en;q=0.9"
  }
});

function normalizeText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function toAbsoluteUrl(value, baseUrl = EXTRACOMPUTER_BASE_URL) {
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
    const error = new Error("Field 'url' is required for extracomputer.de crawler.");
    error.statusCode = 400;
    throw error;
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    const error = new Error("Field 'url' must be a valid EXTRA Computer product URL.");
    error.statusCode = 400;
    throw error;
  }

  if (!["extracomputer.de", "www.extracomputer.de"].includes(url.hostname)) {
    const error = new Error("EXTRA Computer crawler only accepts URLs from extracomputer.de.");
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

function getFirstTextWithin(root, selectors) {
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

function addImage(images, seen, image) {
  const url = image?.url;

  if (!url || seen.has(url)) {
    return;
  }

  seen.add(url);
  images.push(image);
}

function toImageObject(url, alt = "") {
  return {
    url,
    alt: normalizeText(alt)
  };
}

function getImages($, product, pageUrl) {
  const images = [];
  const seen = new Set();
  const jsonLdCandidates = [product?.image, product?.thumbnailUrl].flatMap((value) =>
    Array.isArray(value) ? value : [value]
  );

  for (const candidate of jsonLdCandidates) {
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

  $(
    [
      "meta[property='og:image'][content]",
      "meta[name='twitter:image'][content]",
      "img[src]",
      "img[data-src]",
      "img[data-original]",
      "img[data-lazy]",
      "source[srcset]"
    ].join(", ")
  ).each((_, element) => {
    const node = $(element);
    const srcSetRaw = node.attr("srcset");
    const srcSetValue = srcSetRaw?.split(",")[0]?.trim()?.split(/\s+/)[0] || null;
    const rawUrl =
      node.attr("content") ||
      node.attr("src") ||
      node.attr("data-src") ||
      node.attr("data-original") ||
      node.attr("data-lazy") ||
      srcSetValue ||
      null;

    addImage(
      images,
      seen,
      toImageObject(toAbsoluteUrl(rawUrl, pageUrl), node.attr("alt") || node.attr("title") || "")
    );
  });

  return images;
}

function cleanAttributeName(value) {
  return normalizeText(value).replace(/:\s*$/, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTableRows($, scope, groupName = null) {
  return $(scope)
    .find("tr")
    .map((_, row) => {
      const columns = $(row).find("th, td");

      if (columns.length < 2) {
        return null;
      }

      const name = cleanAttributeName($(columns[0]).text());
      const value = normalizeText(
        columns
          .slice(1)
          .map((__, cell) => $(cell).text())
          .get()
          .join(" ")
      );

      if (!name && !value) {
        return null;
      }

      return { group: groupName, name, value };
    })
    .get()
    .filter(Boolean);
}

function parseListAttributes($, scope, groupName = null) {
  return $(scope)
    .find("li")
    .map((_, item) => {
      const node = $(item);
      const label = cleanAttributeName(
        node.find("strong, b, .label, .title, dt").first().text() || node.contents().first().text()
      );
      const value = label
        ? normalizeText(node.text()).replace(new RegExp(`^${escapeRegExp(label)}\\s*:?\\s*`), "")
        : normalizeText(node.text());

      if (!label && !value) {
        return null;
      }

      return { group: groupName, name: label, value };
    })
    .get()
    .filter(Boolean);
}

function parseSpecificationGroups($) {
  const grouped = new Map();
  const containerSelectors = [
    "[id*='spec']",
    "[class*='spec']",
    "[id*='detail']",
    "[class*='detail']",
    "[class*='property']",
    "[data-testid*='spec']"
  ];

  $(containerSelectors.join(", ")).each((_, section) => {
    const node = $(section);
    const groupName = getFirstTextWithin(node, ["h1", "h2", "h3", "h4", ".title", ".heading"]) || "General";

    for (const entry of [...parseTableRows($, section, groupName), ...parseListAttributes($, section, groupName)]) {
      if (!grouped.has(groupName)) {
        grouped.set(groupName, []);
      }

      grouped.get(groupName).push({ name: entry.name, value: entry.value });
    }
  });

  const groups = [...grouped.entries()]
    .map(([group, items]) => ({
      group,
      items
    }))
    .filter((group) => group.items.length > 0);

  if (groups.length > 0) {
    return groups;
  }

  const fallbackItems = [...parseTableRows($, "table"), ...parseListAttributes($, "main, body")];

  return fallbackItems.length > 0
    ? [
        {
          group: "General",
          items: fallbackItems.map((item) => ({
            name: item.name,
            value: item.value
          }))
        }
      ]
    : [];
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

function parseVariantSwitchOptions($) {
  const raw = $(".product-detail-configurator form[data-variant-switch-options]").first().attr("data-variant-switch-options");
  const parsed = parseJsonText(raw);

  return parsed && typeof parsed === "object"
    ? {
        ...parsed,
        url: parsed.url ? toAbsoluteUrl(parsed.url, EXTRACOMPUTER_BASE_URL) : null
      }
    : null;
}

function getVariantGroups($) {
  return $(".product-detail-configurator-group")
    .map((_, group) => {
      const node = $(group);
      const name = normalizeText(node.find(".product-detail-configurator-group-title, legend").first().text()) || null;
      const groupId = node.find("input[type='radio']").first().attr("name") || null;
      const options = node.find(".product-detail-configurator-option")
        .map((__, optionNode) => {
          const option = $(optionNode);
          const input = option.find("input[type='radio']").first();
          const label = option.find("label").first();

          return {
            group_id: input.attr("name") || groupId,
            option_id: input.attr("value") || null,
            option_key: input.attr("id") || null,
            label: normalizeText(label.text()) || normalizeText(label.attr("title")) || null,
            active: input.is(":checked"),
            combinable: input.hasClass("is-combinable") || label.hasClass("is-combinable"),
            disabled: input.is(":disabled") || option.hasClass("disabled") || label.hasClass("disabled")
          };
        })
        .get()
        .filter((item) => item.label || item.option_id);

      if (!name && options.length === 0) {
        return null;
      }

      return {
        group: name,
        group_id: groupId,
        selected_option_id: options.find((item) => item.active)?.option_id || null,
        selected_label: options.find((item) => item.active)?.label || null,
        options
      };
    })
    .get()
    .filter(Boolean);
}

function getVariantInfo($, pageUrl) {
  const variantGroups = getVariantGroups($);
  const switchOptions = parseVariantSwitchOptions($);
  const parentProductId = $("#parentId").attr("value") || null;
  const currentProductId = $("#pdid").attr("value") || null;
  const subtitle = normalizeText($(".product-detail-subtitle").first().text()) || null;

  return {
    has_variants: variantGroups.length > 0,
    parent_product_id: parentProductId,
    current_product_id: currentProductId,
    current_variant_title: subtitle,
    switch: switchOptions,
    selected_options: variantGroups
      .map((group) => ({
        group: group.group,
        group_id: group.group_id,
        option_id: group.selected_option_id,
        label: group.selected_label
      }))
      .filter((item) => item.option_id || item.label),
    groups: variantGroups,
    total_option_count: variantGroups.reduce((sum, group) => sum + group.options.length, 0),
    variant_axes_count: variantGroups.length,
    canonical_parent_url: getFirstAttr($, ["link[rel='canonical']"], "href")
      ? toAbsoluteUrl(getFirstAttr($, ["link[rel='canonical']"], "href"), pageUrl)
      : null
  };
}

function getVariantList(variantInfo) {
  const groups = Array.isArray(variantInfo?.groups) ? variantInfo.groups : [];

  return groups.flatMap((group) =>
    group.options.map((option) => ({
      group: group.group,
      group_id: group.group_id,
      option_id: option.option_id,
      option_key: option.option_key,
      label: option.label,
      active: option.active,
      combinable: option.combinable,
      disabled: option.disabled
    }))
  );
}

function cartesianProduct(arrays) {
  if (arrays.length === 0) {
    return [[]];
  }

  const [first, ...rest] = arrays;
  const restProduct = cartesianProduct(rest);

  return first.flatMap((item) => restProduct.map((combo) => [item, ...combo]));
}

function buildOptionCombinations(variantGroups) {
  const groupOptions = variantGroups.map((group) =>
    group.options
      .filter((opt) => opt.option_id)
      .map((opt) => ({
        group: group.group,
        group_id: group.group_id,
        option_id: opt.option_id,
        option_key: opt.option_key,
        label: opt.label
      }))
  );

  const validGroupOptions = groupOptions.filter((opts) => opts.length > 0);

  return cartesianProduct(validGroupOptions).map((combo) => combo.filter(Boolean));
}

function parseVariantPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const variantInfo = getVariantInfo($, pageUrl);

  const currentProductId = $("#pdid").attr("value") || null;

  return {
    _product_id: currentProductId,
    url: pageUrl,
    variant_title: normalizeText($(".product-detail-subtitle").first().text()) || null,
    selected_options: variantInfo.selected_options
  };
}

async function fetchAllVariantDetails(variantInfo, pageUrl) {
  const switchUrl = variantInfo?.switch?.url;
  const groups = Array.isArray(variantInfo?.groups) ? variantInfo.groups : [];

  if (!switchUrl || groups.length === 0) {
    return [];
  }

  const combinations = buildOptionCombinations(groups);
  const seenProductIds = new Set();
  const seenUrls = new Set();
  const results = [];

  for (const combo of combinations) {
    if (combo.length === 0) {
      continue;
    }

    const optionIds = combo.map((opt) => opt.option_id);
    const optionsParam = encodeURIComponent(JSON.stringify(optionIds));

    let variantUrl;
    let variantProductId;

    try {
      const switchResponse = await extracomputerInstance.get(
        `${switchUrl}?options=${optionsParam}`,
        {
          headers: {
            "Accept": "application/json, text/html, */*"
          },
          validateStatus: (status) => status < 500
        }
      );

      const responseData = switchResponse.data;

      if (typeof responseData === "object") {
        variantUrl = responseData.url ? toAbsoluteUrl(responseData.url, EXTRACOMPUTER_BASE_URL) : null;
        variantProductId = responseData.productId || null;
      } else if (switchResponse.headers?.location) {
        variantUrl = toAbsoluteUrl(switchResponse.headers.location, EXTRACOMPUTER_BASE_URL);
      }
    } catch {
      continue;
    }

    if (!variantUrl) {
      continue;
    }

    if (variantProductId && seenProductIds.has(variantProductId)) {
      continue;
    }

    if (seenUrls.has(variantUrl)) {
      continue;
    }

    seenUrls.add(variantUrl);

    try {
      const parsedUrl = new URL(variantUrl);
      const variantResponse = await extracomputerInstance.get(
        `${parsedUrl.pathname}${parsedUrl.search}`
      );

      const variantData = parseVariantPage(variantResponse.data, variantUrl);
      const { _product_id: parsedProductId, ...variantOutput } = variantData;

      const productId = parsedProductId || variantProductId || variantUrl;

      if (seenProductIds.has(productId)) {
        continue;
      }

      seenProductIds.add(productId);

      if (variantProductId) {
        seenProductIds.add(variantProductId);
      }

      results.push(variantOutput);
    } catch {
      continue;
    }
  }

  return results;
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
  const downloadKeywords = /(manual|download|datenblatt|pdf|treiber|bios|firmware|support|guide|handbuch)/i;

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

function getProductDescription($, product) {
  return (
    normalizeText(product?.description) ||
    getFirstContent($, [
      "meta[name='description'][content]",
      "meta[property='og:description'][content]"
    ]) ||
    getFirstText($, [
      "[itemprop='description']",
      ".product-description",
      ".description",
      ".overview",
      "main"
    ])
  );
}

function getPrice($, product) {
  return (
    getOfferValue(product, "price") ||
    getFirstContent($, [
      "meta[property='product:price:amount'][content]",
      "meta[itemprop='price'][content]"
    ]) ||
    getFirstText($, [
      "[itemprop='price']",
      ".price",
      ".product-price",
      "[class*='price']"
    ])
  );
}

function getAvailability($, product) {
  return (
    getOfferValue(product, "availability") ||
    getFirstContent($, ["link[itemprop='availability'][href]"]) ||
    getFirstText($, [
      ".availability",
      ".stock",
      "[class*='availability']",
      "[class*='stock']"
    ])
  );
}

export function parseExtracomputerProduct(html, pageUrl = EXTRACOMPUTER_BASE_URL) {
  const $ = cheerio.load(html);
  const jsonLdEntries = getJsonLdEntries($);
  const product =
    jsonLdEntries.find((entry) => hasType(entry, "Product")) ||
    jsonLdEntries.find((entry) => normalizeText(entry?.name) && (entry?.image || entry?.description));

  const title =
    normalizeText(product?.name) ||
    getFirstContent($, [
      "meta[property='og:title'][content]",
      "meta[name='twitter:title'][content]"
    ]) ||
    getFirstText($, ["h1", "[itemprop='name']", ".product-title", "title"]) ||
    null;

  const canonicalUrl = getFirstAttr($, ["link[rel='canonical']"], "href");
  const variantInfo = getVariantInfo($, pageUrl);
  const variantList = getVariantList(variantInfo);

  return {
    url: pageUrl,
    canonical_url: canonicalUrl ? toAbsoluteUrl(canonicalUrl, pageUrl) : pageUrl,
    title,
    variants: variantList,
    variant_info: variantInfo
  };
}

export default async function crawlExtracomputerSite(input) {
  const url = parseInputUrl(input);
  const includeVariants = input?.include_variants === true;
  let response;

  try {
    response = await extracomputerInstance.get(`${url.pathname}${url.search}`);
  } catch {
    throw new Error("EXTRA Computer crawler could not fetch source page.");
  }

  const result = parseExtracomputerProduct(response.data, url.toString());

  if (includeVariants && result.variant_info?.has_variants) {
    const variantDetails = await fetchAllVariantDetails(result.variant_info, url.toString());
    result.variant_details = variantDetails;
  }

  return result;
}
