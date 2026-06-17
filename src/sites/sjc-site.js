import createAxiosInstance from "../lib/create-axios-instance.js";

const sjcInstance = createAxiosInstance("https://sjc.com.vn");

export default async function crawlSjcSite() {
  let response;

  try {
    response = await sjcInstance.post("/GoldPrice/Services/PriceService.ashx");
  } catch (error) {
    throw new Error(
      "SJC crawler is currently blocked by Cloudflare protection. You may need a browser-based crawler, proxy, or valid session cookies to fetch this source."
    );
  }

  const payload = response?.data;
  if (!payload?.success) {
    throw new Error("SJC API returned an unsuccessful response.");
  }

  const items = Array.isArray(payload.data) ? payload.data : [];
  const datetime = payload.currentDate ?? payload.latestDate ?? null;

  return items.map((item) => ({
    key: `${item.BranchName} - ${item.TypeName}`,
    buy_price: item.BuyValue / 10_000,
    sell_price: item.SellValue / 10_000,
    datetime
  }));
}
