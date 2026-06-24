import * as cheerio from "cheerio";
import { PDFParse } from "pdf-parse";

import { logError, logEvent, logWarn } from "../../../core/logger.js";
import createAxiosInstance from "../../../lib/create-axios-instance.js";
import { detectProductAttributesFromContent } from "../../../services/ai-attribute-service.js";

const LITTLEBIT_BASE_URL = "https://www.littlebit.de";

const littlebitInstance = createAxiosInstance(LITTLEBIT_BASE_URL, {
  headers: {
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "de,en;q=0.9"
  }
});

const littlebitPdfInstance = createAxiosInstance(LITTLEBIT_BASE_URL, {
  headers: {
    Accept: "application/pdf,*/*",
    "Accept-Language": "de,en;q=0.9"
  },
  responseType: "arraybuffer"
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

function isPdfUrl(value = "") {
  try {
    const url = new URL(value, LITTLEBIT_BASE_URL);
    return url.pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return /\.pdf(?:$|[?#])/i.test(value);
  }
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

async function extractPdfContent(pdfUrl, options = {}) {
  const hasExplicitMaxTextLength =
    options.maxTextLength !== undefined &&
    options.maxTextLength !== null &&
    options.maxTextLength !== "";
  const maxTextLength = hasExplicitMaxTextLength
    ? Math.max(0, Number(options.maxTextLength) || 0)
    : Number.POSITIVE_INFINITY;
  let response;
  let parser;

  logEvent("littlebit.pdf.fetch.start", {
    site: "littlebit.de",
    pdf_url: pdfUrl
  });

  try {
    const url = new URL(pdfUrl);
    response = await littlebitPdfInstance.get(`${url.pathname}${url.search}`);
  } catch (error) {
    logError("littlebit.pdf.fetch.failed", {
      site: "littlebit.de",
      pdf_url: pdfUrl,
      error: error.message
    });
    throw new Error(`Littlebit crawler could not fetch PDF attachment: ${pdfUrl}`);
  }

  try {
    const pdfData = Uint8Array.from(Buffer.from(response.data));
    parser = new PDFParse({
      data: pdfData
    });

    const info = await parser.getInfo({ parsePageInfo: false }).catch(() => null);
    const textResult = await parser.getText();
    const text = normalizeText(textResult.text || "");
    const textTruncated = Number.isFinite(maxTextLength) && text.length > maxTextLength;
    const payload = {
      site: "littlebit.de",
      pdf_url: pdfUrl,
      content_type: response.headers?.["content-type"] || null,
      size_bytes: Number(response.headers?.["content-length"] || response.data?.byteLength || 0) || null,
      page_count: info?.total ?? textResult.total ?? null,
      text_length: text.length,
      text_truncated: textTruncated
    };

    logEvent("littlebit.pdf.fetch.success", payload);

    return {
      url: pdfUrl,
      content_type: payload.content_type,
      size_bytes: payload.size_bytes,
      page_count: payload.page_count,
      info: info?.info || null,
      text: textTruncated ? text.slice(0, maxTextLength) : text,
      text_truncated: textTruncated,
      text_length: text.length
    };
  } finally {
    await parser?.destroy?.();
  }
}

async function enrichPdfAttachments(attachments, options = {}) {
  if (options.enabled === false) {
    return {
      attachments,
      pdfDocuments: []
    };
  }

  const hasExplicitMaxPdfs =
    options.maxPdfs !== undefined &&
    options.maxPdfs !== null &&
    options.maxPdfs !== "";
  const maxPdfs = hasExplicitMaxPdfs
    ? Math.max(0, Number(options.maxPdfs) || 0)
    : Number.POSITIVE_INFINITY;
  let parsedCount = 0;

  const enriched = [];
  const pdfDocuments = [];
  for (const attachment of attachments) {
    if (!attachment.download_url || !isPdfUrl(attachment.download_url) || parsedCount >= maxPdfs) {
      if (attachment.download_url && isPdfUrl(attachment.download_url) && parsedCount >= maxPdfs) {
        logWarn("littlebit.pdf.skip.max_reached", {
          site: "littlebit.de",
          pdf_url: attachment.download_url,
          attachment_name: attachment.name,
          max_pdfs: Number.isFinite(maxPdfs) ? maxPdfs : null
        });
      }
      enriched.push(attachment);
      continue;
    }

    try {
      parsedCount += 1;
      logEvent("littlebit.pdf.attachment.read.start", {
        site: "littlebit.de",
        pdf_url: attachment.download_url,
        attachment_name: attachment.name,
        attachment_index: parsedCount
      });
      const pdf = await extractPdfContent(attachment.download_url, options);
      const aiAttributes = await detectProductAttributesFromContent(pdf.text, {
        enabled: options.detectAttributes !== false,
        title: attachment.name,
        sourceUrl: attachment.download_url
      });
      logEvent("littlebit.pdf.attachment.read.success", {
        site: "littlebit.de",
        pdf_url: attachment.download_url,
        attachment_name: attachment.name,
        text_length: pdf.text_length,
        page_count: pdf.page_count
      });
      enriched.push({
        ...attachment,
        pdf_extracted: true,
        pdf_page_count: pdf.page_count,
        pdf_text_length: pdf.text_length
      });
      pdfDocuments.push({
        name: attachment.name,
        description: attachment.description,
        type: attachment.type,
        size: attachment.size,
        download_url: attachment.download_url,
        pdf: {
          ...pdf,
          ai_attributes: aiAttributes
        }
      });
    } catch (error) {
      logError("littlebit.pdf.attachment.read.failed", {
        site: "littlebit.de",
        pdf_url: attachment.download_url,
        attachment_name: attachment.name,
        error: error.message
      });
      enriched.push({
        ...attachment,
        pdf_extracted: false,
        pdf_error: error.message
      });
      pdfDocuments.push({
        name: attachment.name,
        description: attachment.description,
        type: attachment.type,
        size: attachment.size,
        download_url: attachment.download_url,
        pdf: {
          url: attachment.download_url,
          error: error.message
        }
      });
    }
  }

  return {
    attachments: enriched,
    pdfDocuments
  };
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
    package_contents: parseKeyValueList($, ".attributes.package-contents li.item", ".label", ".data"),
    warranty: parseKeyValueList($, ".attributes.warranty li.item", ".label", ".data"),
    attachments: getAttachments($, baseUrl),
    images,
    primary_image: images[0]?.url ?? null
  };
}

export default async function crawlLittlebitSite(input) {
  const url = parseInputUrl(input);
  logEvent("littlebit.crawl.start", {
    site: "littlebit.de",
    url: url.toString(),
    read_pdf_attachments: input?.read_pdf_attachments !== false,
    detect_pdf_attributes: input?.detect_pdf_attributes !== false
  });

  if (isPdfUrl(url.toString())) {
    const pdf = await extractPdfContent(url.toString(), {
      maxTextLength: input?.pdf_max_text_length
    });
    const aiAttributes = await detectProductAttributesFromContent(pdf.text, {
      enabled: input?.detect_pdf_attributes !== false,
      title: pdf.info?.Title || url.pathname.split("/").pop() || null,
      sourceUrl: url.toString()
    });

    return {
      url: url.toString(),
      document_type: "pdf",
      title: pdf.info?.Title || url.pathname.split("/").pop() || null,
      pdf: {
        ...pdf,
        ai_attributes: aiAttributes
      },
      ai_attributes: aiAttributes,
      content_text: pdf.text
    };
  }

  let response;

  try {
    response = await littlebitInstance.get(`${url.pathname}${url.search}`);
  } catch (error) {
    logError("littlebit.page.fetch.failed", {
      site: "littlebit.de",
      url: url.toString(),
      error: error.message
    });
    throw new Error("Littlebit crawler could not fetch source page.");
  }

  const product = parseLittlebitProduct(response.data, url.toString());
  logEvent("littlebit.page.parse.success", {
    site: "littlebit.de",
    url: url.toString(),
    title: product.title,
    attachment_count: product.attachments.length
  });
  const enrichedAttachments = await enrichPdfAttachments(product.attachments, {
    enabled: input?.read_pdf_attachments !== false,
    detectAttributes: input?.detect_pdf_attributes !== false,
    maxPdfs: input?.pdf_max_count,
    maxTextLength: input?.pdf_max_text_length
  });
  product.attachments = enrichedAttachments.attachments;
  product.pdf_attachments = enrichedAttachments.pdfDocuments;

  logEvent("littlebit.crawl.success", {
    site: "littlebit.de",
    url: url.toString(),
    title: product.title,
    attachment_count: product.attachments.length,
    pdf_attachment_count: product.pdf_attachments.length,
    pdf_attachments_text_length: product.pdf_attachments
      .map((item) => item.pdf?.text_length || 0)
      .reduce((sum, value) => sum + value, 0)
  });

  return product;
}
