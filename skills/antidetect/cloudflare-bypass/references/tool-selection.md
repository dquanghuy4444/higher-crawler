# Anti-Detect Tool Selection

Use this reference when selecting free or open-source packages for authorized crawler work.

## Browser Automation

- **Scrapling**: Python, Patchright/Playwright-style APIs, useful when `AsyncStealthySession` and Cloudflare handling fit the target. Good for JS-heavy sites with a clean callback flow.
- **Botasaurus**: Python, convenient browser decorator and driver API. Good when a synchronous crawler and profile persistence are enough.
- **Camoufox**: Python, anti-detect Firefox. Good alternative when Chromium-based engines are flagged.
- **NoDriver**: Python, Chrome CDP automation without traditional chromedriver. Prefer over outdated `undetected-chromedriver` for new work.
- **Selenium-Driverless**: Python, Selenium-like automation without a classic driver binary.
- **Invisible-Playwright**: Patched browser approach for Playwright-style work; check platform/setup cost before adopting.

## Android / Mobile

- **Damru**: Android-native automation through Redroid, Playwright, and CDP. Use only on Linux/Ubuntu or WSL2 with Docker, ADB, binderfs, and Redroid support. Native macOS is not a viable Redroid host.
- **ADBLogin**: Android/ADB-oriented anti-detect browser. Evaluate maintenance and automation API fit before integrating.

## HTTP / TLS Clients

- **curl_cffi**: Python wrapper around curl-impersonate. Use for API/HTML endpoints where TLS and header fidelity matter and full browser DOM is unnecessary.
- **curl-impersonate**: CLI/libcurl browser TLS impersonation. Useful for reproducing HTTP-layer behavior outside browser automation.
- **CycleTLS**: Node/Go TLS fingerprint control for request-based scraping.
- **Got-Scraping**: Node HTTP client tuned for scraping.

## Human Interaction Helpers

- **Ghost-Cursor**: Human-like cursor paths for Puppeteer.
- **HumanCursor**: Python cursor movement helper.
- **PyAutoGUI**: OS-level keyboard/mouse automation. Use sparingly for visible browser workflows where DOM APIs are detected or insufficient.

## Detection Tests

Use these only as diagnostics, not as a promise of success:

- CreepJS
- Pixelscan
- BrowserLeaks
- Sannysoft
- AmIUnique
- Cover Your Tracks
- Rebrowser Bot Detector
- Brotector
- `https://tls.peet.ws/api/all` for TLS/JA3 inspection

## Selection Rules

1. Use the simplest engine that already works in the repo.
2. Match engine to platform. Do not choose Damru for native macOS.
3. Use request/TLS clients only when JavaScript and DOM interaction are not required.
4. Prefer persistent profiles and manual clearance over automated captcha solving.
5. Keep proxy, timezone, locale, user agent, and device class coherent.
