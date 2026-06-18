import { chromium } from "playwright-core";

const CHROME_EXECUTABLE_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FVIDGO_URL = "https://www.fvidgo.com/facebook-reels-download";

function logInfo(message, details = null) {
  if (details) {
    console.info(`[fvidgo] ${message}`, details);
    return;
  }

  console.info(`[fvidgo] ${message}`);
}

function logWarn(message, details = null) {
  if (details) {
    console.warn(`[fvidgo] ${message}`, details);
    return;
  }

  console.warn(`[fvidgo] ${message}`);
}

function logError(message, details = null) {
  if (details) {
    console.error(`[fvidgo] ${message}`, details);
    return;
  }

  console.error(`[fvidgo] ${message}`);
}

function normalizeText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseInput(input) {
  const rawUrl = input?.facebook_url ?? input?.reel_url ?? input?.video_url ?? input?.url;

  if (!rawUrl || typeof rawUrl !== "string") {
    throw createHttpError(400, "Field 'facebook_url' is required for fvidgo.com crawler.");
  }

  let facebookUrl;
  try {
    facebookUrl = new URL(rawUrl);
  } catch {
    throw createHttpError(400, "Field 'facebook_url' must be a valid Facebook URL.");
  }

  const allowedHosts = new Set([
    "facebook.com",
    "www.facebook.com",
    "m.facebook.com",
    "web.facebook.com",
    "fb.watch"
  ]);

  if (!allowedHosts.has(facebookUrl.hostname)) {
    throw createHttpError(400, "FVidGo crawler only accepts Facebook URLs.");
  }

  return {
    facebookUrl,
    timeoutMs: Number(input?.timeout_ms || 90000),
    browserVisible: input?.browser_visible !== false && input?.headless !== true,
    slowMoMs: Number(input?.slow_mo_ms ?? 150),
    keepBrowserOpenMs: Number(input?.keep_browser_open_ms ?? 0)
  };
}

function isVideoDownloadUrl(url) {
  return /^https:\/\/api\.hitube\.io\/st-tik\/token\//.test(url);
}

function pickHeaders(headers = {}) {
  const headerNames = [
    "accept",
    "accept-language",
    "range",
    "referer",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "sec-fetch-storage-access",
    "user-agent"
  ];

  return headerNames.reduce((result, name) => {
    if (headers[name]) {
      result[name] = headers[name];
    }

    return result;
  }, {});
}

function createCurl(url, headers = {}) {
  const lines = [`curl '${url.replaceAll("'", "'\\''")}'`];

  Object.entries(headers).forEach(([name, value]) => {
    lines.push(`  -H '${name}: ${String(value).replaceAll("'", "'\\''")}'`);
  });

  return lines.join(" \\\n");
}

async function fillFacebookInput(page, facebookUrl) {
  const selectors = [
    "#hero-facebook-link-input",
    "input[name='fvidgo-facebook-link']",
    "input[placeholder*='Facebook']",
    "input[aria-label*='Facebook']",
    "input[type='text']"
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    if ((await locator.count()) > 0 && (await locator.isVisible())) {
      await locator.fill(facebookUrl);
      return selector;
    }
  }

  throw new Error("Facebook URL input was not found.");
}

async function clickDownloadButton(page) {
  const selectors = [
    "button[aria-label='Download']",
    "button:has-text('Download')",
    "[role='button']:has-text('Download')"
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);

      if (await candidate.isVisible()) {
        await candidate.click();
        return selector;
      }
    }
  }

  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
    const button = buttons.find((item) => {
      const text = `${item.getAttribute("aria-label") || ""} ${item.textContent || ""}`;
      const style = window.getComputedStyle(item);

      return /download/i.test(text) && style.display !== "none" && style.visibility !== "hidden";
    });

    if (!button) {
      return false;
    }

    button.click();
    return true;
  });

  if (!clicked) {
    throw new Error("Download button was not found.");
  }

  return "dom-evaluate";
}

async function extractPageData(page) {
  return page.evaluate(() => {
    const normalize = (value) => value.replace(/\s+/g, " ").trim();
    const readElement = (element) => {
      const attrs = {};

      for (const attr of element.attributes || []) {
        if (attr.name.startsWith("data-")) {
          attrs[attr.name] = attr.value;
        }
      }

      return {
        tag: element.tagName.toLowerCase(),
        text: normalize(element.textContent || ""),
        aria_label: element.getAttribute("aria-label"),
        href: element.getAttribute("href"),
        src: element.getAttribute("src") || element.currentSrc || null,
        download: element.getAttribute("download"),
        data: attrs
      };
    };

    const downloadElements = Array.from(document.querySelectorAll("a, button, [role='button']"))
      .map(readElement)
      .filter((item) => {
        const value = `${item.text || ""} ${item.aria_label || ""} ${item.href || ""}`;

        return /download|hitube|video|mp4/i.test(value);
      });

    const media = Array.from(document.querySelectorAll("video, source"))
      .map(readElement)
      .filter((item) => item.src);

    const pageText = normalize(document.body?.innerText || "");

    return {
      title: document.title || null,
      page_text_sample: pageText.slice(0, 1000),
      download_elements: downloadElements,
      media
    };
  });
}

export default async function crawlFvidgoSite(input) {
  const { facebookUrl, timeoutMs, browserVisible, slowMoMs, keepBrowserOpenMs } = parseInput(input);
  const downloadCandidates = new Map();
  let step = 0;
  const logStep = (message, details = null) => {
    step += 1;
    logInfo(`Step ${step}: ${message}`, details);
  };

  const rememberCandidate = (source, url, details = {}) => {
    if (!isVideoDownloadUrl(url)) {
      return;
    }

    const previous = downloadCandidates.get(url) || {};
    downloadCandidates.set(url, {
      url,
      source: previous.source || source,
      seen_at: previous.seen_at || new Date().toISOString(),
      ...previous,
      ...details
    });

    logInfo("Captured video download URL.", {
      source,
      url
    });
  };

  logInfo("Starting Facebook Reels downloader bot.", {
    facebook_url: facebookUrl.toString(),
    timeout_ms: timeoutMs,
    browser_visible: browserVisible,
    slow_mo_ms: slowMoMs,
    keep_browser_open_ms: keepBrowserOpenMs
  });

  logStep("Launching Chrome.", {
    executable_path: CHROME_EXECUTABLE_PATH,
    headless: !browserVisible
  });

  const browser = await chromium.launch({
    executablePath: CHROME_EXECUTABLE_PATH,
    headless: !browserVisible,
    slowMo: browserVisible ? slowMoMs : 0,
    args: [
      "--disable-dev-shm-usage",
      "--no-sandbox"
    ]
  });

  try {
    logStep("Creating browser context.");

    const context = await browser.newContext({
      locale: "en-US",
      timezoneId: "Asia/Ho_Chi_Minh",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      viewport: {
        width: 1366,
        height: 900
      }
    });

    logStep("Opening new page.");

    const page = await context.newPage();

    page.on("console", (message) => {
      const text = normalizeText(message.text());

      if (text && (!text.startsWith("[web-sdk-") || message.type() === "error")) {
        logInfo("Browser console message.", {
          type: message.type(),
          text: text.slice(0, 500)
        });
      }
    });

    page.on("pageerror", (error) => {
      logWarn("Browser page error.", {
        message: error.message
      });
    });

    page.on("request", (request) => {
      const url = request.url();

      if (isVideoDownloadUrl(url)) {
        rememberCandidate("request", url, {
          method: request.method(),
          resource_type: request.resourceType(),
          request_headers: pickHeaders(request.headers())
        });
      }
    });

    page.on("response", (response) => {
      const url = response.url();

      if (isVideoDownloadUrl(url)) {
        rememberCandidate("response", url, {
          status: response.status(),
          response_headers: pickHeaders(response.headers())
        });
      }
    });

    logStep("Navigating to site.", {
      url: FVIDGO_URL
    });

    await page.goto(FVIDGO_URL, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });

    logStep("Waiting for Facebook URL input.");

    await page.waitForSelector("#hero-facebook-link-input, input[name='fvidgo-facebook-link'], input[placeholder*='Facebook']", {
      timeout: timeoutMs
    });

    logStep("Filling Facebook URL.", {
      facebook_url: facebookUrl.toString()
    });

    const inputSelector = await fillFacebookInput(page, facebookUrl.toString());

    logStep("Preparing network listeners for download URL.");

    const requestPromise = page
      .waitForRequest((request) => isVideoDownloadUrl(request.url()), {
        timeout: timeoutMs
      })
      .catch(() => null);
    const responsePromise = page
      .waitForResponse((response) => isVideoDownloadUrl(response.url()), {
        timeout: timeoutMs
      })
      .catch(() => null);
    const domPromise = page
      .waitForFunction(
        () => {
          const values = Array.from(document.querySelectorAll("a, video, source"))
            .flatMap((element) => [
              element.getAttribute("href"),
              element.getAttribute("src"),
              element.currentSrc
            ])
            .filter(Boolean);

          return values.some((value) => /^https:\/\/api\.hitube\.io\/st-tik\/token\//.test(value));
        },
        {
          timeout: timeoutMs,
          polling: 500
        }
      )
      .catch(() => null);

    logStep("Clicking Download button.", {
      input_selector: inputSelector
    });

    const buttonSelector = await clickDownloadButton(page);

    logStep("Waiting for generated video URL.", {
      button_selector: buttonSelector
    });

    await Promise.race([requestPromise, responsePromise, domPromise]);
    await page.waitForTimeout(1500);

    logStep("Extracting page result data.");

    const pageData = await extractPageData(page);

    pageData.media.forEach((item) => {
      if (item.src) {
        rememberCandidate("dom-media", item.src);
      }
    });
    pageData.download_elements.forEach((item) => {
      if (item.href) {
        rememberCandidate("dom-link", item.href);
      }
      if (item.src) {
        rememberCandidate("dom-link-src", item.src);
      }
    });

    const downloads = Array.from(downloadCandidates.values()).map((item) => {
      const headers = item.request_headers || {};

      return {
        ...item,
        curl: createCurl(item.url, headers)
      };
    });
    const bestDownload = downloads[0] || null;

    if (!bestDownload) {
      throw new Error("FVidGo did not generate a hitube video download URL.");
    }

    logStep("Extraction complete.", {
      download_count: downloads.length,
      best_download_url: bestDownload.url
    });

    if (keepBrowserOpenMs > 0) {
      logStep("Keeping browser open for inspection.", {
        keep_browser_open_ms: keepBrowserOpenMs
      });
      await page.waitForTimeout(keepBrowserOpenMs);
    }

    logStep("Closing browser context.");

    await context.close();

    logInfo("Bot finished successfully.");

    return {
      url: FVIDGO_URL,
      facebook_url: facebookUrl.toString(),
      downloads,
      best_download: bestDownload,
      page: pageData
    };
  } catch (error) {
    logError("FVidGo bot failed.", {
      facebook_url: facebookUrl.toString(),
      step,
      message: error.message
    });
    throw new Error(`FVidGo crawler failed: ${error.message}`);
  } finally {
    logInfo("Closing Chrome.");
    await browser.close();
  }
}
