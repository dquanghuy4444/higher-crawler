import * as cheerio from "cheerio";

import createAxiosInstance from "../../lib/create-axios-instance.js";

const dojiInstance = createAxiosInstance("http://giavang.doji.vn");

export default async function crawlDojiSite() {
  let responseDatetime;
  let responsePrices;

  try {
    responseDatetime = await dojiInstance.get("/");
    responsePrices = await dojiInstance.get("/sites/default/files/data/hienthi/vungmien_1.dat");
  } catch (error) {
    throw new Error("DOJI crawler could not fetch source data.");
  }

  const datetimePage = cheerio.load(responseDatetime.data);
  const updateTime = datetimePage(".update-time")
    .text()
    .replace("Cập nhập lúc: ", "")
    .trim();

  const $ = cheerio.load(responsePrices.data);
  const result = [];

  $("table.goldprice-view tbody tr").each((_, row) => {
    const cells = $(row).find("td");

    if (cells.length === 3) {
      result.push({
        key: $(cells[0]).text().trim(),
        buy_price: Number.parseFloat($(cells[1]).text().trim().replaceAll(",", "")),
        sell_price: Number.parseFloat($(cells[2]).text().trim().replaceAll(",", "")),
        datetime: updateTime || null
      });
    }
  });

  return result;
}
