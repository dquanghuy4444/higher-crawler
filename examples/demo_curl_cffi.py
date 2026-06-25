"""
Demo: curl_cffi - HTTP client giả lập TLS/JA3/HTTP2 fingerprint của browser thật.
Không cần mở browser, nhanh nhất trong 3 cách.
Phù hợp cho: sites chặn theo TLS fingerprint (Cloudflare, Akamai, PerimeterX).

Install: pip install curl_cffi
"""

import asyncio
from curl_cffi import AsyncSession
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
    # impersonate="chrome" → TLS/JA3/HTTP2 fingerprint giống Chrome mới nhất
    async with AsyncSession(impersonate="chrome") as s:
        all_quotes = []
        page = 1

        while True:
            url = TARGET_URL if page == 1 else f"{TARGET_URL}/page/{page}/"
            print(f"Fetching page {page}: {url}")

            r = await s.get(url)
            r.raise_for_status()

            quotes = parse_quotes(r.text)
            if not quotes:
                break

            all_quotes.extend(quotes)
            print(f"  → {len(quotes)} quotes found")

            # Check next page
            soup = BeautifulSoup(r.text, "html.parser")
            if not soup.select_one(".next"):
                break
            page += 1

        print(f"\nTotal: {len(all_quotes)} quotes")
        for q in all_quotes[:3]:
            print(f'  "{q["text"][:60]}..." — {q["author"]}')

        return all_quotes


if __name__ == "__main__":
    asyncio.run(crawl())
