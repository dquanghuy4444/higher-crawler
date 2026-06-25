# Antidetect Demo Examples

Cả 3 script đều crawl `quotes.toscrape.com` để so sánh API dễ nhất.

## So sánh nhanh

| | `curl_cffi` | `nodriver` | `invisible_playwright` |
|---|---|---|---|
| **Cách hoạt động** | Giả lập TLS/JA3/HTTP2 fingerprint | Chrome thật qua CDP | Firefox patch C++ level |
| **Cần browser** | ❌ | ✅ Chrome | ✅ Firefox tải về (~100MB) |
| **JS render** | ❌ | ✅ | ✅ |
| **Tốc độ** | ⚡ Nhanh nhất | 🐢 Chậm nhất | 🔶 Trung bình |
| **Bypass TLS detect** | ✅ | ✅ | ✅ |
| **Bypass JS fingerprint** | ❌ | Một phần | ✅ Tốt nhất |
| **Phù hợp** | Cloudflare bot mgmt, Akamai | Cloudflare JS challenge, login flow | CreepJS, DataDome, Kasada |

## Install

```bash
# curl_cffi
pip install curl_cffi beautifulsoup4

# nodriver (cần Chrome đã cài)
pip install nodriver beautifulsoup4

# invisible_playwright
pip install git+https://github.com/feder-cr/invisible_playwright.git beautifulsoup4
python -m invisible_playwright fetch   # tải Firefox đã patch, chỉ 1 lần
```

## Chạy

```bash
python examples/demo_curl_cffi.py
python examples/demo_nodriver.py
python examples/demo_invisible_playwright.py
```

## Khi nào dùng cái nào?

1. **curl_cffi** → Thử trước. Nếu site chỉ check TLS fingerprint (phần lớn Cloudflare) thì đây là lựa chọn tối ưu — không cần browser, cực nhanh.

2. **nodriver** → Site cần JS render, cần click, có Cloudflare Turnstile/challenge page. Dùng Chrome thật nên ít bị detect hơn Selenium/Playwright Chromium.

3. **invisible_playwright** → Site cực kỳ khó — có CreepJS, FingerprintJS Pro v4+, DataDome. Patch ở C++ level nên không có JS shim nào để detect.
