import crawlBtmhSite from "../sites/btmh-site.js";
import crawlDojiSite from "../sites/doji-site.js";
import crawlSjcSite from "../sites/sjc-site.js";

export const siteRegistry = [
  {
    key: "baotinmanhhai.vn",
    description: "Lay lich su gia vang Bao Tin Manh Hai tu API chart.",
    crawl: crawlBtmhSite
  },
  {
    key: "doji.vn",
    description: "Lay bang gia vang DOJI tu bang gia theo khu vuc.",
    crawl: crawlDojiSite
  },
  {
    key: "sjc.com.vn",
    description: "Lay bang gia vang SJC theo chi nhanh va loai vang.",
    crawl: crawlSjcSite
  }
];
