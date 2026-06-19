"""
YTDown Crawler using Scrapling (StealthyFetcher with auto Cloudflare bypass).

Protocol: reads JSON input from stdin, writes JSON output to stdout.
All logs go to stderr to keep stdout clean for the JS caller.

Scrapling's StealthyFetcher uses Patchright (patched Playwright Chromium) and
can auto-solve Cloudflare Turnstile/Interstitial via solve_cloudflare=True.
Dynamic interaction (fill input, submit) is done via the page_action callback,
which receives the raw Playwright page object.
"""

import sys
import json
import re
import time
import asyncio
from pathlib import Path
from urllib.parse import urlparse

from scrapling.fetchers import AsyncStealthySession


YTDOWN_URL = "https://app.ytdown.to/vi29/"
DEFAULT_PROFILE_DIR = str(Path.cwd() / ".browser-profiles" / "ytdown-scrapling")


def log_info(message, details=None):
    entry = {"level": "info", "source": "ytdown-scrapling", "message": message}
    if details:
        entry["details"] = details
    print(json.dumps(entry), file=sys.stderr)


def log_warn(message, details=None):
    entry = {"level": "warn", "source": "ytdown-scrapling", "message": message}
    if details:
        entry["details"] = details
    print(json.dumps(entry), file=sys.stderr)


def log_error(message, details=None):
    entry = {"level": "error", "source": "ytdown-scrapling", "message": message}
    if details:
        entry["details"] = details
    print(json.dumps(entry), file=sys.stderr)


def is_cloudflare_page(text="", title=""):
    value = f"{title} {text}"
    return bool(re.search(r"just a moment|performing security verification|cloudflare|cf-turnstile", value, re.IGNORECASE))


def is_download_candidate_url(url=""):
    if not url or url.startswith("blob:") or url.startswith("javascript:") or url == YTDOWN_URL:
        return False
    try:
        parsed = urlparse(url)
        value = f"{parsed.hostname}{parsed.path}{parsed.query}"
        if re.search(r"cloudflare|turnstile|captcha|challenge", value, re.IGNORECASE):
            return False
        return bool(
            re.search(r"\.(mp4|webm|m4a|mp3)($|\?)", url, re.IGNORECASE)
            or re.search(r"download|convert|video|audio|media|file|token|api", value, re.IGNORECASE)
        )
    except Exception:
        return False


def pick_headers(headers):
    names = ["accept", "accept-language", "content-type", "range", "referer", "user-agent"]
    return {k: v for k, v in (headers or {}).items() if k.lower() in names}


def create_curl(url, headers=None):
    lines = [f"curl '{url}'"]
    for name, value in (headers or {}).items():
        lines.append(f"  -H '{name}: {value}'")
    return " \\\n".join(lines)


def parse_input(data):
    raw_url = data.get("youtube_url") or data.get("video_url") or data.get("url")
    if not raw_url or not isinstance(raw_url, str):
        raise ValueError("Field 'youtube_url' is required for app.ytdown.to crawler.")

    try:
        parsed = urlparse(raw_url)
    except Exception:
        raise ValueError("Field 'youtube_url' must be a valid YouTube URL.")

    valid_hosts = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]
    if parsed.hostname not in valid_hosts:
        raise ValueError("YTDown crawler only accepts YouTube URLs.")

    return {
        "youtube_url": raw_url,
        "timeout_ms": int(data.get("timeout_ms") or 120000),
        "manual_verify_timeout_ms": int(data.get("manual_verify_timeout_ms") or 180000),
        "browser_visible": data.get("browser_visible", True) and not data.get("headless", False),
        "keep_browser_open_ms": int(data.get("keep_browser_open_ms", 0)),
        "profile_dir": data.get("profile_dir") or DEFAULT_PROFILE_DIR,
    }


async def crawl(input_data):
    params = parse_input(input_data)
    youtube_url = params["youtube_url"]
    timeout_ms = params["timeout_ms"]
    manual_verify_timeout_ms = params["manual_verify_timeout_ms"]
    browser_visible = params["browser_visible"]
    keep_browser_open_ms = params["keep_browser_open_ms"]
    profile_dir = params["profile_dir"]

    download_candidates = {}
    step = 0
    # Shared dict to collect page_action results
    action_result = {}

    def log_step(message, details=None):
        nonlocal step
        step += 1
        log_info(f"Step {step}: {message}", details)

    def remember_candidate(source, url, details=None):
        if not is_download_candidate_url(url):
            return
        prev = download_candidates.get(url, {})
        entry = {
            "url": url,
            "source": prev.get("source", source),
            "seen_at": prev.get("seen_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())),
            **prev,
            **(details or {}),
        }
        download_candidates[url] = entry
        log_info("Captured possible download URL.", {"source": source, "url": url})

    log_info("Starting YTDown Scrapling bot.", {
        "youtube_url": youtube_url,
        "profile_dir": profile_dir,
        "timeout_ms": timeout_ms,
        "browser_visible": browser_visible,
    })

    # Ensure profile dir exists
    Path(profile_dir).mkdir(parents=True, exist_ok=True)

    # --- page_setup: runs BEFORE navigation, registers network listeners ---
    async def on_page_setup(page):
        log_info("page_setup: Registering network listeners.")

        def on_request(request):
            url = request.url
            if is_download_candidate_url(url):
                remember_candidate("request", url, {
                    "method": request.method,
                    "resource_type": request.resource_type,
                    "request_headers": pick_headers(request.headers),
                })

        def on_response(response):
            url = response.url
            if is_download_candidate_url(url):
                remember_candidate("response", url, {
                    "status": response.status,
                    "response_headers": pick_headers(response.headers),
                })

        page.on("request", on_request)
        page.on("response", on_response)

    # --- page_action: runs AFTER navigation + Cloudflare solve ---
    async def on_page_action(page):
        log_step("page_action: Waiting for app input field.")

        # Wait for input to appear
        input_selectors = [
            "input[placeholder*='YouTube' i]",
            "input[placeholder*='URL' i]",
            "input[type='url']",
            "input[name='url']",
            "input[type='text']",
            "textarea",
        ]
        combined_selector = ", ".join(input_selectors)

        try:
            await page.wait_for_selector(combined_selector, timeout=manual_verify_timeout_ms)
        except Exception:
            raise RuntimeError("YTDown input was not found within timeout.")

        log_step("page_action: Filling YouTube URL.", {"youtube_url": youtube_url})

        # Find the first visible input
        for selector in input_selectors:
            try:
                el = await page.query_selector(selector)
                if el and await el.is_visible():
                    await page.click(selector, click_count=3)
                    await page.keyboard.press("Backspace")
                    await page.type(selector, youtube_url, delay=15)
                    log_info(f"Filled input: {selector}")
                    break
            except Exception:
                continue

        log_step("page_action: Submitting form.")

        # Try submit button
        submit_clicked = False
        for sel in ["button[type='submit']", "input[type='submit']"]:
            try:
                el = await page.query_selector(sel)
                if el and await el.is_visible():
                    await el.click()
                    submit_clicked = True
                    log_info(f"Clicked submit: {sel}")
                    break
            except Exception:
                pass

        if not submit_clicked:
            clicked = await page.evaluate("""() => {
                const elements = Array.from(document.querySelectorAll("button, input[type='submit'], a, [role='button']"));
                const el = elements.find((item) => {
                    const text = (item.getAttribute('aria-label') || '') + ' ' + (item.textContent || '') + ' ' + (item.value || '');
                    const style = window.getComputedStyle(item);
                    const rect = item.getBoundingClientRect();
                    return /(download|tải|tải xuống|convert|start|go)/i.test(text)
                        && style.display !== 'none'
                        && style.visibility !== 'hidden'
                        && rect.width > 0
                        && rect.height > 0;
                });
                if (!el) return null;
                el.click();
                return el.tagName.toLowerCase() + ':' + (el.textContent || el.value || '').replace(/\\s+/g, ' ').trim();
            }""")
            if clicked:
                log_info(f"Clicked submit via JS: {clicked}")
            else:
                await page.keyboard.press("Enter")
                log_info("Pressed Enter as fallback submit.")

        log_step("page_action: Waiting for download links.")

        # Wait for download candidates
        try:
            await page.wait_for_function(
                """() => {
                    const values = Array.from(document.querySelectorAll('a, video, source'))
                        .flatMap(el => [el.getAttribute('href'), el.href, el.getAttribute('src'), el.src, el.currentSrc])
                        .filter(Boolean);
                    return values.some(v => {
                        try {
                            const url = new URL(v);
                            return /(download|convert|video|audio|media|file|token|api)/i.test(url.hostname + url.pathname + url.search);
                        } catch { return false; }
                    });
                }""",
                timeout=timeout_ms,
                polling=500,
            )
        except Exception:
            log_warn("waitForFunction timed out, continuing with whatever is on page.")

        await asyncio.sleep(3)

        log_step("page_action: Extracting page data.")

        # Extract links from page
        page_data = await page.evaluate("""() => {
            const normalize = (v) => v.replace(/\\s+/g, ' ').trim();
            const readElement = (el) => {
                const attrs = {};
                for (const attr of el.attributes || []) {
                    if (attr.name.startsWith('data-')) attrs[attr.name] = attr.value;
                }
                return {
                    tag: el.tagName.toLowerCase(),
                    text: normalize(el.textContent || el.value || ''),
                    href: el.href || el.getAttribute('href'),
                    src: el.src || el.currentSrc || el.getAttribute('src'),
                    download: el.getAttribute('download'),
                    data: attrs
                };
            };
            const links = Array.from(document.querySelectorAll('a, button, [role="button"], video, source'))
                .map(readElement)
                .filter((item) => {
                    const value = (item.text || '') + ' ' + (item.href || '') + ' ' + (item.src || '');
                    return /(download|tải|mp4|webm|m4a|mp3|video|audio|media|api|token)/i.test(value);
                });
            return {
                title: document.title || null,
                page_text_sample: normalize(document.body?.innerText || '').slice(0, 1200),
                links
            };
        }""")

        # Store in shared dict so crawl() can access after fetch returns
        action_result["page_data"] = page_data

        for item in page_data.get("links", []):
            if item.get("href"):
                remember_candidate("dom-link", item["href"])
            if item.get("src"):
                remember_candidate("dom-media", item["src"])

    log_step("Launching AsyncStealthySession.", {"headless": not browser_visible, "profile_dir": profile_dir})

    async with AsyncStealthySession(
        headless=not browser_visible,
        disable_resources=False,
        humanize=True,
    ) as session:

        log_step("Navigating to YTDown with Cloudflare solve.", {"url": YTDOWN_URL})

        # page_setup registers listeners before navigation
        # page_action runs after page load + Cloudflare solve
        # solve_cloudflare=True handles Turnstile/Interstitial automatically
        page = await session.fetch(
            YTDOWN_URL,
            solve_cloudflare=True,
            timeout=timeout_ms / 1000,
            page_setup=on_page_setup,
            page_action=on_page_action,
        )

        # Retrieve page_data collected by page_action
        page_data = action_result.get("page_data", {
            "title": page.css('title::text').get() or None,
            "page_text_sample": str(page.get_all_text())[:1200] if hasattr(page, 'get_all_text') else "",
            "links": [],
        })

        # Build downloads list
        downloads = []
        for item in download_candidates.values():
            item["curl"] = create_curl(item["url"], item.get("request_headers"))
            downloads.append(item)

        best_download = next(
            (d for d in downloads if re.search(r"\.(mp4|webm|m4a|mp3)($|\?)", d["url"], re.IGNORECASE)),
            downloads[0] if downloads else None,
        )

        log_step("Extraction complete.", {
            "download_count": len(downloads),
            "best_download_url": best_download["url"] if best_download else None,
        })

        if keep_browser_open_ms > 0:
            log_step("Keeping browser open for inspection.", {"keep_browser_open_ms": keep_browser_open_ms})
            await asyncio.sleep(keep_browser_open_ms / 1000)

        return {
            "ok": True,
            "url": YTDOWN_URL,
            "youtube_url": youtube_url,
            "engine": "scrapling-python",
            "profile_dir": profile_dir,
            "downloads": downloads,
            "best_download": best_download,
            "page": page_data,
        }


def main():
    try:
        raw_input = sys.stdin.read()
        input_data = json.loads(raw_input)
    except json.JSONDecodeError as e:
        result = {"ok": False, "error": f"Invalid JSON input: {e}"}
        print(json.dumps(result))
        sys.exit(1)

    try:
        result = asyncio.run(crawl(input_data))
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
