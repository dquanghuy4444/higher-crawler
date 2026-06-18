import { chromium } from "playwright-core";

const CHROME_EXECUTABLE_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const THUMBNAIL_GRABBER_URL = "https://youtube-thumbnail-grabber.com/";

function logInfo(message, details = null) {
  if (details) {
    console.info(`[youtube-thumbnail-grabber] ${message}`, details);
    return;
  }

  console.info(`[youtube-thumbnail-grabber] ${message}`);
}

function logWarn(message, details = null) {
  if (details) {
    console.warn(`[youtube-thumbnail-grabber] ${message}`, details);
    return;
  }

  console.warn(`[youtube-thumbnail-grabber] ${message}`);
}

function logError(message, details = null) {
  if (details) {
    console.error(`[youtube-thumbnail-grabber] ${message}`, details);
    return;
  }

  console.error(`[youtube-thumbnail-grabber] ${message}`);
}

function normalizeText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function parseInput(input) {
  const rawUrl = input?.youtube_url ?? input?.video_url ?? input?.url;

  if (!rawUrl || typeof rawUrl !== "string") {
    const error = new Error("Field 'youtube_url' is required for youtube-thumbnail-grabber.com crawler.");
    error.statusCode = 400;
    throw error;
  }

  let youtubeUrl;
  try {
    youtubeUrl = new URL(rawUrl);
  } catch {
    const error = new Error("Field 'youtube_url' must be a valid YouTube URL.");
    error.statusCode = 400;
    throw error;
  }

  if (!["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(youtubeUrl.hostname)) {
    const error = new Error("YouTube Thumbnail Grabber crawler only accepts YouTube URLs.");
    error.statusCode = 400;
    throw error;
  }

  return {
    youtubeUrl,
    timeoutMs: Number(input?.timeout_ms || 60000),
    browserVisible: input?.browser_visible !== false && input?.headless !== true,
    slowMoMs: Number(input?.slow_mo_ms ?? 150),
    keepBrowserOpenMs: Number(input?.keep_browser_open_ms ?? 0)
  };
}

function getYouTubeVideoId(rawUrl) {
  const url = new URL(rawUrl);

  if (url.hostname === "youtu.be") {
    return url.pathname.split("/").filter(Boolean)[0] ?? null;
  }

  if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/")) {
    return url.pathname.split("/").filter(Boolean)[1] ?? null;
  }

  return url.searchParams.get("v");
}

function parseResolution(text = "") {
  const match = text.match(/(\d+)\s*x\s*(\d+)/i);

  return {
    width: match ? Number.parseInt(match[1], 10) : null,
    height: match ? Number.parseInt(match[2], 10) : null
  };
}

async function extractThumbnails(page) {
  return page.evaluate(() => {
    const normalize = (value) => value.replace(/\s+/g, " ").trim();
    const parseResolution = (value) => {
      const match = value.match(/(\d+)\s*x\s*(\d+)/i);

      return {
        width: match ? Number.parseInt(match[1], 10) : null,
        height: match ? Number.parseInt(match[2], 10) : null
      };
    };
    const entries = [
      {
        key: "hd",
        labelSelector: "#hdrestext",
        linkSelector: "#hdreslink",
        imageSelector: "#maxres"
      },
      {
        key: "sd",
        labelSelector: "#sdrestext",
        linkSelector: "#sdreslink",
        imageSelector: "#sdres"
      },
      {
        key: "hq",
        labelSelector: "#normalrestext",
        linkSelector: "#hqreslink",
        imageSelector: "#hqres"
      },
      {
        key: "mq",
        labelSelector: "#mqreslink",
        linkSelector: "#mqreslink",
        imageSelector: "#mqres"
      },
      {
        key: "default",
        labelSelector: "#defreslink",
        linkSelector: "#defreslink",
        imageSelector: "#defres"
      }
    ];

    return entries
      .map((entry) => {
        const labelElement = document.querySelector(entry.labelSelector);
        const linkElement = document.querySelector(entry.linkSelector);
        const imageElement = document.querySelector(entry.imageSelector);
        const labelText = normalize(labelElement?.textContent || linkElement?.textContent || "");
        const resolution = parseResolution(labelText);

        return {
          key: entry.key,
          quality: linkElement?.getAttribute("data-quality") || entry.key.toUpperCase(),
          label: labelText || null,
          width: resolution.width,
          height: resolution.height,
          image_url: imageElement?.getAttribute("src") || null,
          download_text: normalize(linkElement?.textContent || ""),
          data_id: linkElement?.getAttribute("data-id") || null,
          visible:
            Boolean(imageElement?.getAttribute("src")) &&
            getComputedStyle(imageElement).display !== "none" &&
            getComputedStyle(linkElement).display !== "none"
        };
      })
      .filter((item) => item.image_url);
  });
}

export default async function crawlYoutubeThumbnailGrabberSite(input) {
  const { youtubeUrl, timeoutMs, browserVisible, slowMoMs, keepBrowserOpenMs } = parseInput(input);
  const expectedVideoId = getYouTubeVideoId(youtubeUrl.toString());
  let step = 0;
  const logStep = (message, details = null) => {
    step += 1;
    logInfo(`Step ${step}: ${message}`, details);
  };

  logInfo("Starting thumbnail grabber bot.", {
    youtube_url: youtubeUrl.toString(),
    expected_video_id: expectedVideoId,
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
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      viewport: {
        width: 1366,
        height: 900
      }
    });

    logStep("Opening new page.");

    const page = await context.newPage();

    page.on("console", (message) => {
      const text = normalizeText(message.text());

      if (text && !text.startsWith("[a#")) {
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

    logStep("Navigating to site.", {
      url: THUMBNAIL_GRABBER_URL
    });

    await page.goto(THUMBNAIL_GRABBER_URL, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });

    logStep("Waiting for URL input.");

    await page.waitForSelector("#inputURL", {
      timeout: timeoutMs
    });

    logStep("Filling YouTube URL.", {
      youtube_url: youtubeUrl.toString()
    });

    await page.locator("#inputURL").fill(youtubeUrl.toString());

    logStep("Clicking Get Thumbnail Images button.");

    await page.locator("#submitButton").click();

    logStep("Waiting for thumbnail listing.");

    await page.waitForFunction(
      () => {
        const listing = document.querySelector("#imgListing");
        const maxres = document.querySelector("#maxres");

        return listing && getComputedStyle(listing).display !== "none" && maxres?.getAttribute("src");
      },
      {
        timeout: timeoutMs,
        polling: 500
      }
    );

    await page.waitForTimeout(500);

    logStep("Extracting thumbnail data.");

    const thumbnails = await extractThumbnails(page);
    const videoId = thumbnails.find((item) => item.data_id)?.data_id ?? expectedVideoId;

    logStep("Extraction complete.", {
      video_id: videoId,
      thumbnail_count: thumbnails.length
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
      url: THUMBNAIL_GRABBER_URL,
      youtube_url: youtubeUrl.toString(),
      video_id: videoId,
      expected_video_id: expectedVideoId,
      thumbnails,
      best_thumbnail: thumbnails.find((item) => item.key === "hd") ?? thumbnails[0] ?? null
    };
  } catch (error) {
    logError("Thumbnail grabber bot failed.", {
      youtube_url: youtubeUrl.toString(),
      step,
      message: error.message
    });
    throw new Error(`YouTube Thumbnail Grabber crawler failed: ${error.message}`);
  } finally {
    logInfo("Closing Chrome.");
    await browser.close();
  }
}
