"""
Generic Cloudflare bypass probe for authorized crawler debugging.

Protocol: reads JSON input from stdin, writes JSON output to stdout.
All logs go to stderr to keep stdout clean for the JS caller.

Input:
{
  "url": "https://example.com",
  "bypass_method": "scrapling" | "botasaurus" | "seleniumbase-cdp",
  "timeout_ms": 120000,
  "headless": true,
  "keep_browser_open_ms": 0
}
"""

import asyncio
import contextlib
import html
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_PROFILE_ROOT = Path.cwd() / ".browser-profiles" / "cloudflare-bypass"
PROJECT_CACHE_DIR = Path.cwd() / ".cache"
SUPPORTED_METHODS = {"scrapling", "botasaurus", "seleniumbase-cdp"}

PROJECT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("XDG_CACHE_HOME", str(PROJECT_CACHE_DIR))
os.environ.setdefault("TLDEXTRACT_CACHE", str(PROJECT_CACHE_DIR / "tldextract"))


def log_info(message, details=None):
    entry = {"level": "info", "source": "cloudflare-bypass", "message": message}
    if details:
        entry["details"] = details
    print(json.dumps(entry), file=sys.stderr)


def log_warn(message, details=None):
    entry = {"level": "warn", "source": "cloudflare-bypass", "message": message}
    if details:
        entry["details"] = details
    print(json.dumps(entry), file=sys.stderr)


def parse_input(data):
    raw_url = data.get("url")
    if not raw_url or not isinstance(raw_url, str):
        raise ValueError("Field 'url' is required for cloudflare-bypass crawler.")

    parsed = urlparse(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Field 'url' must be an absolute http(s) URL.")

    method = (data.get("bypass_method") or data.get("method") or data.get("engine") or "scrapling").strip().lower()
    if method not in SUPPORTED_METHODS:
        raise ValueError(f"Unsupported bypass_method '{method}'. Supported: {', '.join(sorted(SUPPORTED_METHODS))}.")

    return {
        "url": raw_url,
        "bypass_method": method,
        "timeout_ms": int(data.get("timeout_ms") or 120000),
        "browser_visible": data.get("browser_visible", True) and not data.get("headless", False),
        "keep_browser_open_ms": int(data.get("keep_browser_open_ms", 0)),
        "profile_dir": data.get("profile_dir") or str(DEFAULT_PROFILE_ROOT / method),
        "proxy": data.get("proxy"),
        "http_proxy": data.get("http_proxy"),
        "wait_selector": data.get("wait_selector"),
    }


def is_cloudflare_text(text="", title=""):
    value = f"{title} {text}"
    return bool(re.search(
        r"just a moment|checking your browser|verify you are human|cf-turnstile|cloudflare|challenge",
        value,
        re.IGNORECASE,
    ))


def normalize_text(value=""):
    return re.sub(r"\s+", " ", value or "").strip()


def html_to_text(value=""):
    without_scripts = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", value or "", flags=re.IGNORECASE | re.DOTALL)
    without_tags = re.sub(r"<[^>]+>", " ", without_scripts)
    return normalize_text(html.unescape(without_tags))


def extract_fingerprint_html_property(raw="", property_name=""):
    pattern = (
        r'data-test-property-name=["\']'
        + re.escape(property_name)
        + r'["\'][\s\S]{0,900}?<div[^>]*>\s*([^<]+?)\s*</div>'
    )
    match = re.search(pattern, raw or "", re.IGNORECASE)
    if not match:
        return None
    return normalize_text(html.unescape(match.group(1)))


def parse_fingerprint_playground(text="", title=""):
    raw = text or ""
    normalized = html_to_text(raw) if "<" in raw and ">" in raw else normalize_text(raw)
    lower = normalized.lower()
    fields = {}

    html_properties = {
        "browser": "browser_details",
        "operating_system": "browser_details",
        "ip_address": "ip_address",
        "confidence_score": "confidence",
        "incognito": "incognito",
        "bot": "bot",
        "vpn": "vpn",
        "tampering": "tampering",
        "developer_tools": "developer_tools",
        "virtual_machine": "virtual_machine",
        "privacy_settings": "privacy_settings",
        "ip_blocklist": "ip_blocklist",
        "high_activity_device": "high_activity_device",
        "velocity": "velocity",
        "suspect_score": "suspect_score",
    }
    for key, property_name in html_properties.items():
        value = extract_fingerprint_html_property(raw, property_name)
        if value and key not in fields:
            fields[key] = value

    patterns = {
        "visitor_id": r"Your Visitor ID is\s+([A-Za-z0-9_-]+)",
        "browser": r"Your Visitor ID is\s+[A-Za-z0-9_-]+\s+Browser\s+(.+?)\s+Operating System",
        "operating_system": r"Your Visitor ID is\s+[A-Za-z0-9_-]+\s+Browser\s+.+?\s+Operating System\s+(.+?)\s+IP Address",
        "ip_address": r"Your Visitor ID is\s+[A-Za-z0-9_-]+\s+Browser\s+.+?\s+Operating System\s+.+?\s+IP Address\s+(.+?)\s+Last Seen",
        "confidence_score": r"Confidence Score\s+([0-9.]+)",
        "incognito": r"Incognito Mode\s+(.+?)\s+Bot",
        "bot": r"Bot\s+(.+?)\s+VPN",
        "vpn": r"VPN\s+(.+?)\s+Browser Tampering",
        "tampering": r"Browser Tampering\s+(.+?)\s+Developer Tools",
        "developer_tools": r"Developer Tools\s+(.+?)\s+Virtual Machine",
        "virtual_machine": r"Virtual Machine\s+(.+?)\s+Privacy Settings",
        "privacy_settings": r"Privacy Settings\s+(.+?)\s+IP Blocklist",
        "ip_blocklist": r"IP Blocklist\s+(.+?)\s+High-Activity Device",
        "high_activity_device": r"High-Activity Device\s+(.+?)\s+Velocity Signals",
        "suspect_score": r"Suspect Score\s+([0-9.]+)",
    }

    for key, pattern in patterns.items():
        match = re.search(pattern, normalized, re.IGNORECASE)
        if match:
            fields[key] = normalize_text(match.group(1))

    good_signals = [
        "incognito",
        "bot",
        "vpn",
        "tampering",
        "developer_tools",
        "virtual_machine",
        "privacy_settings",
        "ip_blocklist",
        "high_activity_device",
    ]
    detected_signals = {
        key: value
        for key, value in fields.items()
        if key in good_signals and value and value.lower() != "not detected"
    }

    suspect_score = None
    if fields.get("suspect_score"):
        try:
            suspect_score = float(fields["suspect_score"])
        except Exception:
            pass

    confidence_score = None
    if fields.get("confidence_score"):
        try:
            confidence_score = float(fields["confidence_score"])
        except Exception:
            pass

    detector_loaded = (
        "your visitor id is" in lower
        or "smart signals" in lower
        or "confidence score" in lower
    )
    bot_detected = bool(detected_signals) or (suspect_score is not None and suspect_score > 0)

    if detector_loaded and not bot_detected:
        status = "clean"
    elif detector_loaded and bot_detected:
        status = "bot_detected"
    else:
        status = "unknown"

    return {
        "site": "fingerprint",
        "detector_loaded": detector_loaded,
        "status": status,
        "bot_detected": bot_detected,
        "signals": fields,
        "detected_signals": detected_signals,
        "confidence_score": confidence_score,
        "suspect_score": suspect_score,
        "expected_markers": [
            "Your Visitor ID is",
            "Confidence Score",
            "Bot Not detected",
            "VPN Not detected",
            "Browser Tampering Not detected",
            "Suspect Score 0",
        ],
    }


def analyze_detection_site(url="", title="", text="", cloudflare_detected=False):
    normalized = normalize_text(text)
    lower = normalized.lower()
    host = ""
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        pass

    if cloudflare_detected:
        return {
            "status": "challenge_detected",
            "detector_loaded": False,
            "bot_detected": None,
            "reason": "Cloudflare/challenge text is still visible.",
        }

    if "demo.fingerprint.com" in host:
        return parse_fingerprint_playground(normalized, title)

    marker_sets = [
        ("creepjs", ["creepjs", "fingerprint", "trust score"]),
        ("pixelscan", ["pixelscan", "bot", "fingerprint"]),
        ("sannysoft", ["webdriver", "selenium", "chrome", "permissions"]),
        ("browserleaks", ["browserleaks", "fingerprint"]),
        ("browserscan", ["browserscan", "fingerprint"]),
        ("bot-detector", ["bot detector", "rebrowser"]),
        ("brotector", ["brotector"]),
        ("incolumitas", ["behavioral bot", "bot detection", "incolumitas"]),
        ("nowsecure", ["cloudflare", "nowsecure"]),
    ]

    matched = [
        name for name, markers in marker_sets
        if any(marker in lower for marker in markers)
    ]
    detector_loaded = bool(matched) or len(normalized) > 300
    bot_words = [
        "bot detected",
        "automation detected",
        "webdriver detected",
        "headless detected",
        "selenium detected",
        "failed",
    ]
    clean_words = [
        "not detected",
        "passed",
        "pass",
        "normal",
    ]

    if any(word in lower for word in bot_words):
        status = "bot_detected"
        bot_detected = True
    elif any(word in lower for word in clean_words):
        status = "clean"
        bot_detected = False
    elif detector_loaded:
        status = "detector_loaded"
        bot_detected = None
    else:
        status = "unknown"
        bot_detected = None

    return {
        "site": matched[0] if matched else host,
        "status": status,
        "detector_loaded": detector_loaded,
        "bot_detected": bot_detected,
        "matched_markers": matched,
        "reason": "Generic text heuristic; add a site-specific parser for precise status.",
    }


def summarize_cookies(cookies):
    result = []
    for cookie in cookies or []:
        name = cookie.get("name")
        if not name:
            continue
        result.append({
            "name": name,
            "domain": cookie.get("domain"),
            "path": cookie.get("path"),
            "expires": cookie.get("expires"),
            "httpOnly": cookie.get("httpOnly"),
            "secure": cookie.get("secure"),
            "sameSite": cookie.get("sameSite"),
            "value_present": bool(cookie.get("value")),
        })
    return result


async def page_snapshot(page, method, start_url, timeout_ms):
    title = ""
    text = ""
    html_length = None
    try:
        title = await page.title()
    except Exception:
        pass
    try:
        text = await page.evaluate("() => document.body?.innerText || ''")
    except Exception:
        pass
    try:
        html_length = await page.evaluate("() => document.documentElement?.outerHTML?.length || 0")
    except Exception:
        pass

    cookies = []
    try:
        cookies = await page.context.cookies()
    except Exception:
        pass

    cf_clearance = next((cookie for cookie in cookies if cookie.get("name") == "cf_clearance"), None)

    cloudflare_detected = is_cloudflare_text(text, title)
    analysis = analyze_detection_site(
        url=getattr(page, "url", start_url),
        title=title,
        text=text,
        cloudflare_detected=cloudflare_detected,
    )

    return {
        "ok": True,
        "engine": method,
        "url": getattr(page, "url", start_url),
        "input_url": start_url,
        "title": title or None,
        "cloudflare_detected": cloudflare_detected,
        "cf_clearance_present": bool(cf_clearance),
        "detection_analysis": analysis,
        "cookies": summarize_cookies(cookies),
        "page_text_sample": re.sub(r"\s+", " ", text).strip()[:3000] if text else None,
        "html_length": html_length,
        "timeout_ms": timeout_ms,
    }


def response_snapshot(response, method, start_url, timeout_ms):
    text = ""
    title = ""
    url = start_url

    for attr in ("body", "html_content", "text", "content"):
        value = getattr(response, attr, None)
        if callable(value):
            try:
                value = value()
            except Exception:
                value = None
        if isinstance(value, bytes):
            try:
                value = value.decode("utf-8", errors="replace")
            except Exception:
                value = None
        if isinstance(value, str) and value:
            text = value
            break

    if not text:
        try:
            text = str(response)
        except Exception:
            text = ""

    title_match = re.search(r"<title[^>]*>(.*?)</title>", text, re.IGNORECASE | re.DOTALL)
    if title_match:
        title = normalize_text(html.unescape(title_match.group(1)))

    for attr in ("url", "final_url"):
        value = getattr(response, attr, None)
        if value:
            url = str(value)
            break

    cookies = getattr(response, "cookies", None)
    cloudflare_detected = is_cloudflare_text(html_to_text(text), title)
    analysis = analyze_detection_site(
        url=url,
        title=title,
        text=text,
        cloudflare_detected=cloudflare_detected,
    )
    cookie_items = []
    try:
        if hasattr(cookies, "jar"):
            cookie_items = [
                {
                    "name": cookie.name,
                    "domain": cookie.domain,
                    "path": cookie.path,
                    "expires": cookie.expires,
                    "httpOnly": None,
                    "secure": cookie.secure,
                    "sameSite": None,
                    "value_present": bool(cookie.value),
                }
                for cookie in cookies.jar
            ]
        elif isinstance(cookies, dict):
            cookie_items = [
                {
                    "name": name,
                    "domain": None,
                    "path": None,
                    "expires": None,
                    "httpOnly": None,
                    "secure": None,
                    "sameSite": None,
                    "value_present": bool(value),
                }
                for name, value in cookies.items()
            ]
    except Exception:
        cookie_items = []

    cf_clearance = next((cookie for cookie in cookie_items if cookie.get("name") == "cf_clearance"), None)
    page_text = html_to_text(text)

    return {
        "ok": True,
        "engine": method,
        "url": url,
        "input_url": start_url,
        "title": title or None,
        "cloudflare_detected": cloudflare_detected,
        "cf_clearance_present": bool(cf_clearance),
        "detection_analysis": analysis,
        "cookies": cookie_items,
        "page_text_sample": page_text[:3000] if page_text else None,
        "html_length": len(text),
        "timeout_ms": timeout_ms,
    }


async def crawl_with_scrapling(params):
    try:
        from scrapling.fetchers import StealthyFetcher
    except ModuleNotFoundError as e:
        raise RuntimeError(
            "Scrapling is not installed in this Python environment. Install it with: python -m pip install scrapling"
        ) from e

    action_result = {}

    async def on_page_action(page):
        await wait_after_navigation(page, params)
        action_result["snapshot"] = await page_snapshot(page, "scrapling", params["url"], params["timeout_ms"])
        return page

    log_info("Launching Scrapling StealthyFetcher.", {"headless": not params["browser_visible"]})
    response = await StealthyFetcher.async_fetch(
        params["url"],
        headless=not params["browser_visible"],
        disable_resources=False,
        block_webrtc=False,
        allow_webgl=True,
        humanize=True,
        network_idle=True,
        wait=params["keep_browser_open_ms"] or 5000,
        timeout=params["timeout_ms"],
        page_action=on_page_action,
        wait_selector=params.get("wait_selector"),
        proxy=params.get("proxy"),
    )

    return action_result.get("snapshot") or response_snapshot(response, "scrapling", params["url"], params["timeout_ms"])


async def wait_after_navigation(page, params):
    wait_selector = params.get("wait_selector")
    if wait_selector:
        try:
            await page.wait_for_selector(wait_selector, timeout=params["timeout_ms"], state="visible")
        except TypeError:
            await page.wait_for_selector(wait_selector, timeout=params["timeout_ms"])
        except Exception as e:
            log_warn("wait_selector was not found before timeout.", {"wait_selector": wait_selector, "error": str(e)})

    await asyncio.sleep(5)

    keep_ms = params["keep_browser_open_ms"]
    if keep_ms > 0:
        log_info("Keeping browser open for inspection.", {"keep_browser_open_ms": keep_ms})
        await asyncio.sleep(keep_ms / 1000)


def run_botasaurus_sync(params):
    try:
        from botasaurus.browser import Driver, browser
    except ModuleNotFoundError as e:
        raise RuntimeError(
            "Botasaurus is not installed in this Python environment. Install it with: python -m pip install botasaurus"
        ) from e

    @browser(output=None, raise_exception=True, close_on_crash=True)
    def botasaurus_task(driver: Driver, data):
        url = data["url"]
        timeout_ms = data["timeout_ms"]

        log_info("Navigating with Botasaurus.", {"url": url})
        try:
            driver.google_get(url, bypass_cloudflare=True)
        except TypeError:
            driver.google_get(url)
        except Exception as e:
            log_warn("google_get failed, falling back to direct get.", {"error": str(e)})
            driver.get(url)

        wait_selector = data.get("wait_selector")
        if wait_selector:
            selector_json = json.dumps(wait_selector)
            deadline = time.time() + timeout_ms / 1000
            while time.time() < deadline:
                visible = driver.run_js(f"""
                    const el = document.querySelector({selector_json});
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return style.display !== 'none'
                        && style.visibility !== 'hidden'
                        && rect.width > 0
                        && rect.height > 0;
                """)
                if visible:
                    break
                time.sleep(0.5)

        time.sleep(5)

        if data["keep_browser_open_ms"] > 0:
            time.sleep(data["keep_browser_open_ms"] / 1000)

        state = driver.run_js("""
            return {
                url: window.location.href,
                title: document.title || null,
                text: document.body?.innerText || '',
                html_length: document.documentElement?.outerHTML?.length || 0
            };
        """)

        cloudflare_detected = is_cloudflare_text(state.get("text", ""), state.get("title", ""))
        analysis = analyze_detection_site(
            url=state.get("url") or url,
            title=state.get("title"),
            text=state.get("text", ""),
            cloudflare_detected=cloudflare_detected,
        )

        return {
            "ok": True,
            "engine": "botasaurus",
            "url": state.get("url") or url,
            "input_url": url,
            "title": state.get("title"),
            "cloudflare_detected": cloudflare_detected,
            "cf_clearance_present": None,
            "detection_analysis": analysis,
            "cookies": None,
            "page_text_sample": re.sub(r"\s+", " ", state.get("text", "")).strip()[:3000],
            "html_length": state.get("html_length"),
            "timeout_ms": timeout_ms,
        }

    Path(params["profile_dir"]).mkdir(parents=True, exist_ok=True)
    with contextlib.redirect_stdout(sys.stderr):
        return botasaurus_task(
            params,
            headless=not params["browser_visible"],
            profile=params["profile_dir"],
        )


def run_seleniumbase_cdp_sync(params):
    try:
        from playwright.sync_api import sync_playwright
        from seleniumbase import SB
    except ModuleNotFoundError as e:
        raise RuntimeError(
            "SeleniumBase CDP mode dependencies are not installed. Install them with: python -m pip install seleniumbase playwright"
        ) from e

    sb_kwargs = {
        "uc": True,
        "locale": params.get("locale") or "en",
        "headless": not params["browser_visible"],
    }
    if params.get("proxy"):
        sb_kwargs["proxy"] = params["proxy"]

    log_info("Launching SeleniumBase CDP Mode.", {
        "headless": not params["browser_visible"],
        "locale": sb_kwargs["locale"],
        "proxy": bool(params.get("proxy")),
    })

    with contextlib.redirect_stdout(sys.stderr):
        with SB(**sb_kwargs) as sb:
            sb.activate_cdp_mode()
            endpoint_url = sb.get_endpoint_url()

            with sync_playwright() as playwright:
                browser = playwright.chromium.connect_over_cdp(endpoint_url)
                context = browser.contexts[0] if browser.contexts else browser.new_context()
                page = context.pages[0] if context.pages else context.new_page()

                page.goto(params["url"], wait_until="domcontentloaded", timeout=params["timeout_ms"])

                wait_selector = params.get("wait_selector")
                if wait_selector:
                    try:
                        page.wait_for_selector(wait_selector, timeout=params["timeout_ms"], state="visible")
                    except Exception as e:
                        log_warn("wait_selector was not found before timeout.", {
                            "wait_selector": wait_selector,
                            "error": str(e),
                        })

                page.wait_for_timeout(5000)

                keep_ms = params["keep_browser_open_ms"]
                if keep_ms > 0:
                    log_info("Keeping SeleniumBase CDP browser open for inspection.", {
                        "keep_browser_open_ms": keep_ms,
                    })
                    page.wait_for_timeout(keep_ms)

                title = ""
                text = ""
                html_length = None
                cookies = []

                try:
                    title = page.title()
                except Exception:
                    pass
                try:
                    text = page.evaluate("() => document.body?.innerText || ''")
                except Exception:
                    pass
                try:
                    html_length = page.evaluate("() => document.documentElement?.outerHTML?.length || 0")
                except Exception:
                    pass
                try:
                    cookies = context.cookies()
                except Exception:
                    cookies = []

                final_url = page.url or params["url"]
                cloudflare_detected = is_cloudflare_text(text, title)
                analysis = analyze_detection_site(
                    url=final_url,
                    title=title,
                    text=text,
                    cloudflare_detected=cloudflare_detected,
                )
                cf_clearance = next((cookie for cookie in cookies if cookie.get("name") == "cf_clearance"), None)

                browser.close()

                return {
                    "ok": True,
                    "engine": "seleniumbase-cdp",
                    "url": final_url,
                    "input_url": params["url"],
                    "title": title or None,
                    "cloudflare_detected": cloudflare_detected,
                    "cf_clearance_present": bool(cf_clearance),
                    "detection_analysis": analysis,
                    "cookies": summarize_cookies(cookies),
                    "page_text_sample": re.sub(r"\s+", " ", text).strip()[:3000] if text else None,
                    "html_length": html_length,
                    "timeout_ms": params["timeout_ms"],
                }


async def crawl_async(input_data):
    params = parse_input(input_data)
    Path(params["profile_dir"]).mkdir(parents=True, exist_ok=True)

    log_info("Starting Cloudflare bypass probe.", {
        "url": params["url"],
        "bypass_method": params["bypass_method"],
        "profile_dir": params["profile_dir"],
        "timeout_ms": params["timeout_ms"],
        "browser_visible": params["browser_visible"],
    })

    if params["bypass_method"] == "scrapling":
        return await crawl_with_scrapling(params)
    if params["bypass_method"] == "botasaurus":
        return run_botasaurus_sync(params)
    if params["bypass_method"] == "seleniumbase-cdp":
        return await asyncio.to_thread(run_seleniumbase_cdp_sync, params)

    raise ValueError(f"Unsupported bypass_method '{params['bypass_method']}'.")


def main():
    try:
        raw_input = sys.stdin.read()
        input_data = json.loads(raw_input)
    except json.JSONDecodeError as e:
        result = {"ok": False, "error": f"Invalid JSON input: {e}"}
        print(json.dumps(result))
        sys.exit(1)

    try:
        result = asyncio.run(crawl_async(input_data))
        print(json.dumps(result, ensure_ascii=False))
    except ValueError as e:
        result = {"ok": False, "error": str(e), "status_code": 400}
        print(json.dumps(result))
        sys.exit(1)
    except Exception as e:
        result = {"ok": False, "error": str(e), "status_code": 500}
        print(json.dumps(result))
        sys.exit(1)


if __name__ == "__main__":
    main()
