import * as cheerio from "cheerio";

import createAxiosInstance from "../../lib/create-axios-instance.js";

const HORIZONT_JOBS_BASE_URL = "https://horizont.jobs";

const horizontJobsInstance = createAxiosInstance(HORIZONT_JOBS_BASE_URL, {
  headers: {
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "de,en;q=0.9"
  }
});

function normalizeText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function toAbsoluteUrl(value, baseUrl = HORIZONT_JOBS_BASE_URL) {
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
    const error = new Error("Field 'url' is required for horizont.jobs crawler.");
    error.statusCode = 400;
    throw error;
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    const error = new Error("Field 'url' must be a valid Horizont Jobs URL.");
    error.statusCode = 400;
    throw error;
  }

  if (!["horizont.jobs", "www.horizont.jobs"].includes(url.hostname)) {
    const error = new Error("Horizont Jobs crawler only accepts URLs from horizont.jobs.");
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

function getFirstAttr($, selectors, attributeName) {
  for (const selector of selectors) {
    const value = $(selector).first().attr(attributeName);

    if (normalizeText(value)) {
      return value;
    }
  }

  return null;
}

function getValueOrNull(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function cleanContent($, content) {
  const cleaned = content.clone();

  cleaned
    .find(
      [
        "script",
        "style",
        "noscript",
        "iframe",
        "svg",
        "button",
        "form",
        ".share",
        ".social",
        ".advertisement",
        ".ads",
        "[class*='cookie']"
      ].join(",")
    )
    .remove();

  return cleaned;
}

function getLocation(jobPosting) {
  const directAddress = jobPosting?.jobLocation?.address;
  const addresses = [jobPosting?.jobLocation].flatMap((value) => (Array.isArray(value) ? value : [value]));
  const firstAddress = addresses[0]?.address || directAddress;

  return {
    address_locality: getValueOrNull(firstAddress?.addressLocality),
    address_region: getValueOrNull(firstAddress?.addressRegion),
    postal_code: getValueOrNull(firstAddress?.postalCode),
    street_address: getValueOrNull(firstAddress?.streetAddress),
    address_country: getValueOrNull(firstAddress?.addressCountry?.name || firstAddress?.addressCountry),
    raw: getValueOrNull(
      [
        firstAddress?.streetAddress,
        firstAddress?.postalCode,
        firstAddress?.addressLocality,
        firstAddress?.addressRegion,
        firstAddress?.addressCountry?.name || firstAddress?.addressCountry
      ]
        .filter(Boolean)
        .join(", ")
    )
  };
}

function getEmploymentTypes(jobPosting) {
  return [jobPosting?.employmentType]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function getIdentifiers(jobPosting) {
  const identifier = jobPosting?.identifier;

  return {
    id: getValueOrNull(identifier?.value || jobPosting?.identifier || jobPosting?.jobId),
    name: getValueOrNull(identifier?.name)
  };
}

function getImages($, pageUrl) {
  return $("meta[property='og:image'][content], meta[name='twitter:image'][content], img[src], img[data-src]")
    .map((_, element) => {
      const node = $(element);
      const url = toAbsoluteUrl(
        node.attr("content") || node.attr("src") || node.attr("data-src"),
        pageUrl
      );

      if (!url) {
        return null;
      }

      return {
        url,
        alt: node.attr("alt") || node.attr("title") || ""
      };
    })
    .get()
    .filter((image, index, items) => image && items.findIndex((item) => item.url === image.url) === index);
}

export function parseHorizontJobsPage(html, pageUrl = HORIZONT_JOBS_BASE_URL) {
  const $ = cheerio.load(html);
  const jsonLdEntries = getJsonLdEntries($);
  const jobPosting =
    jsonLdEntries.find((entry) => hasType(entry, "JobPosting")) ||
    jsonLdEntries.find((entry) => normalizeText(entry?.title || entry?.name) && normalizeText(entry?.description));

  const article =
    $("article").first().length
      ? $("article").first()
      : $("main").first().length
        ? $("main").first()
        : $.root();

  const cleanedContent = cleanContent($, article);
  const title =
    getValueOrNull(jobPosting?.title || jobPosting?.name) ||
    getFirstContent($, [
      "meta[property='og:title'][content]",
      "meta[name='twitter:title'][content]"
    ]) ||
    getFirstText($, ["h1", "[itemprop='title']", "title"]);

  if (!title) {
    throw new Error("Horizont Jobs content was not found in the source page.");
  }

  const contentText = cleanedContent
    .find("h1,h2,h3,h4,h5,h6,p,li,dd,dt")
    .map((_, block) => normalizeText($(block).text()))
    .get()
    .filter(Boolean)
    .join(" ");

  const baseUrl = pageUrl || HORIZONT_JOBS_BASE_URL;
  const organization = jobPosting?.hiringOrganization || {};
  const location = getLocation(jobPosting);
  const identifiers = getIdentifiers(jobPosting);
  const images = getImages($, baseUrl);

  return {
    url: toAbsoluteUrl(getFirstAttr($, ["link[rel='canonical']"], "href"), baseUrl) || pageUrl,
    title,
    company: {
      name:
        getValueOrNull(organization?.name) ||
        getFirstText($, [
          "[itemprop='hiringOrganization'] [itemprop='name']",
          ".company",
          "[class*='company']"
        ]) ||
        null,
      same_as: toAbsoluteUrl(organization?.sameAs, baseUrl),
      logo_url: toAbsoluteUrl(organization?.logo?.url || organization?.logo, baseUrl)
    },
    identifier: identifiers,
    location,
    employment_types: getEmploymentTypes(jobPosting),
    date_posted: getValueOrNull(jobPosting?.datePosted) || getFirstAttr($, ["time[datetime]"], "datetime"),
    valid_through: getValueOrNull(jobPosting?.validThrough),
    description:
      getValueOrNull(jobPosting?.description) ||
      getFirstContent($, [
        "meta[name='description'][content]",
        "meta[property='og:description'][content]"
      ]) ||
      null,
    direct_apply: jobPosting?.directApply ?? null,
    remote: jobPosting?.jobLocationType === "TELECOMMUTE",
    salary: jobPosting?.baseSalary || null,
    industry: getValueOrNull(jobPosting?.industry),
    qualifications: getValueOrNull(jobPosting?.qualifications),
    responsibilities: getValueOrNull(jobPosting?.responsibilities),
    skills: getValueOrNull(jobPosting?.skills),
    education_requirements: getValueOrNull(jobPosting?.educationRequirements),
    experience_requirements: getValueOrNull(jobPosting?.experienceRequirements),
    images,
    primary_image: images[0]?.url ?? null,
    links: cleanedContent
      .find("a[href]")
      .map((_, link) => ({
        text: normalizeText($(link).text()),
        url: toAbsoluteUrl($(link).attr("href"), baseUrl)
      }))
      .get()
      .filter((link) => link.url),
    headings: cleanedContent
      .find("h1,h2,h3,h4,h5,h6")
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

export default async function crawlHorizontJobsSite(input) {
  const url = parseInputUrl(input);
  let response;

  try {
    response = await horizontJobsInstance.get(`${url.pathname}${url.search}`);
  } catch {
    throw new Error("Horizont Jobs crawler could not fetch source page.");
  }

  return parseHorizontJobsPage(response.data, url.toString());
}
