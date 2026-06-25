"""
Demo: nodriver - Successor của undetected-chromedriver.
Dùng Chrome thật, control qua CDP không qua WebDriver protocol.
Phù hợp cho: sites cần JS render, login, click, Cloudflare challenge.

Install: pip install nodriver
Yêu cầu: Google Chrome đã cài sẵn trên máy.
"""

import nodriver as uc


TARGET_URL = "https://quotes.toscrape.com"


async def crawl():
    # Khởi động Chrome (tự tìm Chrome executable)
    driver = await uc.start()

    all_quotes = []
    page = 1

    try:
        while True:
            url = TARGET_URL if page == 1 else f"{TARGET_URL}/page/{page}/"
            print(f"Fetching page {page}: {url}")

            tab = await driver.get(url)

            # Chờ quotes load
            await tab.sleep(1)

            # Lấy tất cả quote elements
            quote_nodes = await tab.select_all(".quote")
            if not quote_nodes:
                break

            print(f"  → {len(quote_nodes)} quotes found")

            for node in quote_nodes:
                text_el = await node.query_selector(".text")
                author_el = await node.query_selector(".author")
                tag_els = await node.query_selector_all(".tag")

                text = await text_el.get_js_attributes("innerText") if text_el else ""
                author = await author_el.get_js_attributes("innerText") if author_el else ""
                tags = []
                for t in tag_els:
                    tag_text = await t.get_js_attributes("innerText")
                    if tag_text:
                        tags.append(tag_text.strip())

                all_quotes.append({
                    "text": text.strip() if text else "",
                    "author": author.strip() if author else "",
                    "tags": tags,
                })

            # Kiểm tra nút Next
            next_btn = await tab.select(".next a")
            if not next_btn:
                break
            page += 1

    finally:
        driver.stop()

    print(f"\nTotal: {len(all_quotes)} quotes")
    for q in all_quotes[:3]:
        print(f'  "{q["text"][:60]}..." — {q["author"]}')

    return all_quotes


if __name__ == "__main__":
    uc.loop().run_until_complete(crawl())
