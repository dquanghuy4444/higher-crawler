import {
  Crawler,
  MemoryQueue,
  MemoryDedup,
  SelectorEngine,
  HttpFetcher,
  ConsoleStore,
  ConsoleMetrics
} from "../index.js";
import { createLogger } from "../utils/logger.js";

// In-memory demo — không cần Redis, phù hợp test nhanh

const logger = createLogger({ level: "info", prettyPrint: true });
const metrics = new ConsoleMetrics(logger);

const selectorEngine = new SelectorEngine({
  defaultSchema: {
    fields: {
      title: {
        selectors: ["h1", "title", ".product-title", "[itemprop='name']"],
        extract: "text",
        validate: "required",
        default: null
      },
      price: {
        selectors: [".price", "[itemprop='price']", ".current-price"],
        extract: "text",
        pattern: { regex: "\\$[0-9,.]+", group: 0 },
        default: null
      },
      description: {
        selectors: ["meta[name='description']", "meta[property='og:description']"],
        extract: "attr(content)",
        default: null
      }
    }
  }
});

const fetcher = new HttpFetcher({ impersonate: "chrome" });

const antiBot = new (await import("../anti-bot/AntiBotHandler.js")).AntiBotHandler({
  defaultStrategy: "http",
  metrics,
  logger
});
antiBot.registerFetcher("http", fetcher);

const crawler = new Crawler({
  id: "demo-crawler",
  queue: new MemoryQueue(),
  rateLimiter: {
    async acquire() {}, // no-op for demo
    async close() {}
  },
  dedup: new MemoryDedup(),
  fetcher: antiBot,
  selectorEngine,
  store: new ConsoleStore(),
  metrics,
  logger,
  concurrency: 2,
  config: {
    domains: {
      "quotes.toscrape.com": {
        rate: { rate: 2, interval: 1000 }
      }
    }
  }
});

async function main() {
  await crawler.schedule("https://quotes.toscrape.com/", { priority: 10 });
  await crawler.schedule("https://quotes.toscrape.com/page/2/", { priority: 5 });
  await crawler.schedule("https://quotes.toscrape.com/page/3/", { priority: 5 });

  // Run for 10 seconds then stop
  const stopTimer = setTimeout(async () => {
    await crawler.stop();
    logger.info("Crawler stopped");
  }, 10_000);

  await crawler.start();
  clearTimeout(stopTimer);
  logger.info({ metrics: Object.fromEntries(metrics.counts) }, "Final metrics");
}

main().catch((error) => {
  logger.error(error, "Fatal error");
  process.exit(1);
});
