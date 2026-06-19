"""
YTDown Crawler using Camoufox (anti-detect Firefox).

Protocol: reads JSON input from stdin, writes JSON output to stdout.
All logs go to stderr to keep stdout clean for the JS caller.
"""

import sys
import json
import re
import time
import os
import asyncio
from pathlib import Path
from urllib.parse import urlparse

from camoufox.async_api import AsyncCamoufox
from camoufox import launch_options
from camoufox_captcha import solve_captcha


YTDOWN_URL = "https://app.ytdown.to/vi29/"
DEFAULT_PROFILE_DIR = str(Path.cwd() / ".browser-profiles" / "ytdown-camoufox")


def log_info(message, details=None):
    entry = {"level": "info", "source": "ytdown", "message": message}
    if details:
        entry["details"] = details
    print(json.dumps(entry), file=sys.stderr)


def log_warn(message, details=None):
    entry = {"level": "warn", "source": "ytdown", "message": message}
    if details:
        entry["details"] = details
    print(json.dumps(entry), file=sys.stderr)


def log_error(message, details=None):
    entry = {"level": "error", "source": "ytdown", "message": message}
    if details:
        entry["details"] = details
    print(json.dumps(entry), file=sys.stderr)


def normalize_text(value=""):
    return re.sub(r"\s+", " ", value).strip()


def is_cloudflare_page(text="", title=""):
    value = f"{title} {text}"
    return bool(re.search(r"just a moment|performing security verification|cloudflare|cf-turnstile", value, re.IGNORECASE))


def is_download_candidate_url(url=""):
    if not url or url.startswith("blob:") or url == YTDOWN_URL:
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
        "slow_mo_ms": int(data.get("slow_mo_ms", 150)),
        "keep_browser_open_ms": int(data.get("keep_browser_open_ms", 0)),
        "profile_dir": data.get("profile_dir") or DEFAULT_PROFILE_DIR,
    }


async def is_visible(page, selector):
    try:
        return await page.eval_on_selector(
            selector,
            """(element) => {
                const style = window.getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            }"""
        )
    except Exception:
        return False


async def wait_for_cloudflare_clearance(page, timeout_ms, profile_dir):
    try:
        state = await page.evaluate("() => ({ title: document.title || '', text: document.body?.innerText || '' })")
    except Exception:
        state = {"title": "", "text": ""}

    if not is_cloudflare_page(state.get("text", ""), state.get("title", "")):
        return

    log_info("Cloudflare challenge detected. Waiting for bypass...", {"profile_dir": profile_dir})
    deadline = time.time() + timeout_ms / 1000

    while time.time() < deadline:
        await asyncio.sleep(2)
        try:
            cookies = await page.context.cookies()
        except Exception:
            cookies = []

        cf_clearance = next((c for c in cookies if c.get("name") == "cf_clearance"), None)
        if cf_clearance:
            log_info("cf_clearance cookie obtained. Cloudflare bypass successful.")
            return

        try:
            current = await page.evaluate("() => ({ title: document.title || '', text: document.body?.innerText || '' })")
        except Exception:
            current = {"title": "", "text": ""}

        if not is_cloudflare_page(current.get("text", ""), current.get("title", "")):
            log_info("Cloudflare challenge page is gone. Bypass likely successful.")
            return

        remaining = max(0, int((deadline - time.time()) * 1000))
        log_warn("Still on Cloudflare challenge.", {"profile_dir": profile_dir, "remaining_ms": remaining})

    log_warn("Cloudflare bypass timed out — continuing anyway.")


async def wait_for_app_input(page, timeout_ms, profile_dir):
    selectors = [
        "input[type='url']",
        "input[name='url']",
        "input[name='q']",
        "input[name='query']",
        "input[placeholder*='YouTube' i]",
        "input[placeholder*='Youtube' i]",
        "input[placeholder*='URL' i]",
        "input[type='text']",
        "textarea",
    ]
    deadline = time.time() + timeout_ms / 1000

    while time.time() < deadline:
        for selector in selectors:
            if await is_visible(page, selector):
                return selector

        try:
            state = await page.evaluate("() => ({ title: document.title || '', text: document.body?.innerText || '' })")
        except Exception:
            state = {"title": "", "text": ""}

        if is_cloudflare_page(state.get("text", ""), state.get("title", "")):
            log_warn("Cloudflare still visible. Complete verification in the Camoufox window.", {
                "profile_dir": profile_dir,
                "remaining_ms": max(0, int((deadline - time.time()) * 1000))
            })
        else:
            log_warn("Waiting for YTDown input to appear.", {
                "remaining_ms": max(0, int((deadline - time.time()) * 1000))
            })

        await asyncio.sleep(3)

    raise RuntimeError("YTDown input was not found within timeout.")


async def fill_youtube_input(page, youtube_url):
    selectors = [
        "input[type='url']",
        "input[name='url']",
        "input[name='q']",
        "input[name='query']",
        "input[placeholder*='YouTube' i]",
        "input[placeholder*='Youtube' i]",
        "input[placeholder*='URL' i]",
        "input[type='text']",
        "textarea",
    ]
    for selector in selectors:
        if await is_visible(page, selector):
            await page.click(selector, click_count=3)
            await page.keyboard.press("Backspace")
            await page.type(selector, youtube_url, delay=15)
            return selector

    raise RuntimeError("YouTube URL input was not found.")


async def click_submit_button(page):
    direct_selectors = ["button[type='submit']", "input[type='submit']"]
    for selector in direct_selectors:
        if await is_visible(page, selector):
            await page.click(selector)
            return selector

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
        return clicked

    await page.keyboard.press("Enter")
    return "keyboard-enter"


async def extract_page_data(page):
    return await page.evaluate("""() => {
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


async def crawl(input_data):
    params = parse_input(input_data)
    youtube_url = params["youtube_url"]
    timeout_ms = params["timeout_ms"]
    manual_verify_timeout_ms = params["manual_verify_timeout_ms"]
    browser_visible = params["browser_visible"]
    slow_mo_ms = params["slow_mo_ms"]
    keep_browser_open_ms = params["keep_browser_open_ms"]
    profile_dir = params["profile_dir"]

    download_candidates = {}
    step = 0

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

    log_info("Starting YTDown Camoufox bot.", {
        "youtube_url": youtube_url,
        "profile_dir": profile_dir,
        "timeout_ms": timeout_ms,
        "browser_visible": browser_visible,
    })

    # Ensure profile dir exists
    Path(profile_dir).mkdir(parents=True, exist_ok=True)

    # Load or create persistent fingerprint
    fingerprint_file = os.path.join(profile_dir, "fingerprint.json")
    from_options = None
    if os.path.exists(fingerprint_file):
        try:
            with open(fingerprint_file, "r") as f:
                from_options = json.load(f)
            log_info("Loaded saved fingerprint.", {"path": fingerprint_file})
        except Exception:
            from_options = None

    log_step("Launching Camoufox.", {"headless": not browser_visible, "profile_dir": profile_dir})

    camoufox_kwargs = {
        "headless": not browser_visible,
        "humanize": True,
        "geoip": True,
        "persistent_context": True,
        "user_data_dir": profile_dir,
        "i_know_what_im_doing": True,
        "config": {"forceScopeAccess": True},
        "disable_coop": True,
    }

    if from_options:
        camoufox_kwargs["from_options"] = from_options

    async with AsyncCamoufox(**camoufox_kwargs) as browser:
        # Save fingerprint for future sessions if new
        if not from_options:
            try:
                opts = launch_options(
                    headless=not browser_visible,
                    humanize=True,
                    geoip=True,
                    user_data_dir=profile_dir,
                )
                with open(fingerprint_file, "w") as f:
                    json.dump(opts, f, indent=2, default=str)
                log_info("Saved new fingerprint.", {"path": fingerprint_file})
            except Exception as e:
                log_warn(f"Could not save fingerprint: {e}")

        page = await browser.new_page()
        page.set_default_timeout(timeout_ms)
        page.set_default_navigation_timeout(timeout_ms)

        # Listen for network requests
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

        log_step("Navigating to YTDown.", {"url": YTDOWN_URL})
        await page.goto(YTDOWN_URL, wait_until="domcontentloaded", timeout=timeout_ms)

        log_step("Checking for Cloudflare challenge.")
        try:
            state = await page.evaluate("() => ({ title: document.title || '', text: document.body?.innerText || '' })")
        except Exception:
            state = {"title": "", "text": ""}

        if is_cloudflare_page(state.get("text", ""), state.get("title", "")):
            log_info("Cloudflare challenge detected. Attempting auto-solve...")
            try:
                solved = await solve_captcha(
                    page,
                    captcha_type="cloudflare",
                    challenge_type="interstitial",
                    solve_attempts=5,
                    solve_click_delay=3.0,
                )
                if solved:
                    log_info("Cloudflare challenge solved automatically.")
                else:
                    log_warn("Auto-solve returned False. Falling back to manual wait...")
                    await wait_for_cloudflare_clearance(page, manual_verify_timeout_ms, profile_dir)
            except Exception as e:
                log_warn(f"Auto-solve failed: {e}. Falling back to manual wait...")
                await wait_for_cloudflare_clearance(page, manual_verify_timeout_ms, profile_dir)

            # Reload page after Cloudflare clearance to get fresh content
            log_info("Reloading page after Cloudflare clearance...")
            await page.goto(YTDOWN_URL, wait_until="domcontentloaded", timeout=timeout_ms)
            await asyncio.sleep(2)
        else:
            log_info("No Cloudflare challenge detected.")

        log_step("Waiting for app input.")
        await wait_for_app_input(page, manual_verify_timeout_ms, profile_dir)

        log_step("Filling YouTube URL.", {"youtube_url": youtube_url})
        input_selector = await fill_youtube_input(page, youtube_url)

        log_step("Submitting form.", {"input_selector": input_selector})
        submit_selector = await click_submit_button(page)

        log_step("Waiting for generated links.", {"submit_selector": submit_selector})

        # Wait for download candidates to appear
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
            log_warn("waitForFunction timed out, continuing with whatever was captured.")

        await asyncio.sleep(3)

        log_step("Extracting page result data.")
        page_data = await extract_page_data(page)

        for item in page_data.get("links", []):
            if item.get("href"):
                remember_candidate("dom-link", item["href"])
            if item.get("src"):
                remember_candidate("dom-media", item["src"])

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
            "engine": "camoufox-python",
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
