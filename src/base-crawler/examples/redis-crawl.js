import Redis from "ioredis";
import {
  Crawler,
  RedisQueue,
  RedisDedup,
  RedisRateLimiter,
  SelectorEngine,
  HttpFetcher,
  ConsoleStore,
  ConsoleMetrics
} from "../index.js";
import { createLogger } from "../utils/logger.js";
import { AntiBotHandler } from "../anti-bot/AntiBotHandler.js";

const logger = createLogger({ level: "info", prettyPrint: true });
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const metrics = new ConsoleMetrics(logger);
const selectorEngine = new SelectorEngine();
const fetcher = new HttpFetcher({ impersonate: "chrome" });

const antiBot = new AntiBotHandler({
  defaultStrategy: "http",
  metrics,
  logger
});
antiBot.registerFetcher("http", fetcher);

const crawler = new Crawler({
  id: process.env.CRAWLER_ID || "worker-1",
  queue: new RedisQueue(redis, { visibilityTimeout: 120_000 }),
  rateLimiter: new RedisRateLimiter(redis),
  dedup: new RedisDedup(redis),
  fetcher: antiBot,
  selectorEngine,
  store: new ConsoleStore(),
  metrics,
  logger,
  concurrency: Number(process.env.CONCURRENCY) || 3,
  config: {
    domains: {
      "quotes.toscrape.com": {
        rate: { rate: 1, interval: 1000 }
      }
    }
  }
});

async function main() {
  // Chỉ scheduler node mới push jobs
  if (process.env.IS_SCHEDULER === "1") {
    for (let i = 1; i <= 5; i++) {
      const url = i === 1 ? "https://quotes.toscrape.com/" : `https://quotes.toscrape.com/page/${i}/`;
      await crawler.schedule(url, { priority: 10 - i });
    }
    logger.info("Scheduled jobs");
  }

  // Worker nodes chạy liên tục
  process.on("SIGINT", async () => {
    logger.info("SIGINT received, stopping...");
    await crawler.stop();
    await redis.disconnect();
    process.exit(0);
  });

  await crawler.start();
}

main().catch((error) => {
  logger.error(error, "Fatal error");
  process.exit(1);
});
