import https from "node:https";
import * as cheerio from "cheerio";

import createAxiosInstance from "../lib/create-axios-instance.js";

const btmhInstance = createAxiosInstance("https://baotinmanhhai.vn", {
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  })
});

const titleToKeyMap = new Map([
  ["Nhẫn Tròn ép vỉ (Kim Gia Bảo ) 24K (999.9)", "btmh_nhan_ep_vi_kim_gia_bao"],
  ["Vàng Tiểu Kim Cát 24K (999.9) 0,1chỉ", "btmh_tieu_kim_cat_0_1chi"],
  ["Vàng trang sức 24K (999.9)", "btmh_vang_nu_trang_9999"],
  ["Vàng trang sức 24K (99.9)", "btmh_vang_nu_trang_999"],
  ["Vàng miếng SJC (Cty CP BTMH)", "btmh_vang_mieng_sjc"]
]);

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function parseVietnameseNumber(value) {
  return Number.parseFloat(value.replaceAll(".", "").replaceAll(",", "."));
}

export default async function crawlBtmhSite() {
  let response;

  try {
    response = await btmhInstance.get("/vi/bang-gia-vang");
  } catch (error) {
    throw new Error("BTMH crawler could not fetch source page.");
  }

  const $ = cheerio.load(response.data);
  const pageText = normalizeText($("body").text());
  const datetimeMatch = pageText.match(/Cập nhật lúc ([^)]+)\)/);
  const datetime = datetimeMatch?.[1] ?? null;
  const result = [];

  $('div[class*="grid-cols-[minmax(200px,3fr)_1.5fr_1.5fr_1fr_1.5fr]"]').each((_, row) => {
    const title = normalizeText($(row).find("h3").first().text());
    const key = titleToKeyMap.get(title);

    if (!key) {
      return;
    }

    const priceTexts = $(row)
      .find("span")
      .map((__, span) => normalizeText($(span).text()))
      .get()
      .filter((text) => /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text));

    if (priceTexts.length < 2) {
      return;
    }

    const sellPrice = parseVietnameseNumber(priceTexts[0]);
    const buyPrice = parseVietnameseNumber(priceTexts[1]);

    result.push({
      key,
      buy_price: buyPrice,
      sell_price: sellPrice,
      datetime
    });
  });

  return result;
}
