import * as cheerio from "cheerio";

import createAxiosInstance from "../../lib/create-axios-instance.js";

const dantriInstance = createAxiosInstance("https://dantri.com.vn", {
  headers: {
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "vi,en;q=0.9"
  }
});

function normalizeText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function toAbsoluteUrl(value, baseUrl = "https://dantri.com.vn") {
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
    const error = new Error("Field 'url' is required for dantri.com.vn crawler.");
    error.statusCode = 400;
    throw error;
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    const error = new Error("Field 'url' must be a valid Dantri article URL.");
    error.statusCode = 400;
    throw error;
  }

  if (url.hostname !== "dantri.com.vn" && url.hostname !== "www.dantri.com.vn") {
    const error = new Error("Dantri crawler only accepts URLs from dantri.com.vn.");
    error.statusCode = 400;
    throw error;
  }

  return url;
}

function cleanContent($, content) {
  const cleaned = content.clone();

  cleaned
    .find(
      [
        "script",
        "style",
        "iframe",
        "button",
        "svg",
        ".dta-unit",
        '[id^="dta-"]',
        '[id^="ps-"]',
        '[class*="ps-"]',
        '[data-module*="audio"]',
        '[data-module*="video"]'
      ].join(",")
    )
    .remove();

  return cleaned;
}

export function parseDantriArticle(html, pageUrl) {
  const $ = cheerio.load(html);
  const article = $('article[data-slot="container"]').first();

  if (!article.length) {
    throw new Error("Dantri article content was not found in the source page.");
  }

  const content = article.find('[data-slot="content"]').first();
  const cleanedContent = cleanContent($, content);
  const baseUrl = pageUrl || "https://dantri.com.vn";
  const publishedTime = $("time[datetime]").first();
  const authorLink = article.find('a[rel="author"]').filter((_, link) => normalizeText($(link).text())).first();

  const images = cleanedContent
    .find("figure.image img[src], figure.image img[data-src]")
    .map((_, image) => {
      const figure = $(image).closest("figure");

      return {
        url: toAbsoluteUrl($(image).attr("data-original") || $(image).attr("src") || $(image).attr("data-src"), baseUrl),
        thumbnail_url: toAbsoluteUrl($(image).attr("src") || $(image).attr("data-src"), baseUrl),
        alt: $(image).attr("alt") || "",
        title: $(image).attr("title") || "",
        caption: normalizeText(figure.find("figcaption").text()) || null,
        width: $(image).attr("data-width") ? Number.parseInt($(image).attr("data-width"), 10) : null,
        height: $(image).attr("data-height") ? Number.parseInt($(image).attr("data-height"), 10) : null
      };
    })
    .get()
    .filter((image) => image.url);

  const links = cleanedContent
    .find("a[href]")
    .map((_, link) => ({
      text: normalizeText($(link).text()),
      url: toAbsoluteUrl($(link).attr("href"), baseUrl)
    }))
    .get()
    .filter((link) => link.url);

  const contentText = cleanedContent
    .find("h2,h3,h4,h5,h6,p,li")
    .map((_, block) => normalizeText($(block).text()))
    .get()
    .filter(Boolean)
    .join(" ");

  return {
    url: pageUrl,
    title: normalizeText(article.find('[data-slot="title"]').first().text()),
    sapo: normalizeText(article.find('[data-slot="sapo"]').first().text()) || null,
    category: $('a[data-content-name="article-breadcrumb"]')
      .map((_, link) => ({
        name: normalizeText($(link).text()),
        url: toAbsoluteUrl($(link).attr("href"), baseUrl)
      }))
      .get()
      .filter((item) => item.name),
    author: {
      name: normalizeText(authorLink.text()) || null,
      profile_url: toAbsoluteUrl(authorLink.attr("href"), baseUrl),
      avatar_url: toAbsoluteUrl(article.find('a[rel="author"] img').first().attr("src"), baseUrl)
    },
    published_at: publishedTime.attr("datetime") || null,
    published_text: normalizeText(publishedTime.text()) || null,
    audio_url: toAbsoluteUrl(article.find("audio[src]").first().attr("src"), baseUrl),
    tags: $('a[data-content-name="article-tags"]')
      .map((_, tag) => normalizeText($(tag).text()))
      .get()
      .filter(Boolean),
    images,
    links,
    headings: cleanedContent
      .find("h2,h3,h4,h5,h6")
      .map((_, heading) => ({
        level: Number.parseInt(heading.tagName.slice(1), 10),
        text: normalizeText($(heading).text())
      }))
      .get()
      .filter((heading) => heading.text),
    excerpt: contentText.slice(0, 300),
    content_text: contentText,
    content_html: cleanedContent.html()?.trim() || ""
  };
}

export default async function crawlDantriSite(input) {
  const url = parseInputUrl(input);
  let response;

  try {
    response = await dantriInstance.get(`${url.pathname}${url.search}`);
  } catch (error) {
    throw new Error("Dantri crawler could not fetch source page.");
  }

  return parseDantriArticle(response.data, url.toString());
}
