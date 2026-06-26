import {
  Crawler,
  MemoryQueue,
  MemoryDedup,
  SelectorEngine,
  HttpFetcher,
  PlaywrightFetcher,
  PuppeteerFetcher,
  ConsoleStore,
  ConsoleMetrics,
  StaticProxyRotator,
  AntiBotHandler
} from "../index.js";
import { createLogger } from "../utils/logger.js";

/**
 * Demo proxy rotation + anti-bot escalation.
 * Mỗi request dùng proxy khác nhau từ danh sách.
 * Nếu proxy fail → report failure + rotate.
 * Nếu HTTP bị detect → escalate sang Playwright/Puppeteer.
 */

const logger = createLogger({ level: "info", prettyPrint: true });
const metrics = new ConsoleMetrics(logger);

const proxyRotator = new StaticProxyRotator({
  proxies: [
    // Thay bằng proxy thật của bạn
    // "http://user:pass@proxy1:8080",
    // "http://user:pass@proxy2:8080",
    // "socks5://user:pass@proxy3:1080"
  ],
  mode: "round_robin", // round_robin | random | sticky
  maxFailures: 3
});

const selectorEngine = new SelectorEngine({
  defaultSchema: {
    fields: {
      title: {
        selectors: ["h1", "title"],
        extract: "text",
        validate: "required"
      }
    }
  }
});

const httpFetcher = new HttpFetcher({
  impersonate: "chrome",
  proxyRotator
});

const playwrightFetcher = new PlaywrightFetcher({
  headless: true,
  proxyRotator
});

const puppeteerFetcher = new PuppeteerFetcher({
  headless: true,
  proxyRotator
});

const antiBot = new AntiBotHandler({
  defaultStrategy: "http",
  proxyRotator,
  metrics,
  logger
});
antiBot.registerFetcher("http", httpFetcher);
antiBot.registerFetcher("playwright", playwrightFetcher);
antiBot.registerFetcher("puppeteer", puppeteerFetcher);

const crawler = new Crawler({
  id: "proxy-demo",
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
  concurrency: 1,
  config: {
    domains: {
      "quotes.toscrape.com": {
        strategy: "http",
        rate: { rate: 1, interval: 2000 }
      }
    }
  }
});

async function main() {
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
