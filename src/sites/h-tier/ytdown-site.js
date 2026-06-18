import path from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

import { firefox } from "playwright-core";

const YTDOWN_URL = "https://app.ytdown.to/vi29/";
const DEFAULT_PROFILE_DIR = path.resolve(process.cwd(), ".browser-profiles/ytdown-camoufox");
const CAMOUFOX_EXECUTABLE_PATHS = [
  process.env.CAMOUFOX_EXECUTABLE_PATH,
  path.join(homedir(), "Library/Caches/camoufox/Camoufox.app/Contents/MacOS/camoufox"),
  "/Applications/Camoufox.app/Contents/MacOS/camoufox",
  "/Applications/Camoufox.app/Contents/MacOS/Camoufox"
].filter(Boolean);

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logInfo(message, details = null) {
  if (details) {
    console.info(`[ytdown] ${message}`, details);
    return;
  }

  console.info(`[ytdown] ${message}`);
}

function logWarn(message, details = null) {
  if (details) {
    console.warn(`[ytdown] ${message}`, details);
    return;
  }

  console.warn(`[ytdown] ${message}`);
}

function logError(message, details = null) {
  if (details) {
    console.error(`[ytdown] ${message}`, details);
    return;
  }

  console.error(`[ytdown] ${message}`);
}

function normalizeText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function createHttpError(statusCode, message, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function resolveCamoufoxExecutablePath(inputPath = null) {
  const candidates = [
    inputPath,
    ...CAMOUFOX_EXECUTABLE_PATHS
  ].filter(Boolean);

  const executablePath = candidates.find((candidate) => existsSync(candidate));

  if (executablePath) {
    return executablePath;
  }

  throw createHttpError(
    500,
    "Camoufox executable was not found. Set CAMOUFOX_EXECUTABLE_PATH or pass 'camoufox_executable_path'.",
    {
      checked_paths: candidates
    }
  );
}

function parseInput(input) {
  const rawUrl = input?.youtube_url ?? input?.video_url ?? input?.url;

  if (!rawUrl || typeof rawUrl !== "string") {
    throw createHttpError(400, "Field 'youtube_url' is required for app.ytdown.to crawler.");
  }

  let youtubeUrl;
  try {
    youtubeUrl = new URL(rawUrl);
  } catch {
    throw createHttpError(400, "Field 'youtube_url' must be a valid YouTube URL.");
  }

  if (!["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(youtubeUrl.hostname)) {
    throw createHttpError(400, "YTDown crawler only accepts YouTube URLs.");
  }

  return {
    youtubeUrl,
    timeoutMs: Number(input?.timeout_ms || 120000),
    manualVerifyTimeoutMs: Number(input?.manual_verify_timeout_ms || 180000),
    browserVisible: input?.browser_visible !== false && input?.headless !== true,
    slowMoMs: Number(input?.slow_mo_ms ?? 150),
    keepBrowserOpenMs: Number(input?.keep_browser_open_ms ?? 0),
    profileDir: input?.profile_dir || DEFAULT_PROFILE_DIR,
    camoufoxExecutablePath: resolveCamoufoxExecutablePath(input?.camoufox_executable_path || input?.executable_path)
  };
}

function isCloudflarePage(text = "", title = "") {
  const value = `${title} ${text}`;

  return /just a moment|performing security verification|cloudflare|cf-turnstile/i.test(value);
}

function isDownloadCandidateUrl(url = "") {
  if (!url || url.startsWith("blob:") || url === YTDOWN_URL) {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    const value = `${parsedUrl.hostname}${parsedUrl.pathname}${parsedUrl.search}`;

    if (/cloudflare|turnstile|captcha|challenge/i.test(value)) {
      return false;
    }

    return (
      /\.(mp4|webm|m4a|mp3)(?:$|\?)/i.test(url) ||
      /download|convert|video|audio|media|file|token|api/i.test(value)
    );
  } catch {
    return false;
  }
}

function pickHeaders(headers = {}) {
  const headerNames = [
    "accept",
    "accept-language",
    "content-type",
    "range",
    "referer",
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

async function isVisible(page, selector) {
  return page.$eval(
    selector,
    (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }
  ).catch(() => false);
}

async function waitForAppInput(page, manualVerifyTimeoutMs, profileDir) {
  const selectors = [
    "input[type='url']",
    "input[name='url']",
    "input[name='q']",
    "input[name='query']",
    "input[placeholder*='YouTube' i]",
    "input[placeholder*='Youtube' i]",
    "input[placeholder*='URL' i]",
    "input[type='text']",
    "textarea"
  ];
  const deadline = Date.now() + manualVerifyTimeoutMs;

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      if (await isVisible(page, selector)) {
        return selector;
      }
    }

    const state = await page.evaluate(() => ({
      title: document.title || "",
      text: document.body?.innerText || ""
    }));

    if (isCloudflarePage(state.text, state.title)) {
      logWarn("Cloudflare/security verification is still visible. Complete it in the opened Camoufox window.", {
        profile_dir: profileDir,
        remaining_ms: Math.max(0, deadline - Date.now())
      });
    } else {
      logWarn("Waiting for YTDown input to appear.", {
        title: state.title,
        text_sample: normalizeText(state.text).slice(0, 200),
        remaining_ms: Math.max(0, deadline - Date.now())
      });
    }

    await delay(3000);
  }

  throw createHttpError(
    409,
    "YTDown input was not found. If Cloudflare is visible, complete verification in the opened Camoufox window, then run the crawler again.",
    {
      profile_dir: profileDir
    }
  );
}

async function fillYoutubeInput(page, youtubeUrl) {
  const selectors = [
    "input[type='url']",
    "input[name='url']",
    "input[name='q']",
    "input[name='query']",
    "input[placeholder*='YouTube' i]",
    "input[placeholder*='Youtube' i]",
    "input[placeholder*='URL' i]",
    "input[type='text']",
    "textarea"
  ];

  for (const selector of selectors) {
    if (await isVisible(page, selector)) {
      await page.click(selector, {
        clickCount: 3
      });
      await page.keyboard.press("Backspace");
      await page.type(selector, youtubeUrl, {
        delay: 15
      });
      return selector;
    }
  }

  throw new Error("YouTube URL input was not found.");
}

async function clickSubmitButton(page) {
  const directSelectors = [
    "button[type='submit']",
    "input[type='submit']"
  ];

  for (const selector of directSelectors) {
    if (await isVisible(page, selector)) {
      await page.click(selector);
      return selector;
    }
  }

  const clickedText = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll("button, input[type='submit'], a, [role='button']"));
    const element = elements.find((item) => {
      const text = `${item.getAttribute("aria-label") || ""} ${item.textContent || ""} ${item.value || ""}`;
      const style = window.getComputedStyle(item);
      const rect = item.getBoundingClientRect();

      return (
        /(download|tải|tải xuống|convert|start|go)/i.test(text) &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    });

    if (!element) {
      return null;
    }

    element.click();
    return `${element.tagName.toLowerCase()}:${(element.textContent || element.value || "").replace(/\s+/g, " ").trim()}`;
  });

  if (clickedText) {
    return clickedText;
  }

  await page.keyboard.press("Enter");
  return "keyboard-enter";
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
        text: normalize(element.textContent || element.value || ""),
        href: element.href || element.getAttribute("href"),
        src: element.src || element.currentSrc || element.getAttribute("src"),
        download: element.getAttribute("download"),
        data: attrs
      };
    };

    const links = Array.from(document.querySelectorAll("a, button, [role='button'], video, source"))
      .map(readElement)
      .filter((item) => {
        const value = `${item.text || ""} ${item.href || ""} ${item.src || ""}`;

        return /(download|tải|mp4|webm|m4a|mp3|video|audio|media|api|token)/i.test(value);
      });

    return {
      title: document.title || null,
      page_text_sample: normalize(document.body?.innerText || "").slice(0, 1200),
      links
    };
  });
}

export default async function crawlYtdownSite(input) {
  const {
    youtubeUrl,
    timeoutMs,
    manualVerifyTimeoutMs,
    browserVisible,
    slowMoMs,
    keepBrowserOpenMs,
    profileDir,
    camoufoxExecutablePath
  } = parseInput(input);
  const downloadCandidates = new Map();
  let step = 0;
  const logStep = (message, details = null) => {
    step += 1;
    logInfo(`Step ${step}: ${message}`, details);
  };

  const rememberCandidate = (source, url, details = {}) => {
    if (!isDownloadCandidateUrl(url)) {
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

    logInfo("Captured possible download URL.", {
      source,
      url
    });
  };

  logInfo("Starting YTDown Camoufox bot with persistent profile.", {
    youtube_url: youtubeUrl.toString(),
    profile_dir: profileDir,
    executable_path: camoufoxExecutablePath,
    timeout_ms: timeoutMs,
    manual_verify_timeout_ms: manualVerifyTimeoutMs,
    browser_visible: browserVisible,
    slow_mo_ms: slowMoMs,
    keep_browser_open_ms: keepBrowserOpenMs
  });

  logStep("Launching Camoufox via Playwright.", {
    executable_path: camoufoxExecutablePath,
    profile_dir: profileDir,
    headless: !browserVisible
  });

  const context = await firefox.launchPersistentContext(profileDir, {
    executablePath: camoufoxExecutablePath,
    headless: !browserVisible,
    slowMo: browserVisible ? slowMoMs : 0,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:149.0) Gecko/20100101 Firefox/149.0",
    viewport: null,
    extraHTTPHeaders: {
      "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
    },
    args: [
      "--lang=vi-VN,vi,en-US,en"
    ]
  });

  try {
    logStep("Opening page.");

    const pages = context.pages();
    const page = pages[0] || (await context.newPage());

    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    page.on("console", (message) => {
      const text = normalizeText(message.text());

      if (text && message.type() === "error") {
        logWarn("Browser console error.", {
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

      if (isDownloadCandidateUrl(url)) {
        rememberCandidate("request", url, {
          method: request.method(),
          resource_type: request.resourceType(),
          request_headers: pickHeaders(request.headers())
        });
      }
    });

    page.on("response", (response) => {
      const url = response.url();

      if (isDownloadCandidateUrl(url)) {
        rememberCandidate("response", url, {
          status: response.status(),
          response_headers: pickHeaders(response.headers())
        });
      }
    });

    logStep("Navigating to YTDown.", {
      url: YTDOWN_URL
    });

    await page.goto(YTDOWN_URL, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });

    logStep("Waiting for app input or manual verification.");

    await waitForAppInput(page, manualVerifyTimeoutMs, profileDir);

    logStep("Filling YouTube URL.", {
      youtube_url: youtubeUrl.toString()
    });

    const inputSelector = await fillYoutubeInput(page, youtubeUrl.toString());

    const requestPromise = page
      .waitForRequest((request) => isDownloadCandidateUrl(request.url()), {
        timeout: timeoutMs
      })
      .catch(() => null);
    const responsePromise = page
      .waitForResponse((response) => isDownloadCandidateUrl(response.url()), {
        timeout: timeoutMs
      })
      .catch(() => null);
    const domPromise = page
      .waitForFunction(
        () => {
          const values = Array.from(document.querySelectorAll("a, video, source"))
            .flatMap((element) => [
              element.getAttribute("href"),
              element.href,
              element.getAttribute("src"),
              element.src,
              element.currentSrc
            ])
            .filter(Boolean);

          return values.some((value) => {
            try {
              const url = new URL(value);

              return /(download|convert|video|audio|media|file|token|api)/i.test(`${url.hostname}${url.pathname}${url.search}`);
            } catch {
              return false;
            }
          });
        },
        undefined,
        {
          timeout: timeoutMs,
          polling: 500
        }
      )
      .catch(() => null);

    logStep("Submitting form.", {
      input_selector: inputSelector
    });

    const submitSelector = await clickSubmitButton(page);

    logStep("Waiting for generated links.", {
      submit_selector: submitSelector
    });

    await Promise.race([requestPromise, responsePromise, domPromise]);
    await delay(3000);

    logStep("Extracting page result data.");

    const pageData = await extractPageData(page);

    pageData.links.forEach((item) => {
      if (item.href) {
        rememberCandidate("dom-link", item.href);
      }
      if (item.src) {
        rememberCandidate("dom-media", item.src);
      }
    });

    const downloads = Array.from(downloadCandidates.values()).map((item) => ({
      ...item,
      curl: createCurl(item.url, item.request_headers || {})
    }));
    const bestDownload = downloads.find((item) => /\.(mp4|webm|m4a|mp3)(?:$|\?)/i.test(item.url)) || downloads[0] || null;

    logStep("Extraction complete.", {
      download_count: downloads.length,
      best_download_url: bestDownload?.url || null
    });

    if (keepBrowserOpenMs > 0) {
      logStep("Keeping browser open for inspection.", {
        keep_browser_open_ms: keepBrowserOpenMs
      });
      await delay(keepBrowserOpenMs);
    }

    return {
      url: YTDOWN_URL,
      youtube_url: youtubeUrl.toString(),
      engine: "camoufox-playwright",
      executable_path: camoufoxExecutablePath,
      profile_dir: profileDir,
      downloads,
      best_download: bestDownload,
      page: pageData
    };
  } catch (error) {
    logError("YTDown Camoufox bot failed.", {
      youtube_url: youtubeUrl.toString(),
      step,
      profile_dir: profileDir,
      message: error.message
    });

    if (error.statusCode) {
      throw error;
    }

    throw new Error(`YTDown crawler failed: ${error.message}`);
  } finally {
    logInfo("Closing Camoufox.");
    await context.close();
  }
}
