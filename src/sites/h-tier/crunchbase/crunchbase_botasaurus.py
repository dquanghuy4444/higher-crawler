"""
Crunchbase Crawler using Botasaurus.

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

import contextlib
import json
import re
import sys
import time
from pathlib import Path

from botasaurus.browser import Driver, browser


CRUNCHBASE_URL = "https://www.crunchbase.com/"
DEFAULT_PROFILE_DIR = str(Path.cwd() / ".browser-profiles" / "crunchbase-botasaurus")


def log_info(message, details=None):
    entry = {"level": "info", "source": "crunchbase-botasaurus", "message": message}
    if details:
        entry["details"] = details
    print(json.dumps(entry), file=sys.stderr)


def log_warn(message, details=None):
    entry = {"level": "warn", "source": "crunchbase-botasaurus", "message": message}
    if details:
        entry["details"] = details
    print(json.dumps(entry), file=sys.stderr)


def log_error(message, details=None):
    entry = {"level": "error", "source": "crunchbase-botasaurus", "message": message}
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


def sleep(seconds):
    time.sleep(seconds)


def wait_until(condition, timeout_ms, interval=0.5, timeout_message="Timed out waiting."):
    deadline = time.time() + timeout_ms / 1000
    last_error = None

    while time.time() < deadline:
        try:
            value = condition()
            if value:
                return value
        except Exception as e:
            last_error = e
        sleep(interval)

    if last_error:
        raise RuntimeError(f"{timeout_message} Last error: {last_error}")
    raise RuntimeError(timeout_message)


def safe_run_js(driver, script, args=None, default=None):
    try:
        if args is None:
            return driver.run_js(script)
        return driver.run_js(script, args)
    except Exception:
        return default


def is_visible(driver, selector):
    return bool(safe_run_js(driver, """
        const el = document.querySelector(args.selector);
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
            && style.visibility !== 'hidden'
            && rect.width > 0
            && rect.height > 0;
    """, {"selector": selector}, False))


def wait_for_visible(driver, selector, timeout_ms, message):
    return wait_until(
        lambda: is_visible(driver, selector),
        timeout_ms,
        timeout_message=message,
    )


def current_url(driver):
    return safe_run_js(driver, "return window.location.href", default=CRUNCHBASE_URL)


def type_like_human(driver, selector, value, delay=0.15):
    driver.click(selector)
    sleep(0.5)
    safe_run_js(driver, """
        const el = document.querySelector(args.selector);
        if (!el) return false;
        el.focus();
        el.value = '';
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    """, {"selector": selector}, False)
    sleep(0.3)

    try:
        driver.type(selector, value)
    except Exception:
        for char in value:
            safe_run_js(driver, """
                const el = document.querySelector(args.selector);
                if (!el) return false;
                el.focus();
                el.value += args.char;
                el.dispatchEvent(new InputEvent('input', {
                    bubbles: true,
                    data: args.char,
                    inputType: 'insertText'
                }));
                return true;
            """, {"selector": selector, "char": char}, False)
            sleep(delay)


def dismiss_human_verify(driver, label=""):
    verify_selector = "mat-dialog-container, .cdk-overlay-container .mat-mdc-dialog-surface"
    if not is_visible(driver, verify_selector):
        return False

    log_warn(f"[{label}] 'Please Verify You're a Human' dialog detected. Attempting to solve...")

    clicked = safe_run_js(driver, """
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
    """, default=None)

    if clicked:
        log_info(f"[{label}] Clicked verify control.", {"control": clicked})
        sleep(3)

    for i in range(60):
        if not is_visible(driver, verify_selector):
            log_info(f"[{label}] Verify dialog dismissed after {i}s.")
            return True
        if i % 10 == 0 and i > 0:
            log_info(f"[{label}] Still waiting for verify dialog to close... ({i}s)")
        sleep(1)

    log_warn(f"[{label}] Verify dialog did not close after 60s.")
    return False


def read_autocomplete_items(driver):
    return safe_run_js(driver, """
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
    """, default=[]) or []


def extract_company_data(driver):
    return safe_run_js(driver, """
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
    """, default={}) or {}


@browser(output=None, raise_exception=True, close_on_crash=True)
def crunchbase_botasaurus_task(driver: Driver, data):
    query = data["query"]
    timeout_ms = data["timeout_ms"]
    keep_browser_open_ms = data["keep_browser_open_ms"]

    step = 0

    def log_step(message, details=None):
        nonlocal step
        step += 1
        log_info(f"Step {step}: {message}", details)

    log_step("Navigating to Crunchbase.", {"url": CRUNCHBASE_URL})
    try:
        driver.google_get(CRUNCHBASE_URL, bypass_cloudflare=True)
    except TypeError:
        driver.google_get(CRUNCHBASE_URL)
    except Exception as e:
        log_warn("google_get failed, falling back to direct get.", {"error": str(e)})
        driver.get(CRUNCHBASE_URL)

    log_step("Checking for human verification dialog.")
    dismiss_human_verify(driver, "initial")

    log_step("Waiting for search input.")
    search_selector = "textarea#chat-input"
    wait_for_visible(
        driver,
        search_selector,
        timeout_ms,
        "Crunchbase search input was not found within timeout.",
    )

    log_step("Typing search query.", {"query": query})
    type_like_human(driver, search_selector, query, delay=0.15)
    sleep(2)

    dismiss_human_verify(driver, "after-type")

    log_step("Waiting for autocomplete results.")
    company_option_selector = "mat-option.organizations.result-option"
    try:
        wait_for_visible(
            driver,
            company_option_selector,
            20000,
            f"No autocomplete results found for '{query}'.",
        )
    except RuntimeError:
        dismissed = dismiss_human_verify(driver, "retry-verify")
        if dismissed:
            log_info("Re-typing query after verification...")
        else:
            log_warn("Autocomplete not visible, retrying search...")

        type_like_human(driver, search_selector, query, delay=0.2)
        sleep(3)
        wait_for_visible(
            driver,
            company_option_selector,
            20000,
            f"No autocomplete results found for '{query}'.",
        )

    sleep(1)

    autocomplete_items = read_autocomplete_items(driver)
    log_info("Autocomplete results.", {"count": len(autocomplete_items), "items": autocomplete_items[:5]})
    if not autocomplete_items:
        raise RuntimeError(f"No company results found for '{query}'.")

    log_step("Clicking first company result.", {"company": autocomplete_items[0].get("name", "")})
    driver.click(company_option_selector)

    log_step("Waiting for company page to load.")
    try:
        wait_until(
            lambda: re.search(r"/organization/", current_url(driver)),
            timeout_ms,
            timeout_message="URL did not change to /organization/ pattern.",
        )
    except RuntimeError:
        log_warn("URL did not change to /organization/ pattern.")

    sleep(5)

    log_step("Extracting company data.")
    company_url = current_url(driver)
    company_data = extract_company_data(driver)

    log_step("Extraction complete.", {
        "company_name": company_data.get("name"),
        "company_url": company_url,
    })

    if keep_browser_open_ms > 0:
        log_step("Keeping browser open for inspection.", {"keep_browser_open_ms": keep_browser_open_ms})
        sleep(keep_browser_open_ms / 1000)

    return {
        "ok": True,
        "url": company_url,
        "query": query,
        "engine": "botasaurus-python",
        "autocomplete_items": autocomplete_items,
        "company": company_data,
    }


def crawl(input_data):
    params = parse_input(input_data)
    profile_dir = params["profile_dir"]
    browser_visible = params["browser_visible"]

    log_info("Starting Crunchbase crawler.", {
        "query": params["query"],
        "profile_dir": profile_dir,
        "timeout_ms": params["timeout_ms"],
        "browser_visible": browser_visible,
    })

    Path(profile_dir).mkdir(parents=True, exist_ok=True)

    with contextlib.redirect_stdout(sys.stderr):
        return crunchbase_botasaurus_task(
            params,
            headless=not browser_visible,
            profile=profile_dir,
        )


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
