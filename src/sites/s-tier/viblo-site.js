import * as cheerio from "cheerio";

import createAxiosInstance from "../../lib/create-axios-instance.js";

const vibloInstance = createAxiosInstance("https://viblo.asia", {
  headers: {
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "vi,en;q=0.9"
  }
});

function normalizeText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function toAbsoluteUrl(value, baseUrl = "https://viblo.asia") {
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

function getStatValue($, article, label) {
  const item = article
    .find(`[data-original-title*="${label}"]`)
    .first();

  return parseInteger(item.find("span").first().text() || item.text());
}

function parseInputUrl(input) {
  const rawUrl = input?.url;

  if (!rawUrl || typeof rawUrl !== "string") {
    const error = new Error("Field 'url' is required for viblo.asia crawler.");
    error.statusCode = 400;
    throw error;
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    const error = new Error("Field 'url' must be a valid Viblo article URL.");
    error.statusCode = 400;
    throw error;
  }

  if (url.hostname !== "viblo.asia") {
    const error = new Error("Viblo crawler only accepts URLs from viblo.asia.");
    error.statusCode = 400;
    throw error;
  }

  return url;
}

export function parseVibloArticle(html, pageUrl) {
  const $ = cheerio.load(html);
  const article = $("article.post-content").first();

  if (!article.length) {
    throw new Error("Viblo article content was not found in the source page.");
  }

  const body = article.find(".article-content__body .md-contents").first();
  const bodyForText = body.clone();
  bodyForText.find(".v-markdown-it-code-copy, .v-markdown-it-show-more").remove();

  const publishedMeta = article.find(".post-meta > div.text-muted").first();
  const publishedMetaText = publishedMeta.clone();
  publishedMetaText.find(".post-reading_time").remove();

  const author = article.find(".post-author").first();
  const title = normalizeText(article.find(".article-content__title").first().text());
  const contentText = normalizeText(bodyForText.text());
  const baseUrl = pageUrl || "https://viblo.asia";

  const links = body
    .find("a[href]")
    .map((_, link) => ({
      text: normalizeText($(link).text()),
      url: toAbsoluteUrl($(link).attr("href"), baseUrl)
    }))
    .get()
    .filter((link) => link.url);

  return {
    url: pageUrl,
    title,
    author: {
      name: normalizeText(author.find(".post-author__name").first().text()),
      username: normalizeText(author.find(".text-muted").first().text()).replace(/^@/, ""),
      profile_url: toAbsoluteUrl(author.find('a[href^="/u/"]').first().attr("href"), baseUrl),
      avatar_url: toAbsoluteUrl(author.find("img.avatar").first().attr("src"), baseUrl)
    },
    published_text: normalizeText(publishedMetaText.text()) || null,
    published_title: publishedMeta.attr("title") || null,
    reading_time: normalizeText(article.find(".post-reading_time").first().text()) || null,
    stats: {
      views: getStatValue($, article, "Lượt xem"),
      comments: getStatValue($, article, "bình luận"),
      bookmarks: getStatValue($, article, "bookmark")
    },
    tags: article
      .find(".tags a.tag")
      .map((_, tag) => normalizeText($(tag).text()))
      .get()
      .filter(Boolean),
    headings: body
      .find("h1,h2,h3,h4,h5,h6")
      .map((_, heading) => ({
        level: Number.parseInt(heading.tagName.slice(1), 10),
        text: normalizeText($(heading).text())
      }))
      .get()
      .filter((heading) => heading.text),
    images: body
      .find("img[src]")
      .map((_, image) => ({
        url: toAbsoluteUrl($(image).attr("src"), baseUrl),
        alt: $(image).attr("alt") || ""
      }))
      .get(),
    links,
    code_blocks: body
      .find("pre code")
      .map((_, code) => ({
        language: ($(code).attr("class") || "").replace(/^language-/, "") || null,
        text: $(code).text()
      }))
      .get(),
    excerpt: contentText.slice(0, 300),
    content_text: contentText,
    content_html: body.html()?.trim() || "",
    license: normalizeText(article.find(".license-text").first().text()) || null
  };
}

export default async function crawlVibloSite(input) {
  const url = parseInputUrl(input);
  let response;

  try {
    response = await vibloInstance.get(`${url.pathname}${url.search}`);
  } catch (error) {
    throw new Error("Viblo crawler could not fetch source page.");
  }

  return parseVibloArticle(response.data, url.toString());
}
