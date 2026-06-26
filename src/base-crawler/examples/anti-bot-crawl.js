import {
  Crawler,
  MemoryQueue,
  MemoryDedup,
  SelectorEngine,
  HttpFetcher,
  PlaywrightFetcher,
  PuppeteerFetcher,
  ConsoleStore,
  ConsoleMetrics
} from "../index.js";
import { createLogger } from "../utils/logger.js";

/**
 * Demo anti-bot:
 * 1. Thử HTTP fetcher (curl_cffi/axios)
 * 2. Nếu bị 403/429/Cloudflare → escalate sang Playwright
 * 3. Nếu Playwright vẫn fail → thử Puppeteer
 *
 * Yêu cầu: Chrome đã cài trên máy, hoặc set CHROME_EXECUTABLE.
 */

const logger = createLogger({ level: "info", prettyPrint: true });
const metrics = new ConsoleMetrics(logger);

const selectorEngine = new SelectorEngine({
  defaultSchema: {
    fields: {
      title: {
        selectors: ["h1", "title", "[itemprop='name']"],
        extract: "text",
        validate: "required"
      },
      price: {
        selectors: [".price", "[itemprop='price']", ".current-price"],
        extract: "text",
        pattern: { regex: "\\$[0-9,.]+", group: 0 },
        default: null
      }
    }
  }
});

// Đăng ký tất cả fetcher
const httpFetcher = new HttpFetcher({ impersonate: "chrome" });
const playwrightFetcher = new PlaywrightFetcher({ headless: true });
const puppeteerFetcher = new PuppeteerFetcher({ headless: true });

const antiBot = new (await import("../anti-bot/AntiBotHandler.js")).AntiBotHandler({
  defaultStrategy: "http",
  metrics,
  logger
});
antiBot.registerFetcher("http", httpFetcher);
antiBot.registerFetcher("playwright", playwrightFetcher);
antiBot.registerFetcher("puppeteer", puppeteerFetcher);

const crawler = new Crawler({
  id: "anti-bot-demo",
  queue: new MemoryQueue(),
  rateLimiter: {
    async acquire() {},
    async close() {}
  },
  dedup: new MemoryDedup(),
  fetcher: antiBot,
  selectorEngine,
  store: new ConsoleStore(),
  metrics,
  logger,
  concurrency: 1, // Browser nên chạy thấp concurrency
  config: {
    domains: {
      "quotes.toscrape.com": {
        rate: { rate: 1, interval: 2000 },
        strategy: "http" // sẽ tự escalate nếu cần
      }
    }
  }
});

async function main() {
  // Demo với site đơn giản
  await crawler.schedule("https://quotes.toscrape.com/", { priority: 10 });

  const stopTimer = setTimeout(async () => {
    await crawler.stop();
    await antiBot.close();
    logger.info("Crawler stopped");
  }, 30_000);

  await crawler.start();
  clearTimeout(stopTimer);
  logger.info({ metrics: Object.fromEntries(metrics.counts) }, "Final metrics");
}

main().catch(async (error) => {
  logger.error(error, "Fatal error");
  await antiBot.close();
  process.exit(1);
});
