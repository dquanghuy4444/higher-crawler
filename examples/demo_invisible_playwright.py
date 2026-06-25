"""
Demo: invisible_playwright - Drop-in replacement của Playwright.
Patch Firefox ở C++ level → không detect được qua JS (Canvas, WebGL, Audio, Fonts...).
Phù hợp cho: sites có CreepJS, FingerprintJS Pro, DataDome, Kasada.

Install:
    pip install git+https://github.com/feder-cr/invisible_playwright.git
    python -m invisible_playwright fetch   # tải Firefox đã patch (~100MB, 1 lần)

Yêu cầu: Python 3.10+, platform: Windows x64 / Linux x64/arm64 / macOS arm64/x64
"""

import asyncio
from invisible_playwright.async_api import InvisiblePlaywright
from bs4 import BeautifulSoup


TARGET_URL = "https://quotes.toscrape.com"


def parse_quotes(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for q in soup.select(".quote"):
        results.append({
            "text": q.select_one(".text").get_text(strip=True),
            "author": q.select_one(".author").get_text(strip=True),
            "tags": [t.get_text(strip=True) for t in q.select(".tag")],
        })
    return results


async def crawl():
    # Mỗi session = fingerprint ngẫu nhiên khác nhau (GPU, audio, canvas, fonts...)
    # Dùng seed=42 để có fingerprint cố định giữa các lần chạy
    async with InvisiblePlaywright(seed=42) as browser:
        print(f"Browser seed: {browser.seed if hasattr(browser, 'seed') else 'random'}")

        page = await browser.new_page()
        all_quotes = []
        page_num = 1

        while True:
            url = TARGET_URL if page_num == 1 else f"{TARGET_URL}/page/{page_num}/"
            print(f"Fetching page {page_num}: {url}")

            await page.goto(url, wait_until="domcontentloaded")

            html = await page.content()
            quotes = parse_quotes(html)

            if not quotes:
                break

            all_quotes.extend(quotes)
            print(f"  → {len(quotes)} quotes found")

            # Kiểm tra nút Next
            next_btn = page.locator(".next a")
            if await next_btn.count() == 0:
                break
            page_num += 1

        await page.close()

    print(f"\nTotal: {len(all_quotes)} quotes")
    for q in all_quotes[:3]:
        print(f'  "{q["text"][:60]}..." — {q["author"]}')

    return all_quotes


if __name__ == "__main__":
    asyncio.run(crawl())
