import crawlBtmhSite from "../sites/s-tier/btmh-site.js";
import crawlDantriSite from "../sites/s-tier/dantri-site.js";
import crawlDojiSite from "../sites/s-tier/doji-site.js";
import crawlFvidgoSite from "../sites/m-tier/fvidgo-site.js";
import crawlHorizontJobsSite from "../sites/s-tier/horizont-jobs-site.js";
import crawlLazadaSite from "../sites/s-tier/lazada-site.js";
import crawlSjcSite from "../sites/s-tier/sjc-site.js";
import crawlVibloSite from "../sites/s-tier/viblo-site.js";
import crawlYoutubeThumbnailGrabberSite from "../sites/m-tier/youtube-thumbnail-grabber-site.js";
import crawlYtdownSite from "../sites/h-tier/ytdown/ytdown-site.js";
import crawlCloudflareBypassSite from "../sites/h-tier/cloudflare-bypass/cloudflare-bypass-site.js";
import crawlCrunchbaseSite from "../sites/h-tier/crunchbase/crunchbase-site.js";
import crawlAsusSite from "../sites/h-tier/asus/asus-site.js";
import crawlExtracomputerSite from "../sites/h-tier/extracomputer/extracomputer-site.js";
import crawlLittlebitSite from "../sites/h-tier/littlebit/littlebit-site.js";

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
    key: "dantri.com.vn",
    description: "Lay thong tin quan trong cua bai viet Dantri tu URL bai bao.",
    crawl: crawlDantriSite
  },
  {
    key: "horizont.jobs",
    description: "Lay thong tin job posting tu URL tren Horizont Jobs.",
    crawl: crawlHorizontJobsSite
  },
  {
    key: "lazada.vn",
    description: "Lay thong tin san pham Lazada tu URL san pham.",
    crawl: crawlLazadaSite
  },
  {
    key: "sjc.com.vn",
    description: "Lay bang gia vang SJC theo chi nhanh va loai vang.",
    crawl: crawlSjcSite
  },
  {
    key: "viblo.asia",
    description: "Lay thong tin quan trong cua bai viet Viblo tu URL bai post.",
    crawl: crawlVibloSite
  },
  {
    key: "fvidgo.com",
    description: "Dung browser bot de nhap link Facebook Reel va bat link download video.",
    crawl: crawlFvidgoSite
  },
  {
    key: "youtube-thumbnail-grabber.com",
    description: "Dung browser bot de nhap link YouTube va lay cac thumbnail.",
    crawl: crawlYoutubeThumbnailGrabberSite
  },
  {
    key: "app.ytdown.to",
    description: "Dung persistent browser profile de nhap link YouTube va lay link download.",
    crawl: crawlYtdownSite
  },
  {
    key: "cloudflare-bypass",
    description: "Mo URL bang engine anti-detect duoc chon de debug Cloudflare clearance.",
    crawl: crawlCloudflareBypassSite
  },
  {
    key: "crunchbase.com",
    description: "Tim kiem va lay thong tin cong ty tu Crunchbase bang ten cong ty.",
    crawl: crawlCrunchbaseSite
  },
  {
    key: "asus.com",
    description: "Lay thong tin san pham ASUS tu URL san pham.",
    crawl: crawlAsusSite
  },
  {
    key: "extracomputer.de",
    description: "Lay thong tin san pham EXTRA Computer tu URL san pham.",
    crawl: crawlExtracomputerSite
  },
  {
    key: "littlebit.de",
    description: "Lay thong tin san pham Littlebit tu URL san pham.",
    crawl: crawlLittlebitSite
  }
];
