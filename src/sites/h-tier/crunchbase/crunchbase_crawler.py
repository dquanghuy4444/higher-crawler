"""
Crunchbase Crawler using Scrapling (StealthyFetcher with auto Cloudflare bypass).

Protocol: reads JSON input from stdin, writes JSON output to stdout.
All logs go to stderr to keep stdout clean for the JS caller.

Flow:
1. Navigate to https://www.crunchbase.com/
2. Type company name into the search textarea
3. Wait for autocomplete dropdown
4. Click the first company result
5. Wait for company page to load
6. Extract company profile data
"""

import sys
import json
import re
import time
import asyncio
from pathlib import Path
from urllib.parse import urlparse

from scrapling.fetchers import AsyncStealthySession


CRUNCHBASE_URL = "https://www.crunchbase.com/"
DEFAULT_PROFILE_DIR = str(Path.cwd() / ".browser-profiles" / "crunchbase-scrapling")


def log_info(message, details=None):
    entry = {"level": "info", "source": "crunchbase", "message": message}
    if details:
        entry["details"] = details
    print(json.dumps(entry), file=sys.stderr)


def log_warn(message, details=None):
    entry = {"level": "warn", "source": "crunchbase", "message": message}
    if details:
        entry["details"] = details
    print(json.dumps(entry), file=sys.stderr)


def log_error(message, details=None):
    entry = {"level": "error", "source": "crunchbase", "message": message}
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
    }


async def crawl(input_data):
    params = parse_input(input_data)
    query = params["query"]
    timeout_ms = params["timeout_ms"]
    browser_visible = params["browser_visible"]
    keep_browser_open_ms = params["keep_browser_open_ms"]
    profile_dir = params["profile_dir"]

    step = 0
    # Shared dict to collect page_action results
    action_result = {}

    def log_step(message, details=None):
        nonlocal step
        step += 1
        log_info(f"Step {step}: {message}", details)

    log_info("Starting Crunchbase crawler.", {
        "query": query,
        "profile_dir": profile_dir,
        "timeout_ms": timeout_ms,
        "browser_visible": browser_visible,
    })

    # Ensure profile dir exists
    Path(profile_dir).mkdir(parents=True, exist_ok=True)

    # --- Helper: dismiss Crunchbase "Please Verify You're a Human" dialog ---
    async def dismiss_human_verify(page, label=""):
        """Check for and handle Crunchbase's human verification overlay dialog."""
        verify_selector = "mat-dialog-container, .cdk-overlay-container .mat-mdc-dialog-surface"
        try:
            dialog = await page.query_selector(verify_selector)
            if not dialog or not await dialog.is_visible():
                return False
        except Exception:
            return False

        log_warn(f"[{label}] 'Please Verify You're a Human' dialog detected. Attempting to solve...")

        # Check if there's a Turnstile/CAPTCHA iframe inside the dialog
        captcha_iframe = await page.query_selector(
            "mat-dialog-container iframe[src*='turnstile'], "
            "mat-dialog-container iframe[src*='captcha'], "
            "mat-dialog-container iframe[src*='challenge'], "
            ".cdk-overlay-container iframe"
        )

        if captcha_iframe:
            log_info(f"[{label}] Found CAPTCHA iframe in verify dialog, clicking it...")
            try:
                frame = await captcha_iframe.content_frame()
                if frame:
                    # Try clicking the Turnstile checkbox
                    checkbox = await frame.query_selector(
                        "input[type='checkbox'], .cf-turnstile-wrapper, div[id*='turnstile']"
                    )
                    if checkbox:
                        await checkbox.click()
                        await asyncio.sleep(3)
                    else:
                        # Click center of iframe
                        box = await captcha_iframe.bounding_box()
                        if box:
                            await page.mouse.click(
                                box["x"] + box["width"] / 2,
                                box["y"] + box["height"] / 2,
                            )
                            await asyncio.sleep(3)
            except Exception as e:
                log_warn(f"[{label}] Could not interact with captcha iframe: {e}")

        # Try clicking a confirm/verify/submit button inside the dialog
        try:
            btn = await page.evaluate("""() => {
                const overlay = document.querySelector('.cdk-overlay-container');
                if (!overlay) return null;
                const buttons = Array.from(overlay.querySelectorAll('button, [role="button"], a'));
                const btn = buttons.find(b => {
                    const text = (b.textContent || '').toLowerCase();
                    return /(verify|confirm|continue|submit|i.?m human|not a robot)/i.test(text)
                        && window.getComputedStyle(b).display !== 'none';
                });
                if (btn) { btn.click(); return btn.textContent.trim(); }
                return null;
            }""")
            if btn:
                log_info(f"[{label}] Clicked verify button: {btn}")
                await asyncio.sleep(3)
        except Exception:
            pass

        # Wait for dialog to disappear
        max_wait = 60
        for i in range(max_wait):
            try:
                dialog = await page.query_selector(verify_selector)
                if not dialog or not await dialog.is_visible():
                    log_info(f"[{label}] Verify dialog dismissed after {i}s.")
                    return True
            except Exception:
                return True
            if i % 10 == 0 and i > 0:
                log_info(f"[{label}] Still waiting for verify dialog to close... ({i}s)")
            await asyncio.sleep(1)

        log_warn(f"[{label}] Verify dialog did not close after {max_wait}s.")
        return False

    # --- page_action: runs AFTER navigation + Cloudflare solve ---
    async def on_page_action(page):
        log_step("page_action: Checking for human verification dialog.")

        # Handle the "Please Verify You're a Human" overlay first
        await dismiss_human_verify(page, "initial")

        log_step("page_action: Waiting for search input.")

        # Wait for the search textarea to appear
        search_selector = "textarea#chat-input"
        try:
            await page.wait_for_selector(search_selector, timeout=timeout_ms, state="visible")
        except Exception:
            raise RuntimeError("Crunchbase search input was not found within timeout.")

        log_step("page_action: Typing search query.", {"query": query})

        # Focus the textarea
        await page.click(search_selector)
        await asyncio.sleep(0.5)

        # Clear any existing text using keyboard
        await page.keyboard.press("Control+a")
        await page.keyboard.press("Backspace")
        await asyncio.sleep(0.3)

        # Type with realistic delay to trigger Angular autocomplete
        await page.type(search_selector, query, delay=150)
        await asyncio.sleep(2)

        # Check if verify dialog popped up after typing
        await dismiss_human_verify(page, "after-type")

        log_step("page_action: Waiting for autocomplete results.")

        # Wait for autocomplete dropdown with company results
        company_option_selector = "mat-option.organizations.result-option"
        try:
            await page.wait_for_selector(company_option_selector, timeout=20000, state="visible")
        except Exception:
            # Check for verify dialog again
            dismissed = await dismiss_human_verify(page, "retry-verify")
            if dismissed:
                # After verify, need to re-type the query
                log_info("Re-typing query after verification...")
                await page.click(search_selector)
                await page.keyboard.press("Control+a")
                await page.keyboard.press("Backspace")
                await asyncio.sleep(0.5)
                await page.type(search_selector, query, delay=150)
                await asyncio.sleep(2)

            # Retry: clear and retype with even slower delay
            if not dismissed:
                log_warn("Autocomplete not visible, retrying search...")
                await page.click(search_selector)
                await page.keyboard.press("Control+a")
                await page.keyboard.press("Backspace")
                await asyncio.sleep(0.5)
                await page.type(search_selector, query, delay=200)
                await asyncio.sleep(3)

            try:
                await page.wait_for_selector(company_option_selector, timeout=20000, state="visible")
            except Exception:
                raise RuntimeError(f"No autocomplete results found for '{query}'.")

        await asyncio.sleep(1)

        # Read all autocomplete options before clicking
        autocomplete_items = await page.evaluate("""() => {
            const options = Array.from(document.querySelectorAll('mat-option.organizations.result-option'));
            return options.map(opt => {
                const nameEl = opt.querySelector('.option-text');
                const descEl = opt.querySelector('.option-description');
                const imgEl = opt.querySelector('.option-image img');
                const text = nameEl ? nameEl.textContent.replace(/\\s+/g, ' ').trim() : '';
                // Extract just the company name (before the description span)
                const name = nameEl ? (nameEl.childNodes[0]?.textContent || '').trim() : '';
                const description = descEl ? descEl.textContent.replace(/^\\s*—\\s*/, '').trim() : '';
                const image = imgEl ? imgEl.src : null;
                return { name, description, image, full_text: text };
            });
        }""")

        log_info("Autocomplete results.", {"count": len(autocomplete_items), "items": autocomplete_items[:5]})

        if not autocomplete_items:
            raise RuntimeError(f"No company results found for '{query}'.")

        log_step("page_action: Clicking first company result.", {"company": autocomplete_items[0].get("name", "")})

        # Click the first company option
        first_option = await page.query_selector(company_option_selector)
        if not first_option:
            raise RuntimeError("Could not click first company result.")

        await first_option.click()

        log_step("page_action: Waiting for company page to load.")

        # Wait for Angular SPA to navigate to /organization/ URL
        try:
            await page.wait_for_url("**/organization/**", timeout=timeout_ms)
        except Exception:
            log_warn("URL did not change to /organization/ pattern.")

        # Wait for company page content to render
        await asyncio.sleep(5)

        log_step("page_action: Extracting company data.")

        company_url = page.url

        # Extract company profile data
        company_data = await page.evaluate("""() => {
            const normalize = (v) => v ? v.replace(/\\s+/g, ' ').trim() : null;
            const getText = (selector) => {
                const el = document.querySelector(selector);
                return el ? normalize(el.textContent) : null;
            };

            // Company name - try multiple selectors
            const name = getText('h1')
                || getText('.profile-name')
                || getText('[data-test="profile-name"]')
                || document.title?.split(' - ')?.[0]?.trim();

            // Description / About
            const description = getText('description-card .description')
                || getText('[data-test="description-text"]')
                || getText('.description-card .description')
                || getText('.entity-description');

            // Fields from field cards
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

            // Profile sections
            const sections = {};
            const sectionHeaders = document.querySelectorAll('mat-card .header-text, .section-header');
            for (const header of sectionHeaders) {
                const sectionName = normalize(header.textContent);
                const card = header.closest('mat-card, .section-card');
                if (card && sectionName) {
                    sections[sectionName] = normalize(card.textContent);
                }
            }

            // Social links
            const socialLinks = [];
            const linkEls = document.querySelectorAll('a[href*="linkedin"], a[href*="twitter"], a[href*="facebook"], a[href*="github"], a.link-accent');
            for (const link of linkEls) {
                const href = link.href || link.getAttribute('href');
                const text = normalize(link.textContent);
                if (href && !href.startsWith('javascript:')) {
                    socialLinks.push({ text, url: href });
                }
            }

            // Logo / image
            const logo = document.querySelector('profile-header img, .profile-image img, .entity-image img');
            const logoUrl = logo ? (logo.src || logo.getAttribute('src')) : null;

            // All visible text for fallback extraction
            const pageTextSample = normalize(document.body?.innerText || '').slice(0, 3000);

            // Key info items (funding, employees, etc.)
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
        }""")

        action_result["company_data"] = company_data
        action_result["company_url"] = company_url
        action_result["autocomplete_items"] = autocomplete_items

    log_step("Launching AsyncStealthySession.", {"headless": not browser_visible})

    async with AsyncStealthySession(
        headless=not browser_visible,
        disable_resources=False,
        humanize=True,
    ) as session:

        log_step("Navigating to Crunchbase.", {"url": CRUNCHBASE_URL})

        page = await session.fetch(
            CRUNCHBASE_URL,
            solve_cloudflare=True,
            timeout=timeout_ms / 1000,
            page_action=on_page_action,
        )

        # Retrieve data collected by page_action
        company_data = action_result.get("company_data", {})
        company_url = action_result.get("company_url", CRUNCHBASE_URL)
        autocomplete_items = action_result.get("autocomplete_items", [])

        log_step("Extraction complete.", {
            "company_name": company_data.get("name"),
            "company_url": company_url,
        })

        if keep_browser_open_ms > 0:
            log_step("Keeping browser open for inspection.", {"keep_browser_open_ms": keep_browser_open_ms})
            await asyncio.sleep(keep_browser_open_ms / 1000)

        return {
            "ok": True,
            "url": company_url,
            "query": query,
            "engine": "scrapling-python",
            "autocomplete_items": autocomplete_items,
            "company": company_data,
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
