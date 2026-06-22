import * as cheerio from "cheerio";

import createAxiosInstance from "../../../lib/create-axios-instance.js";

const LITTLEBIT_BASE_URL = "https://www.littlebit.de";

const littlebitInstance = createAxiosInstance(LITTLEBIT_BASE_URL, {
  headers: {
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "de,en;q=0.9"
  }
});

function normalizeText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function toAbsoluteUrl(value, baseUrl = LITTLEBIT_BASE_URL) {
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
    const error = new Error("Field 'url' is required for littlebit.de crawler.");
    error.statusCode = 400;
    throw error;
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    const error = new Error("Field 'url' must be a valid Littlebit product URL.");
    error.statusCode = 400;
    throw error;
  }

  if (!["littlebit.de", "www.littlebit.de"].includes(url.hostname)) {
    const error = new Error("Littlebit crawler only accepts URLs from littlebit.de.");
    error.statusCode = 400;
    throw error;
  }

  return url;
}

function parseJsonAttribute(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseBrandFromTitle(title) {
  const firstWord = normalizeText(title).split(" ")[0];
  return firstWord || null;
}

function parseBrand($, title) {
  const extra = parseJsonAttribute($("plugilo-plugit-trigger[data-content-extra]").first().attr("data-content-extra"));
  const ownerDomain = extra?.ownerDomain || null;
  let name = parseBrandFromTitle(title);

  if (ownerDomain?.toLowerCase().includes("logitech")) {
    name = "Logitech";
  }

  return {
    name,
    owner_domain: ownerDomain,
    plugilo_name: extra?.name || null
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

function getImages($, baseUrl) {
  const seen = new Set();
  const images = [];

  $(
    [
      ".gallery-placeholder__image[src]",
      ".fotorama__stage__frame[href]",
      ".fotorama__img[src]",
      "link[itemprop='image'][href]",
      "plugilo-plugit-trigger[data-preview-img-url]"
    ].join(", ")
  ).each((_, element) => {
    const node = $(element);
    const rawUrl =
      node.attr("href") || node.attr("src") || node.attr("data-preview-img-url");
    const url = toAbsoluteUrl(rawUrl, baseUrl);

    addImage(images, seen, {
      url,
      alt: normalizeText(node.attr("alt") || node.attr("aria-label") || "")
    });
  });

  return images;
}

function parseKeyValueList($, selector, labelSelector, valueSelector) {
  return $(selector)
    .map((_, item) => {
      const node = $(item);
      const name = normalizeText(node.find(labelSelector).first().text()).replace(/:\s*$/, "");
      const value = normalizeText(node.find(valueSelector).first().text());

      if (!name && !value) {
        return null;
      }

      return { name, value };
    })
    .get()
    .filter(Boolean);
}

function getAttributeGroups($) {
  return $(".attributes-group")
    .map((_, group) => {
      const node = $(group);
      const groupName = normalizeText(node.find("h4.label.attributes-group").first().text());
      const terms = node.find("dl.attributes-data").first();
      const items = [];

      terms.find("dt.label").each((index, term) => {
        const name = normalizeText($(term).text());
        const value = normalizeText(terms.find("dd.data").eq(index).text());

        if (name || value) {
          items.push({ name, value });
        }
      });

      if (!groupName && items.length === 0) {
        return null;
      }

      return {
        group: groupName || null,
        items
      };
    })
    .get()
    .filter(Boolean);
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

function getAttachments($, baseUrl) {
  return $("#productattach table.attachment-table tbody tr")
    .map((_, row) => {
      const columns = $(row).find("td");
      const downloadLink = $(row).find("td.download-attachment a[href]").first();
      const name = normalizeText(columns.eq(1).text());
      const downloadUrl = toAbsoluteUrl(downloadLink.attr("href"), baseUrl);

      if (!name && !downloadUrl) {
        return null;
      }

      return {
        icon_url: toAbsoluteUrl($(row).find("td.attachment-icon img[src]").first().attr("src"), baseUrl),
        name,
        description: normalizeText(columns.eq(2).text()) || null,
        type: normalizeText(columns.eq(3).text()) || null,
        size: normalizeText(columns.eq(4).text()) || null,
        download_url: downloadUrl
      };
    })
    .get()
    .filter(Boolean);
}

function requiresLoginForPriceAvailability($) {
  const pageText = normalizeText($("body").text()).toLowerCase();

  return (
    pageText.includes("preise") &&
    pageText.includes("verfügbarkeit") &&
    pageText.includes("melden sie sich bitte an")
  );
}

export function parseLittlebitProduct(html, pageUrl = LITTLEBIT_BASE_URL) {
  const $ = cheerio.load(html);
  const root = $(".product-info-main").first().length ? $(".product-info-main").first() : $.root();
  const title = normalizeText(root.find(".page-title .base[itemprop='name']").first().text());

  if (!title) {
    throw new Error("Littlebit product content was not found in the source page.");
  }

  const baseUrl = pageUrl || LITTLEBIT_BASE_URL;
  const attributeGroups = getAttributeGroups($);
  const images = getImages($, baseUrl);
  const loginRequired = requiresLoginForPriceAvailability($);

  return {
    url: pageUrl,
    product_id: root.find("input[name='product']").first().attr("value") || null,
    item_id: root.find("input[name='item']").first().attr("value") || null,
    title,
    sku: normalizeText(root.find(".product.attribute.sku [itemprop='sku']").first().text()) || root.find("form[data-product-sku]").first().attr("data-product-sku") || null,
    manufacturer_number: normalizeText(root.find(".product.attribute.vendor-item-sku [itemprop='mpn']").first().text()) || null,
    ean: normalizeText(root.find(".product.attribute.vendor-item-barcode [itemprop='gtin']").first().text()) || null,
    description: normalizeText(root.find(".product.attribute.overview [itemprop='description']").first().text()) || null,
    brand: parseBrand($, title),
    price: null,
    availability: null,
    requires_login_for_price_availability: loginRequired,
    attributes: getFlatAttributes(attributeGroups),
    attribute_groups: attributeGroups,
    package_contents: parseKeyValueList($, ".attributes.package-contents li.item", ".label", ".data"),
    warranty: parseKeyValueList($, ".attributes.warranty li.item", ".label", ".data"),
    attachments: getAttachments($, baseUrl),
    images,
    primary_image: images[0]?.url ?? null,
    content_text: normalizeText(root.text())
  };
}

export default async function crawlLittlebitSite(input) {
  const url = parseInputUrl(input);
  let response;

  try {
    response = await littlebitInstance.get(`${url.pathname}${url.search}`);
  } catch (error) {
    throw new Error("Littlebit crawler could not fetch source page.");
  }

  return parseLittlebitProduct(response.data, url.toString());
}
