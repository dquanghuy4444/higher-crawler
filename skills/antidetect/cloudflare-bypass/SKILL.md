---
name: cloudflare-bypass
description: Build, diagnose, and harden authorized web crawlers that encounter Cloudflare, Turnstile, browser fingerprinting, TLS fingerprinting, or anti-bot challenges. Use when Codex is asked to create or modify crawler code, choose anti-detect browser packages, debug challenge pages, preserve browser sessions, compare Scrapling/Botasaurus/Camoufox/NoDriver/Damru/curl_cffi approaches, or produce safe test commands for owned or permitted targets.
---

# Cloudflare Bypass

## Operating Boundary

Use this skill only for authorized crawling, QA, monitoring, research, or user-owned targets. Prefer official APIs, allowlists, paid data access, robots/ToS compliance, and rate limits when available.

Do not help with credential abuse, account takeover, spam, phishing, payment abuse, malware delivery, or evading explicit access bans. Do not add captcha-farm solving or bypass code unless the user controls the target or has clear permission; prefer manual verification, durable sessions, and documented access paths.

## First Checks

1. Identify the target site, expected data, and whether the user has permission.
2. Reproduce the failure and capture the exact state:
   - HTTP status, final URL, title, visible body text
   - screenshot or HTML sample if available
   - cookies present, especially `cf_clearance`
   - whether challenge is Cloudflare interstitial, Turnstile widget, WAF block, login wall, or rate limit
3. Check environment fit before editing code:
   - macOS: prefer Scrapling, Botasaurus, Camoufox, NoDriver, Selenium-Driverless, or curl_cffi.
   - Linux/WSL2: Damru/Redroid may be possible.
   - CI/headless: prefer deterministic session reuse and visible debug mode first.

## Engine Selection

For JS-heavy sites with Cloudflare, try engines in this order unless the repo already has a proven pattern:

1. Existing repo engine and helpers.
2. Scrapling `AsyncStealthySession` when the site fits Playwright/Patchright flow and `solve_cloudflare=True` is useful.
3. Botasaurus when a synchronous Python driver and browser profile persistence are simpler.
4. Camoufox when Firefox anti-detect behavior works better or the repo already uses Camoufox.
5. NoDriver or Selenium-Driverless when Chrome CDP automation is preferred.
6. Damru only on Linux/WSL2 where Docker, ADB, binderfs, and Redroid can run.
7. curl_cffi/curl-impersonate for non-JS endpoints or APIs where TLS/header fidelity matters more than DOM automation.

Read `references/tool-selection.md` when choosing packages or when the user asks for free anti-detect options.

## Implementation Pattern

Keep crawler protocols clean:

- stdout: final machine-readable JSON only.
- stderr: structured logs and browser library noise.
- input: accept `headless`, `browser_visible`, `timeout_ms`, `profile_dir`, `proxy`, and debug options when relevant.
- output: include `ok`, `engine`, `url`, extracted data, and actionable errors.

Prefer these browser tactics:

- Use a persistent profile directory so successful manual verification can persist.
- Start visible first; add `keep_browser_open_ms` for inspection.
- Wait for real app selectors, not arbitrary sleeps alone.
- Capture challenge signals before retrying.
- Rate-limit retries and avoid tight loops.
- Preserve user-agent, locale, timezone, viewport, and proxy consistency within one profile.
- Do not mix datacenter proxy, mobile fingerprint, and desktop timezone unless intentionally testing.

## Cloudflare Handling

When a challenge appears:

1. Detect and log challenge type.
2. Wait for automatic clearance if the selected engine supports it.
3. If Turnstile/manual verification remains, keep browser visible and give enough time for manual solve.
4. After clearance, persist the profile and reuse it.
5. Retry the original user action only after the normal page/app selector is visible.

Use JS extraction only after navigation stabilizes. Avoid relying on hidden DOM or internal Cloudflare endpoints.

## Debug Checklist

If a crawler fails after an engine change:

- Confirm the Node/Python caller points to the intended script.
- Confirm the Python binary matches the environment where the package is installed.
- Run the Python crawler directly with a small JSON stdin payload.
- If stdout is empty, move top-level imports inside `main()`/`crawl()` so errors return JSON.
- If package setup is platform-specific, fail early with a clear message.
- Add `.gitignore` entries for `.venv*`, profiles, caches, and browser downloads.

## Test Commands

Prefer direct Python tests before API tests:

```bash
printf '%s' '{"query":"OpenAI","headless":true,"timeout_ms":30000}' \
  | .venv-damru/bin/python src/sites/h-tier/crunchbase/crunchbase_damru.py
```

Then test the API layer:

```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -d '{"site":"crunchbase.com","query":"OpenAI","timeout_ms":120000,"headless":true}'
```
