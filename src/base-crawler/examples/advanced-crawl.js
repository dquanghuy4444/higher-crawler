import {
  Crawler,
  MemoryQueue,
  MemoryDedup,
  AutoHealingSelectorEngine,
  HttpFetcher,
  PlaywrightFetcher,
  PuppeteerFetcher,
  ConsoleStore,
  ConsoleMetrics,
  StaticProxyRotator,
  CaptchaAwareAntiBotHandler,
  TwoCaptchaSolver,
  CapSolverSolver,
  PostgresStore,
  PrometheusMetrics
} from "../index.js";
import { createLogger } from "../utils/logger.js";
import express from "express";

/**
 * Advanced demo: tất cả tính năng.
 * - Auto-healing selector
 * - Proxy rotation
 * - CAPTCHA solving (nếu có API key)
 * - Browser escalation
 * - Postgres store (nếu có DATABASE_URL)
 * - Prometheus metrics endpoint
 */

const logger = createLogger({ level: "info", prettyPrint: true });
const metrics = new PrometheusMetrics();

// Proxy rotator
const proxyRotator = new StaticProxyRotator({
  proxies: [
    // "http://user:pass@proxy1:8080",
    // "http://user:pass@proxy2:8080"
  ],
  mode: "round_robin",
  maxFailures: 3
});

// CAPTCHA solver (chỉ khởi tạo nếu có API key)
const captchaSolver = process.env.CAPSOLVER_API_KEY
  ? new CapSolverSolver({ apiKey: process.env.CAPSOLVER_API_KEY })
  : process.env.TWOCAPTCHA_API_KEY
    ? new TwoCaptchaSolver({ apiKey: process.env.TWOCAPTCHA_API_KEY })
    : null;

// Store
const store = process.env.DATABASE_URL
  ? new PostgresStore({ connectionString: process.env.DATABASE_URL })
  : new ConsoleStore();

// Selector engine với auto-heal
const selectorEngine = new AutoHealingSelectorEngine({
  defaultSchema: {
    fields: {
      title: {
        selectors: ["h1", "title", ".product-title", "[itemprop='name']"],
        extract: "text",
        validate: "required"
      },
      price: {
        selectors: [".price", "[itemprop='price']"],
        extract: "text",
        default: null
      }
    }
  },
  onHeal: (info) => logger.warn(info, "Selector auto-healed")
});

// Fetchers
const httpFetcher = new HttpFetcher({ impersonate: "chrome", proxyRotator });
const playwrightFetcher = new PlaywrightFetcher({ headless: true, proxyRotator });
const puppeteerFetcher = new PuppeteerFetcher({ headless: true, proxyRotator });

// Anti-bot handler
const antiBot = new CaptchaAwareAntiBotHandler({
  defaultStrategy: "http",
  proxyRotator,
  captchaSolver,
  metrics,
  logger
});
antiBot.registerFetcher("http", httpFetcher);
antiBot.registerFetcher("playwright", playwrightFetcher);
antiBot.registerFetcher("puppeteer", puppeteerFetcher);

// Crawler
const crawler = new Crawler({
  id: "advanced-demo",
  queue: new MemoryQueue(),
  rateLimiter: {
    async acquire() {},
    async close() {}
  },
  dedup: new MemoryDedup(),
  fetcher: antiBot,
  selectorEngine,
  store,
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

// Prometheus endpoint
const app = express();
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", await metrics.contentType());
  res.end(await metrics.metrics());
});

async function main() {
  app.listen(9100, () => {
    logger.info("Metrics exposed at http://localhost:9100/metrics");
  });

  await crawler.schedule("https://quotes.toscrape.com/", { priority: 10 });

  const stopTimer = setTimeout(async () => {
    await crawler.stop();
    await antiBot.close();
    await store.close();
    logger.info("Crawler stopped");
  }, 60_000);

  await crawler.start();
  clearTimeout(stopTimer);
}

main().catch(async (error) => {
  logger.error(error, "Fatal error");
  await antiBot.close();
  await store.close();
  process.exit(1);
});
