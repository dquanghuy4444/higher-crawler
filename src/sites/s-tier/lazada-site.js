import * as cheerio from "cheerio";

import createAxiosInstance from "../../lib/create-axios-instance.js";

const lazadaInstance = createAxiosInstance("https://www.lazada.vn", {
  headers: {
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "vi,en;q=0.9"
  }
});

function normalizeText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function toAbsoluteUrl(value, baseUrl = "https://www.lazada.vn") {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function parseInteger(value = "") {
  const match = value.replaceAll(".", "").replaceAll(",", "").match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function parsePrice(value = "") {
  const match = value.replaceAll(",", "").match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function cleanImageUrl(value) {
  if (!value) {
    return null;
  }

  return value.replace(/_(?:\d+x\d+q\d+|q\d+)\.[^.]+_\.webp$/i, "");
}

function parseInputUrl(input) {
  const rawUrl = input?.url;

  if (!rawUrl || typeof rawUrl !== "string") {
    const error = new Error("Field 'url' is required for lazada.vn crawler.");
    error.statusCode = 400;
    throw error;
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    const error = new Error("Field 'url' must be a valid Lazada product URL.");
    error.statusCode = 400;
    throw error;
  }

  if (!["lazada.vn", "www.lazada.vn"].includes(url.hostname)) {
    const error = new Error("Lazada crawler only accepts URLs from lazada.vn.");
    error.statusCode = 400;
    throw error;
  }

  return url;
}

function parseBuyParams(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getImages($, root, baseUrl) {
  const seen = new Set();

  return root
    .find(".gallery-preview-panel-v2 img[src], .item-gallery-v2__thumbnail img[src], .sku-variable-img img[src]")
    .map((_, image) => {
      const url = toAbsoluteUrl(cleanImageUrl($(image).attr("src")), baseUrl);

      if (!url || seen.has(url)) {
        return null;
      }

      seen.add(url);

      return {
        url,
        thumbnail_url: toAbsoluteUrl($(image).attr("src"), baseUrl),
        alt: $(image).attr("alt") || ""
      };
    })
    .get()
    .filter(Boolean);
}

function getSkuGroups($, root, baseUrl) {
  return root
    .find(".sku-prop-selection")
    .map((_, group) => {
      const label = normalizeText($(group).find(".section-title-v2").first().text()).replace(/:$/, "");
      const selected = normalizeText($(group).find(".sku-name").first().text()) || null;
      const options = $(group)
        .find(".sku-variable-img-wrap, .sku-variable-img-wrap-selected")
        .map((__, option) => ({
          name: normalizeText($(option).find(".sku-variable-img-name").first().attr("title") || $(option).text()),
          selected: $(option).hasClass("sku-variable-img-wrap-selected"),
          image_url: toAbsoluteUrl(cleanImageUrl($(option).find("img[src]").first().attr("src")), baseUrl)
        }))
        .get()
        .filter((option) => option.name);

      return {
        name: label || null,
        selected,
        options
      };
    })
    .get()
    .filter((group) => group.name || group.options.length);
}

export function parseLazadaProduct(html, pageUrl) {
  const $ = cheerio.load(html);
  const root = $(".pdp-block__main-information").first().length ? $(".pdp-block__main-information").first() : $.root();
  const title = normalizeText(root.find("h1.pdp-mod-product-badge-title-v2").first().text());

  if (!title) {
    throw new Error("Lazada product content was not found in the source page.");
  }

  const baseUrl = pageUrl || "https://www.lazada.vn";
  const salePriceText = normalizeText(root.find(".pdp-v2-product-price-content-salePrice").first().text());
  const originalPriceText = normalizeText(root.find(".pdp-v2-product-price-content-originalPrice-amount").first().text());
  const buyParams = parseBuyParams(root.find('input[name="buyParams"]').first().attr("value"));
  const buyItem = buyParams?.items?.[0] ?? null;
  const images = getImages($, root, baseUrl);
  const skuGroups = getSkuGroups($, root, baseUrl);

  return {
    url: pageUrl,
    item_id: buyItem?.itemId ?? null,
    sku_id: buyItem?.skuId ?? null,
    title,
    is_lazmall: root.find('img[alt*="LazMall" i]').length > 0,
    brand: {
      name: normalizeText(root.find(".pdp-product-brand-v2__brand-link").first().text()) || null,
      url: toAbsoluteUrl(root.find(".pdp-product-brand-v2__brand-link").first().attr("href"), baseUrl)
    },
    price: {
      text: salePriceText || null,
      value: parsePrice(salePriceText),
      currency: salePriceText ? "VND" : null
    },
    original_price: {
      text: originalPriceText || null,
      value: parsePrice(originalPriceText),
      currency: originalPriceText ? "VND" : null
    },
    discount: normalizeText(root.find(".pdp-v2-product-price-content-originalPrice-discount").first().text()) || null,
    delivery: {
      label: normalizeText(root.find(".delivery-header-v2__title").first().text()).replace(/\s*:\s*$/, "") || null,
      address: normalizeText(root.find(".location-v2__address").first().text()) || null,
      method: normalizeText(root.find(".delivery__remain-text").first().text()) || null
    },
    warranty: normalizeText(root.find(".warranty-v2-label-text").first().text()) || null,
    variants: skuGroups,
    quantity: {
      default_value: parseInteger(root.find(".next-number-picker input").first().attr("value")),
      min: parseInteger(root.find(".next-number-picker input").first().attr("min")),
      max: parseInteger(root.find(".next-number-picker input").first().attr("max"))
    },
    images,
    primary_image: images[0]?.url ?? null,
    buy_params: buyParams,
    content_text: normalizeText(root.text())
  };
}

export default async function crawlLazadaSite(input) {
  const url = parseInputUrl(input);
  let response;

  try {
    response = await lazadaInstance.get(`${url.pathname}${url.search}`);
  } catch (error) {
    throw new Error("Lazada crawler could not fetch source page.");
  }

  return parseLazadaProduct(response.data, url.toString());
}
