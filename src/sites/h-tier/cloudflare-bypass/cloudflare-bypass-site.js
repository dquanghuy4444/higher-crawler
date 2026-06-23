import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PYTHON_SCRIPT = path.join(__dirname, "cloudflare_bypass.py");
const PROJECT_PYTHON = path.join(__dirname, "../../../../.venv/bin/python");
const DEFAULT_TEST_KEY = "cloudflare-captcha";
const DEFAULT_BYPASS_METHODS = ["scrapling", "botasaurus", "seleniumbase-cdp"];

export const DETECTION_TESTS = [
  { key: "fingerprint", category: "everything", url: "https://demo.fingerprint.com/playground", description: "Fingerprint.com bot detection playground" },
  { key: "creepjs", category: "everything", url: "https://abrahamjuliot.github.io/creepjs/", description: "Advanced browser fingerprint report" },
  { key: "pixelscan", category: "everything", url: "https://pixelscan.net/", description: "Simple fingerprint checker" },
  { key: "fvision", category: "everything", url: "https://fv.pro/check-privacy/general", description: "F.vision privacy/fingerprint check" },
  { key: "coveryourtracks", category: "everything", url: "https://coveryourtracks.eff.org/", description: "EFF fingerprinting protection test" },
  { key: "amiunique", category: "everything", url: "https://amiunique.org/fingerprint", description: "AmIUnique browser fingerprint" },
  { key: "sannysoft", category: "everything", url: "https://bot.sannysoft.com/", description: "Sannysoft webdriver/fingerprint test" },
  { key: "browserleaks", category: "everything", url: "https://browserleaks.com/", description: "BrowserLeaks index of fingerprint tests" },
  { key: "audio-fingerprint", category: "everything", url: "https://audiofingerprint.openwpm.com/", description: "Audio fingerprint test" },
  { key: "webbrowsertools", category: "everything", url: "https://webbrowsertools.com/", description: "Web browser privacy tools" },
  { key: "eugenebos-reviewer", category: "everything", url: "https://reviewer.eugenebos.com/test", description: "Plain-code reviewer fingerprint test" },
  { key: "browserscan", category: "everything", url: "https://www.browserscan.net/en", description: "BrowserScan fingerprint test" },

  { key: "rebrowser-bot-detector", category: "automation", url: "https://bot-detector.rebrowser.net/", description: "Automation task detector" },
  { key: "brotector", category: "automation", url: "https://kaliiiiiiiiii.github.io/brotector/", description: "Advanced automation detector" },
  { key: "behavioral-bot", category: "automation", url: "https://bot.incolumitas.com/", description: "Behavioral bot classification" },
  { key: "pixelscan-bot", category: "automation", url: "https://pixelscan.net/bot-check", description: "Pixelscan bot detector" },

  { key: "canvas-tampering", category: "canvas", url: "https://kkapsner.github.io/CanvasBlocker/test/detectionTest.html", description: "Canvas tampering detection" },

  { key: "recaptcha-score", category: "captcha", url: "https://antcpt.com/score_detector/", description: "reCAPTCHA score detector" },
  { key: "cloudflare-captcha", category: "captcha", url: "https://nowsecure.nl/", description: "Cloudflare challenge/captcha check" },
  { key: "nowsecure", category: "captcha", url: "https://nowsecure.nl/", description: "Alias for Cloudflare challenge/captcha check" },

  { key: "proxydetect", category: "connection", url: "https://proxydetect.live/", description: "Proxy/VPN detection" },
  { key: "iproyal-webrtc", category: "connection", url: "https://iproyal.com/webrtc-leak-test/", description: "WebRTC leak test" },
  { key: "browserleaks-webrtc", category: "connection", url: "https://browserleaks.com/webrtc", description: "BrowserLeaks WebRTC leak test" },
  { key: "ipqualityscore", category: "connection", url: "https://www.ipqualityscore.com/", description: "IP reputation check" },
  { key: "fingerbank", category: "connection", url: "https://fingerbank.org/", description: "TCP/device fingerprint service" },
  { key: "tls-peet", category: "connection", url: "https://tls.peet.ws/api/all", description: "TLS/JA3 HTTP diagnostic" },
  { key: "dnsleaktest", category: "connection", url: "https://dnsleaktest.com/results.html", description: "DNS leak test" },
  { key: "browserleaks-dns", category: "connection", url: "https://browserleaks.com/dns", description: "BrowserLeaks DNS leak test" }
];

function createHttpError(statusCode, message, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function pickPythonBin(input) {
  if (process.env.PYTHON_BIN) {
    return process.env.PYTHON_BIN;
  }

  if (existsSync(PROJECT_PYTHON)) {
    return PROJECT_PYTHON;
  }

  return "python3";
}

function publicTest(test) {
  return {
    key: test.key,
    category: test.category,
    url: test.url,
    description: test.description
  };
}

export function getDetectionTests() {
  return DETECTION_TESTS.map(publicTest);
}

function uniqueTests(tests) {
  const seen = new Set();
  return tests.filter((test) => {
    if (seen.has(test.key)) {
      return false;
    }
    seen.add(test.key);
    return true;
  });
}

function resolveDetectionTests(input) {
  if (input.url) {
    return [{
      key: input.test_key || "custom",
      category: "custom",
      url: input.url,
      description: "Custom URL"
    }];
  }

  const requested = input.tests ?? input.test_keys ?? input.test_key ?? input.test ?? "cloudflare-captcha";
  const values = Array.isArray(requested) ? requested : [requested];
  const selected = [];

  for (const value of values) {
    const key = String(value).trim().toLowerCase();
    if (!key) {
      continue;
    }

    if (key === "all") {
      selected.push(...DETECTION_TESTS);
      continue;
    }

    const byCategory = DETECTION_TESTS.filter((test) => test.category === key);
    if (byCategory.length > 0) {
      selected.push(...byCategory);
      continue;
    }

    const byKey = DETECTION_TESTS.find((test) => test.key === key);
    if (!byKey) {
      throw createHttpError(400, `Unknown detection test '${value}'.`, {
        available_tests: getDetectionTests()
      });
    }
    selected.push(byKey);
  }

  return uniqueTests(selected);
}

function resolveBypassMethods(input) {
  const requested = input.bypass_methods ?? input.methods ?? input.bypass_method ?? input.method ?? input.engine;
  const values = requested ? (Array.isArray(requested) ? requested : [requested]) : DEFAULT_BYPASS_METHODS;
  const seen = new Set();
  const methods = [];

  for (const value of values) {
    const method = String(value).trim().toLowerCase();
    if (!method || seen.has(method)) {
      continue;
    }
    if (!DEFAULT_BYPASS_METHODS.includes(method)) {
      throw createHttpError(400, `Unknown bypass method '${value}'.`, {
        available_methods: DEFAULT_BYPASS_METHODS
      });
    }
    seen.add(method);
    methods.push(method);
  }

  return methods.length > 0 ? methods : DEFAULT_BYPASS_METHODS;
}

function parsePythonJsonOutput(stdout) {
  const trimmed = stdout.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonLine = trimmed
      .split("\n")
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.startsWith("{") && line.endsWith("}"));

    if (!jsonLine) {
      throw new Error("No JSON object found in Python stdout.");
    }

    return JSON.parse(jsonLine);
  }
}

function summarizeBypassResult(method, test, result) {
  const cloudflareDetected = Boolean(result.cloudflare_detected);
  const cfClearancePresent = result.cf_clearance_present === null ? null : Boolean(result.cf_clearance_present);
  const detectorStatus = result.detection_analysis?.status || (cloudflareDetected ? "challenge_detected" : "loaded");

  return {
    method,
    ok: true,
    status: detectorStatus,
    loaded: !cloudflareDetected,
    passed_cloudflare: !cloudflareDetected,
    cloudflare_detected: cloudflareDetected,
    cf_clearance_present: cfClearancePresent,
    detector_loaded: result.detection_analysis?.detector_loaded ?? null,
    bot_detected: result.detection_analysis?.bot_detected ?? null,
    final_url: result.url,
    title: result.title,
    html_length: result.html_length,
    engine: result.engine,
    detection_test: publicTest(test),
    detection_analysis: result.detection_analysis || null,
    result
  };
}

function summarizeBypassError(method, test, error) {
  return {
    method,
    ok: false,
    status: "failed",
    passed_cloudflare: false,
    cloudflare_detected: null,
    cf_clearance_present: null,
    detection_test: publicTest(test),
    error: error.message,
    details: error.details || null
  };
}

function runPythonCrawler(input) {
  return new Promise((resolve, reject) => {
    const pythonBin = pickPythonBin(input);
    const child = spawn(pythonBin, [PYTHON_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;

      for (const line of text.split("\n").filter(Boolean)) {
        try {
          const log = JSON.parse(line);
          const level = log.level || "info";
          const msg = `[cloudflare-bypass-py] ${log.message}`;

          if (level === "error") {
            console.error(msg, log.details || "");
          } else if (level === "warn") {
            console.warn(msg, log.details || "");
          } else {
            console.info(msg, log.details || "");
          }
        } catch {
          console.info(`[cloudflare-bypass-py] ${line}`);
        }
      }
    });

    child.on("error", (error) => {
      reject(createHttpError(500, `Failed to spawn Python process: ${error.message}`, {
        python_bin: pythonBin,
        script: PYTHON_SCRIPT
      }));
    });

    child.on("close", (code) => {
      if (!stdout.trim()) {
        reject(createHttpError(500, "Python crawler returned no output.", {
          exit_code: code,
          stderr: stderr.slice(-2000)
        }));
        return;
      }

      try {
        const result = parsePythonJsonOutput(stdout);

        if (result.ok === false) {
          reject(createHttpError(
            result.status_code || 500,
            result.error || "Cloudflare bypass crawler failed.",
            result.details || null
          ));
          return;
        }

        resolve(result);
      } catch (parseError) {
        reject(createHttpError(500, `Failed to parse Python output: ${parseError.message}`, {
          exit_code: code,
          stdout: stdout.slice(-2000),
          stderr: stderr.slice(-2000)
        }));
      }
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

export default async function crawlCloudflareBypassSite(input) {
  input = input || {};
  const tests = resolveDetectionTests(input);
  const methods = resolveBypassMethods(input);
  const baseInput = { ...input };
  delete baseInput.site;
  delete baseInput.url;
  delete baseInput.method;
  delete baseInput.methods;
  delete baseInput.engine;
  delete baseInput.bypass_method;
  delete baseInput.bypass_methods;

  if (!("timeout_ms" in baseInput)) {
    baseInput.timeout_ms = 45000;
  }
  if (!("headless" in baseInput) && !("browser_visible" in baseInput)) {
    baseInput.headless = true;
  }

  const runs = [];
  for (const method of methods) {
    for (const test of tests) {
      runs.push({ method, test });
    }
  }

  if (runs.length === 1) {
    const { method, test } = runs[0];
    try {
      const result = await runPythonCrawler({
        ...baseInput,
        bypass_method: method,
        url: test.url
      });

      return summarizeBypassResult(method, test, result);
    } catch (error) {
      return {
        ok: true,
        bypass_method: method,
        count: 1,
        results: [summarizeBypassError(method, test, error)]
      };
    }
  }

  const results = [];
  for (const { method, test } of runs) {
    try {
      const result = await runPythonCrawler({
        ...baseInput,
        bypass_method: method,
        url: test.url
      });
      results.push(summarizeBypassResult(method, test, result));
    } catch (error) {
      results.push(summarizeBypassError(method, test, error));
    }
  }

  return {
    ok: true,
    default_test: DEFAULT_TEST_KEY,
    methods,
    tests: tests.map(publicTest),
    count: results.length,
    summary: {
      clean: results.filter((item) => item.status === "clean").length,
      bot_detected: results.filter((item) => item.status === "bot_detected").length,
      detector_loaded: results.filter((item) => item.status === "detector_loaded").length,
      loaded: results.filter((item) => item.status === "loaded").length,
      unknown: results.filter((item) => item.status === "unknown").length,
      challenge_detected: results.filter((item) => item.status === "challenge_detected").length,
      failed: results.filter((item) => item.status === "failed").length
    },
    results
  };
}

export async function crawlCloudflareBypassTests(input) {
  input = input || {};
  const tests = resolveDetectionTests(input);
  const baseInput = { ...input };
  delete baseInput.site;
  delete baseInput.url;

  if (tests.length === 1) {
    const test = tests[0];
    const result = await runPythonCrawler({
      ...baseInput,
      url: test.url
    });

    return {
      ...result,
      detection_test: publicTest(test)
    };
  }

  const results = [];
  for (const test of tests) {
    try {
      const result = await runPythonCrawler({
        ...baseInput,
        url: test.url
      });
      results.push({
        ok: true,
        detection_test: publicTest(test),
        result
      });
    } catch (error) {
      results.push({
        ok: false,
        detection_test: publicTest(test),
        error: error.message,
        details: error.details || null
      });
    }
  }

  return {
    ok: true,
    bypass_method: input.bypass_method || input.method || input.engine || "scrapling",
    count: results.length,
    results
  };
}
