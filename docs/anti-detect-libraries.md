# Thư Viện Anti-Detect

Tài liệu này tóm tắt các thư viện/engine có thể dùng cho crawler anti-detect trong repo. Mục tiêu là phục vụ crawl/debug hợp lệ, phát hiện block/CAPTCHA và giảm fingerprint automation; không tự giải CAPTCHA nếu site yêu cầu xác minh người dùng.

## Nguyên Tắc Sử Dụng

| Nguyên tắc | Giải nghĩa |
|---|---|
| Ưu tiên API/HTML trước browser | Nếu site có API ẩn hoặc HTML tĩnh, dùng `axios`/Cheerio trước để nhẹ và ổn định hơn. |
| Chỉ dùng anti-detect cho H-tier | Browser anti-detect tốn tài nguyên, chậm, dễ phát sinh dependency. |
| Detect CAPTCHA, không auto-solve | Khi gặp Turnstile/reCAPTCHA/challenge, trả về `challenge_detected`/`captcha`, không gọi solver. |
| Persistent profile có kiểm soát | Session/cookie giúp ổn định, nhưng cần tách profile theo site và có cleanup. |
| Log đủ dấu vết | Luôn log URL, final URL, status, html length, cookie marker, detection status. |

## Thư Viện Đang Có Trong Repo

| Thư viện/engine | Vị trí trong repo | Dùng để làm gì | Điểm mạnh | Hạn chế |
|---|---|---|---|---|
| `axios` | `src/lib/create-axios-instance.js` | Fetch HTML/API tĩnh | Nhanh, nhẹ, dễ retry/rate limit | Fingerprint HTTP/TLS không stealth mạnh |
| `playwright-core` | `src/sites/m-tier/*` | Browser automation cho site render JS | API ổn định, thao tác DOM/network tốt | Browser fingerprint dễ bị detect nếu dùng thuần |
| `puppeteer-core` | dependency hiện có | Browser automation Chromium | Phổ biến, ecosystem lớn | Chưa được dùng nhiều trong repo |
| `Scrapling` / `StealthyFetcher` | `cloudflare_bypass.py`, `ytdown_crawler_scrapling.py`, `crunchbase_scrapling.py` | Stealth browser/fetcher cho site anti-bot | Patchright/stealth, humanize, proxy support | Python dependency, behavior tùy version |
| `Botasaurus` | `cloudflare_bypass.py`, `crunchbase_botasaurus.py` | Browser anti-detect + Cloudflare bypass mode | API crawl/browser tiện dụng | Nặng, dependency riêng, cần test mỗi site |
| `Camoufox` | `ytdown_crawler_camoufox.py` | Anti-detect Firefox + persistent context | Fingerprint profile tốt, có geoip/humanize | Cài đặt phức tạp hơn Playwright thuần |
| `SeleniumBase UC/CDP` | `cloudflare_bypass.py` | SeleniumBase mở UC browser, Playwright attach qua CDP | Kết hợp UC mode và Playwright API | Cần `seleniumbase`, browser/driver đúng version |

## Cách Chọn Engine

| Loại site | Engine nên dùng | Lý do |
|---|---|---|
| HTML tĩnh/API ẩn | `axios` + Cheerio | Rẻ, nhanh, dễ scale. |
| Render JS nhẹ | Playwright thuần | Cần DOM interaction nhưng anti-bot không mạnh. |
| JS + network capture | Playwright thuần | Bắt request/response, parse API sinh ra sau action. |
| Cloudflare/fingerprint trung bình | Scrapling | Stealth layer tốt hơn Playwright thuần. |
| Cloudflare/fingerprint mạnh | Camoufox hoặc SeleniumBase CDP | Persistent profile/fingerprint tốt hơn. |
| Cần debug nhiều detector | `cloudflare-bypass` endpoint | Chạy nhiều test như fingerprint, sannysoft, pixelscan. |

## Mapping Với Tier

| Tier | Mô tả | Engine gợi ý |
|---|---|---|
| S-tier | Site dễ, HTML/API lấy được bằng request | `axios`, Cheerio, JSON/API hidden. |
| M-tier | Cần browser/action, nhưng anti-bot vừa phải | Playwright thuần, network capture. |
| H-tier | Anti-bot/fingerprint/Cloudflare mạnh | Scrapling, Botasaurus, Camoufox, SeleniumBase CDP. |

## Chi Tiết Engine

### Axios

Đang dùng trong `createAxiosInstance`:

- Timeout mặc định.
- Header merge theo site.
- User-Agent rotation cơ bản.
- Block detection từ status/body.
- Structured fetch log.

Phù hợp:

- Bảng giá, API hidden, JSON endpoint.
- Product/article page HTML tĩnh.

Không phù hợp:

- Site yêu cầu JS render.
- Site check TLS/browser fingerprint nặng.

### Playwright

Đang dùng trong các M-tier crawler:

- Mở Chrome local.
- Fill input/click button.
- Wait DOM selector.
- Bắt request/response để lấy download/API URL.

Phù hợp:

- Site render JS.
- Site cần thao tác form.
- Site cần network interception.

Cần lưu ý:

- Nên set `locale`, `timezoneId`, `viewport`, `userAgent`.
- Nên limit concurrency = 1/site.
- Nên đóng context/browser trong `finally`.

### Scrapling

Đang dùng trong Python crawler:

- `StealthyFetcher`.
- `humanize`.
- `network_idle`.
- `page_action`.
- Proxy support.

Phù hợp:

- Site fingerprint automation cơ bản/trung bình.
- Cần stealth browser nhưng vẫn muốn API fetcher gọn.

Cần lưu ý:

- Không bật auto-solve CAPTCHA nếu policy chỉ detect/report.
- Cần handle dependency missing rõ ràng.

### Botasaurus

Đang dùng trong Cloudflare probe:

- `Driver`.
- `google_get`.
- `bypass_cloudflare=True` khi method support.
- Profile support.

Phù hợp:

- Test nhanh site có Cloudflare/challenge.
- Debug anti-detect với browser layer riêng.

Cần lưu ý:

- Có thể in log/output nhiều; stdout của Python runner phải giữ JSON sạch.
- Chạy sync, nếu bọc trong async thì nên dùng thread khi cần.

### Camoufox

Đang dùng cho YTDown:

- `AsyncCamoufox`.
- `persistent_context`.
- `user_data_dir`.
- `humanize`.
- `geoip`.
- Lưu fingerprint/profile.

Phù hợp:

- H-tier site cần browser fingerprint ổn định.
- Cần profile dài hạn với cookie/localStorage.

Cần lưu ý:

- Profile nên tách theo site.
- Không auto-solve CAPTCHA; detect challenge và trả lời rõ.

### SeleniumBase UC/CDP

Đang thêm vào `cloudflare_bypass.py` với method `seleniumbase-cdp`.

Flow:

1. SeleniumBase `SB(uc=True)` mở UC browser.
2. `activate_cdp_mode()`.
3. Lấy `endpoint_url`.
4. Playwright `chromium.connect_over_cdp(endpoint_url)`.
5. Dùng Playwright API để goto/evaluate/cookies.

Phù hợp:

- Cần dùng UC mode nhưng vẫn muốn Playwright API.
- Debug detector như Fingerprint playground.

Cần lưu ý:

- Cần cài:

```bash
python -m pip install seleniumbase playwright
```

- SeleniumBase có thể download driver lần đầu và tạo `downloaded_files/`.
- Nếu gọi trong async Python, chạy sync part bằng `asyncio.to_thread`.
- Redirect stdout sang stderr để Node runner parse JSON không lỗi.

## Config Gợi Ý

Ví dụ site H-tier:

```js
export default {
  key: "example.com",
  description: "Crawl example anti-bot site.",
  crawler: {
    mode: "browser",
    session: { persistent: true },
    tlsFingerprint: "seleniumbase-cdp",
    rateLimit: { concurrency: 1, delayMs: 5000 },
    retry: { maxAttempts: 1 }
  },
  crawl: crawlExampleSite
};
```

## Endpoint Debug Hiện Có

Lấy danh sách detector:

```bash
curl -s http://localhost:3000/api/cloudflare-bypass/tests | jq
```

Chạy SeleniumBase CDP với Fingerprint playground:

```bash
curl -s -X POST http://localhost:3000/api/cloudflare-bypass \
  -H "Content-Type: application/json" \
  -d '{
    "tests": ["fingerprint"],
    "methods": ["seleniumbase-cdp"],
    "timeout_ms": 45000,
    "headless": false,
    "keep_browser_open_ms": 3000
  }' | jq
```

Chạy Scrapling:

```bash
curl -s -X POST http://localhost:3000/api/cloudflare-bypass \
  -H "Content-Type: application/json" \
  -d '{
    "tests": ["fingerprint"],
    "methods": ["scrapling"],
    "timeout_ms": 45000,
    "headless": true
  }' | jq
```

## Checklist Khi Thêm Anti-Detect Engine Mới

| Việc cần làm | Giải nghĩa |
|---|---|
| Không làm bẩn stdout | Python child process stdout phải chỉ in JSON result. Log/warning đưa sang stderr. |
| Có dependency error rõ ràng | Nếu thiếu package/browser/driver, trả message cài đặt. |
| Có timeout | Mỗi navigation/wait phải có timeout từ input. |
| Có headless/browser_visible | Cho phép debug visible browser. |
| Có proxy option | Nếu engine support, truyền proxy từ input. |
| Có profile dir | H-tier nên có profile riêng để giữ session. |
| Có challenge detection | Trả `challenge_detected`, `captcha`, `bot_detected`, `clean`, hoặc `unknown`. |
| Không auto-solve CAPTCHA | Chỉ detect/report. |
| Có cleanup | Đóng browser/context nếu có lỗi. |
| Có test curl | Thêm ví dụ vào `curl-examples.md`. |

## Các Lỗi Thường Gặp

| Lỗi | Nguyên nhân | Cách xử lý |
|---|---|---|
| `Failed to parse Python output` | Thư viện in warning ra stdout | Redirect stdout sang stderr hoặc Node parse JSON line cuối. |
| `Cannot run the event loop while another loop is running` | Gọi sync engine trong async loop | Bọc bằng `asyncio.to_thread`. |
| `driver not found` | UC/SeleniumBase chưa tải driver | Cho phép download lần đầu, ignore `downloaded_files/`. |
| `bot_detected` | Detector vẫn nhận ra automation | Thử engine khác, persistent profile, visible mode, proxy tốt hơn. |
| `challenge_detected` | Site yêu cầu verify/CAPTCHA | Bảo vệ status, không tự solve. |
