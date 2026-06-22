"""
Crunchbase Crawler using Damru (Android-native Playwright + CDP).

Protocol: reads JSON input from stdin, writes JSON output to stdout.
All logs go to stderr to keep stdout clean for the JS caller.

Flow:
1. Start a Damru Android browser context
2. Navigate to https://www.crunchbase.com/
3. Type company name into the search textarea
4. Wait for autocomplete dropdown
5. Click the first company result
6. Wait for company page to load
7. Extract company profile data
"""

import asyncio
import contextlib
import json
import platform
import re
import sys
from pathlib import Path

CRUNCHBASE_URL = "https://www.crunchbase.com/"
DEFAULT_PROFILE_DIR = str(Path.cwd() / ".browser-profiles" / "crunchbase-damru")


def log_info(message, details=None):
    entry = {"level": "info", "source": "crunchbase-damru", "message": message}
    if details:
        entry["details"] = details
    print(json.dumps(entry), file=sys.stderr)


def log_warn(message, details=None):
    entry = {"level": "warn", "source": "crunchbase-damru", "message": message}
    if details:
        entry["details"] = details
    print(json.dumps(entry), file=sys.stderr)


def log_error(message, details=None):
    entry = {"level": "error", "source": "crunchbase-damru", "message": message}
    if details:
        entry["details"] = details
    print(json.dumps(entry), file=sys.stderr)


def parse_input(data):
    query = data.get("query") or data.get("company") or data.get("name")
    if not query or not isinstance(query, str):
        raise ValueError("Field 'query' is required for crunchbase.com crawler.")

    return {
        "query": query.strip(),
        "timeout_ms": int(data.get("timeout_ms") or 60000),
        "browser_visible": data.get("browser_visible", True) and not data.get("headless", False),
        "keep_browser_open_ms": int(data.get("keep_browser_open_ms", 0)),
        "profile_dir": data.get("profile_dir") or DEFAULT_PROFILE_DIR,
        "device": data.get("device") or "random",
        "proxy": data.get("proxy"),
        "http_proxy": data.get("http_proxy"),
        "damru_debug": bool(data.get("damru_debug", False)),
    }


async def is_visible(page, selector):
    try:
        return bool(await page.evaluate("""
            (selector) => {
                const el = document.querySelector(selector);
                if (!el) return false;
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && rect.width > 0
                    && rect.height > 0;
            }
        """, selector))
    except Exception:
        return False


async def wait_for_visible(page, selector, timeout_ms, message):
    deadline = asyncio.get_running_loop().time() + timeout_ms / 1000
    last_error = None

    while asyncio.get_running_loop().time() < deadline:
        try:
            if await is_visible(page, selector):
                return True
        except Exception as e:
            last_error = e
        await asyncio.sleep(0.5)

    if last_error:
        raise RuntimeError(f"{message} Last error: {last_error}")
    raise RuntimeError(message)


async def dismiss_human_verify(page, label=""):
    verify_selector = "mat-dialog-container, .cdk-overlay-container .mat-mdc-dialog-surface"
    if not await is_visible(page, verify_selector):
        return False

    log_warn(f"[{label}] 'Please Verify You're a Human' dialog detected. Attempting to solve...")

    clicked = None
    try:
        clicked = await page.evaluate("""
            () => {
                const overlay = document.querySelector('.cdk-overlay-container');
                if (!overlay) return null;

                const iframe = overlay.querySelector('iframe[src*="turnstile"], iframe[src*="captcha"], iframe[src*="challenge"], iframe');
                if (iframe) {
                    const rect = iframe.getBoundingClientRect();
                    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                    if (target) target.click();
                }

                const buttons = Array.from(overlay.querySelectorAll('button, [role="button"], a'));
                const btn = buttons.find((button) => {
                    const text = (button.textContent || '').toLowerCase();
                    const style = window.getComputedStyle(button);
                    return /(verify|confirm|continue|submit|i.?m human|not a robot)/i.test(text)
                        && style.display !== 'none'
                        && style.visibility !== 'hidden';
                });
                if (btn) {
                    btn.click();
                    return btn.textContent.trim();
                }
                return iframe ? 'iframe-center-click' : null;
            }
        """)
    except Exception as e:
        log_warn(f"[{label}] Could not interact with verify dialog.", {"error": str(e)})

    if clicked:
        log_info(f"[{label}] Clicked verify control.", {"control": clicked})
        await asyncio.sleep(3)

    for i in range(60):
        if not await is_visible(page, verify_selector):
            log_info(f"[{label}] Verify dialog dismissed after {i}s.")
            return True
        if i % 10 == 0 and i > 0:
            log_info(f"[{label}] Still waiting for verify dialog to close... ({i}s)")
        await asyncio.sleep(1)

    log_warn(f"[{label}] Verify dialog did not close after 60s.")
    return False


async def type_like_human(page, selector, value, delay_ms=150):
    await page.click(selector)
    await asyncio.sleep(0.5)
    await page.keyboard.press("Control+a")
    await page.keyboard.press("Backspace")
    await asyncio.sleep(0.3)

    try:
        await page.type(selector, value, delay=delay_ms)
    except Exception:
        await page.evaluate("""
            ({ selector, value }) => {
                const el = document.querySelector(selector);
                if (!el) return false;
                el.focus();
                el.value = value;
                el.dispatchEvent(new InputEvent('input', {
                    bubbles: true,
                    data: value,
                    inputType: 'insertText'
                }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        """, {"selector": selector, "value": value})


async def read_autocomplete_items(page):
    return await page.evaluate("""
        () => {
            const options = Array.from(document.querySelectorAll('mat-option.organizations.result-option'));
            return options.map(opt => {
                const nameEl = opt.querySelector('.option-text');
                const descEl = opt.querySelector('.option-description');
                const imgEl = opt.querySelector('.option-image img');
                const text = nameEl ? nameEl.textContent.replace(/\\s+/g, ' ').trim() : '';
                const name = nameEl ? (nameEl.childNodes[0]?.textContent || '').trim() : '';
                const description = descEl ? descEl.textContent.replace(/^\\s*—\\s*/, '').trim() : '';
                const image = imgEl ? imgEl.src : null;
                return { name, description, image, full_text: text };
            });
        }
    """)


async def extract_company_data(page):
    return await page.evaluate("""
        () => {
            const normalize = (v) => v ? v.replace(/\\s+/g, ' ').trim() : null;
            const getText = (selector) => {
                const el = document.querySelector(selector);
                return el ? normalize(el.textContent) : null;
            };

            const name = getText('h1')
                || getText('.profile-name')
                || getText('[data-test="profile-name"]')
                || document.title?.split(' - ')?.[0]?.trim();

            const description = getText('description-card .description')
                || getText('[data-test="description-text"]')
                || getText('.description-card .description')
                || getText('.entity-description');

            const fields = {};
            const fieldCards = document.querySelectorAll('entity-field-card, field-formatter, .field-card');
            for (const card of fieldCards) {
                const label = card.querySelector('.field-label, label-with-info span, .label');
                const value = card.querySelector('.field-value, field-formatter, .value, a');
                if (label && value) {
                    const key = normalize(label.textContent);
                    const val = normalize(value.textContent);
                    if (key && val) fields[key] = val;
                }
            }

            const sections = {};
            const sectionHeaders = document.querySelectorAll('mat-card .header-text, .section-header');
            for (const header of sectionHeaders) {
                const sectionName = normalize(header.textContent);
                const card = header.closest('mat-card, .section-card');
                if (card && sectionName) {
                    sections[sectionName] = normalize(card.textContent);
                }
            }

            const socialLinks = [];
            const linkEls = document.querySelectorAll('a[href*="linkedin"], a[href*="twitter"], a[href*="facebook"], a[href*="github"], a.link-accent');
            for (const link of linkEls) {
                const href = link.href || link.getAttribute('href');
                const text = normalize(link.textContent);
                if (href && !href.startsWith('javascript:')) {
                    socialLinks.push({ text, url: href });
                }
            }

            const logo = document.querySelector('profile-header img, .profile-image img, .entity-image img');
            const logoUrl = logo ? (logo.src || logo.getAttribute('src')) : null;

            const pageTextSample = normalize(document.body?.innerText || '').slice(0, 3000);

            const keyItems = {};
            const infoCards = document.querySelectorAll('.info-card, identifier-multi-formatter, .overview-field');
            for (const card of infoCards) {
                const label = card.querySelector('.field-label, .label, dt');
                const value = card.querySelector('.field-value, .value, dd, a');
                if (label && value) {
                    const key = normalize(label.textContent);
                    const val = normalize(value.textContent);
                    if (key && val) keyItems[key] = val;
                }
            }

            return {
                name,
                description,
                logo_url: logoUrl,
                fields: Object.keys(fields).length > 0 ? fields : null,
                key_info: Object.keys(keyItems).length > 0 ? keyItems : null,
                sections: Object.keys(sections).length > 0 ? sections : null,
                social_links: socialLinks.length > 0 ? socialLinks : null,
                page_text_sample: pageTextSample,
                title: document.title || null,
            };
        }
    """)


async def crawl_async(params):
    try:
        from damru import AsyncDamru
    except ModuleNotFoundError as e:
        raise RuntimeError(
            "Damru is not installed in this Python environment. "
            "Install it with: python3 -m pip install git+https://github.com/akwin1234/damru.git"
        ) from e

    if platform.system() == "Darwin":
        raise RuntimeError(
            "Damru requires a Linux/Ubuntu or WSL2 environment with Docker, ADB, and binderfs/Redroid. "
            "It cannot run Redroid from native macOS. Run this crawler inside Ubuntu/WSL2, or switch "
            "the Crunchbase caller to crunchbase_botasaurus.py/crunchbase_scrapling.py for macOS testing."
        )

    query = params["query"]
    timeout_ms = params["timeout_ms"]
    browser_visible = params["browser_visible"]
    keep_browser_open_ms = params["keep_browser_open_ms"]

    step = 0

    def log_step(message, details=None):
        nonlocal step
        step += 1
        log_info(f"Step {step}: {message}", details)

    if browser_visible:
        log_info(
            "Damru runs inside Redroid. Use `python -m damru view` or `python -m damru ui` for a live viewer.",
            {"browser_visible": browser_visible},
        )

    damru_kwargs = {
        "device": params["device"],
        "debug": params["damru_debug"],
    }
    if params["proxy"]:
        damru_kwargs["proxy"] = params["proxy"]
    if params["http_proxy"]:
        damru_kwargs["http_proxy"] = params["http_proxy"]

    log_step("Launching AsyncDamru.", damru_kwargs)

    async with AsyncDamru(**damru_kwargs) as context:
        page = await context.new_page()

        log_step("Navigating to Crunchbase.", {"url": CRUNCHBASE_URL})
        await page.goto(CRUNCHBASE_URL, wait_until="domcontentloaded", timeout=timeout_ms)
        await asyncio.sleep(3)

        log_step("Checking for human verification dialog.")
        await dismiss_human_verify(page, "initial")

        log_step("Waiting for search input.")
        search_selector = "textarea#chat-input"
        await wait_for_visible(
            page,
            search_selector,
            timeout_ms,
            "Crunchbase search input was not found within timeout.",
        )

        log_step("Typing search query.", {"query": query})
        await type_like_human(page, search_selector, query, delay_ms=150)
        await asyncio.sleep(2)

        await dismiss_human_verify(page, "after-type")

        log_step("Waiting for autocomplete results.")
        company_option_selector = "mat-option.organizations.result-option"
        try:
            await wait_for_visible(
                page,
                company_option_selector,
                20000,
                f"No autocomplete results found for '{query}'.",
            )
        except RuntimeError:
            dismissed = await dismiss_human_verify(page, "retry-verify")
            if dismissed:
                log_info("Re-typing query after verification...")
            else:
                log_warn("Autocomplete not visible, retrying search...")

            await type_like_human(page, search_selector, query, delay_ms=200)
            await asyncio.sleep(3)
            await wait_for_visible(
                page,
                company_option_selector,
                20000,
                f"No autocomplete results found for '{query}'.",
            )

        await asyncio.sleep(1)

        autocomplete_items = await read_autocomplete_items(page)
        log_info("Autocomplete results.", {"count": len(autocomplete_items), "items": autocomplete_items[:5]})
        if not autocomplete_items:
            raise RuntimeError(f"No company results found for '{query}'.")

        log_step("Clicking first company result.", {"company": autocomplete_items[0].get("name", "")})
        await page.click(company_option_selector)

        log_step("Waiting for company page to load.")
        try:
            await page.wait_for_url("**/organization/**", timeout=timeout_ms)
        except Exception:
            if not re.search(r"/organization/", page.url):
                log_warn("URL did not change to /organization/ pattern.")

        await asyncio.sleep(5)

        log_step("Extracting company data.")
        company_url = page.url
        company_data = await extract_company_data(page)

        log_step("Extraction complete.", {
            "company_name": company_data.get("name"),
            "company_url": company_url,
        })

        if keep_browser_open_ms > 0:
            log_step("Keeping Damru session open for inspection.", {"keep_browser_open_ms": keep_browser_open_ms})
            await asyncio.sleep(keep_browser_open_ms / 1000)

        return {
            "ok": True,
            "url": company_url,
            "query": query,
            "engine": "damru-python",
            "autocomplete_items": autocomplete_items,
            "company": company_data,
        }


def crawl(input_data):
    params = parse_input(input_data)
    profile_dir = params["profile_dir"]

    log_info("Starting Crunchbase crawler.", {
        "query": params["query"],
        "profile_dir": profile_dir,
        "timeout_ms": params["timeout_ms"],
        "browser_visible": params["browser_visible"],
        "device": params["device"],
    })

    Path(profile_dir).mkdir(parents=True, exist_ok=True)

    with contextlib.redirect_stdout(sys.stderr):
        return asyncio.run(crawl_async(params))


def main():
    try:
        raw_input = sys.stdin.read()
        input_data = json.loads(raw_input)
    except json.JSONDecodeError as e:
        result = {"ok": False, "error": f"Invalid JSON input: {e}"}
        print(json.dumps(result))
        sys.exit(1)

    try:
        result = crawl(input_data)
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
