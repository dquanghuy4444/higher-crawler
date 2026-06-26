# Base Crawler

Reusable, extensible, decoupled base crawler for multi-domain scraping.

## Đặc điểm

- **Modular**: Mỗi component (queue, rate limiter, dedup, fetcher, store, metrics) có interface riêng, dễ thay thế.
- **Decoupled**: Không phụ thuộc implementation. Có thể dùng Memory hoặc Redis cho cùng một codebase.
- **Selector fallback**: CSS selector → pattern → heuristic → default.
- **Distributed queue**: Redis Queue hỗ trợ multiple workers, priority, delayed retry, visibility timeout.
- **Resume**: Jobs persist trong Redis, worker crash thì job tự động re-queue.
- **Dedup**: URL + content hash.
- **Rate limiting**: Token bucket per domain.
- **Anti-bot**: Strategy-based fetcher, tự động escalate từ HTTP → browser.
- **CAPTCHA solving**: 2captcha, CapSolver integration.
- **Proxy rotation**: Round-robin / random / sticky với failure tracking.
- **Persistent storage**: PostgreSQL store.
- **Monitoring**: Metrics interface + Prometheus exporter.
- **Auto-healing selector**: Tự tìm selector mới khi DOM thay đổi.

## Cấu trúc

```
base-crawler/
├── core/
│   └── Crawler.js              # Orchestrator
├── queue/
│   ├── BaseQueue.js
│   ├── MemoryQueue.js
│   └── RedisQueue.js
├── rate/
│   ├── BaseRateLimiter.js
│   └── RedisRateLimiter.js
├── dedup/
│   ├── BaseDedup.js
│   ├── MemoryDedup.js
│   └── RedisDedup.js
├── fetcher/
│   ├── BaseFetcher.js
│   ├── HttpFetcher.js          # curl_cffi / axios
│   ├── PlaywrightFetcher.js    # playwright-core stealth
│   └── PuppeteerFetcher.js     # puppeteer-core stealth
├── selector/
│   ├── SelectorEngine.js       # fallback + heuristic
│   └── AutoHealingSelectorEngine.js  # auto-heal
├── anti-bot/
│   └── AntiBotHandler.js       # strategy + escalation + proxy rotation
├── proxy/
│   ├── BaseProxyRotator.js
│   └── StaticProxyRotator.js   # round-robin / random / sticky
├── store/
│   ├── BaseStore.js
│   ├── ConsoleStore.js
│   └── PostgresStore.js
├── metrics/
│   ├── BaseMetrics.js
│   ├── ConsoleMetrics.js
│   └── PrometheusMetrics.js
├── captcha/
│   ├── BaseCaptchaSolver.js
│   ├── TwoCaptchaSolver.js
│   ├── CapSolverSolver.js
│   └── CaptchaAwareAntiBotHandler.js
├── utils/
│   └── logger.js
├── examples/
│   ├── basic-crawl.js          # memory only
│   ├── redis-crawl.js          # distributed
│   ├── anti-bot-crawl.js       # http → playwright → puppeteer escalation
│   ├── proxy-crawl.js          # proxy rotation + anti-bot
│   └── advanced-crawl.js       # all features combined
├── index.js
└── package.json
```

## Install

```bash
cd src/base-crawler
npm install

# Nếu dùng Redis
npm install ioredis

# Nếu dùng curl_cffi (cho TLS impersonation)
pip install curl_cffi
# hoặc trong Node: tùy chọn, HttpFetcher tự fallback axios
```

## Quick Start

```bash
node examples/basic-crawl.js
node examples/anti-bot-crawl.js
node examples/proxy-crawl.js
node examples/advanced-crawl.js   # requires env vars for optional services
```

## Sử dụng

```javascript
import {
  Crawler,
  MemoryQueue,
  MemoryDedup,
  SelectorEngine,
  HttpFetcher,
  ConsoleStore,
  ConsoleMetrics
} from "./src/base-crawler/index.js";
import { createLogger } from "./src/base-crawler/utils/logger.js";

const logger = createLogger({ level: "info", prettyPrint: true });

const crawler = new Crawler({
  queue: new MemoryQueue(),
  rateLimiter: {
    async acquire() {},
    async close() {}
  },
  dedup: new MemoryDedup(),
  fetcher: new HttpFetcher({ impersonate: "chrome" }),
  selectorEngine: new SelectorEngine({
    schemas: {
      "example.com": {
        fields: {
          title: {
            selectors: ["h1", "title", "[itemprop='name']"],
            extract: "text",
            validate: "required"
          }
        }
      }
    }
  }),
  store: new ConsoleStore(),
  metrics: new ConsoleMetrics(logger),
  logger,
  concurrency: 2
});

await crawler.schedule("https://example.com/page/1", { priority: 10 });
await crawler.start();
```

## Redis Distributed Mode

```bash
# Terminal 1: Scheduler
IS_SCHEDULER=1 node examples/redis-crawl.js

# Terminal 2: Worker 1
CRAWLER_ID=worker-1 node examples/redis-crawl.js

# Terminal 3: Worker 2
CRAWLER_ID=worker-2 node examples/redis-crawl.js
```

## Thêm Fetcher Mới

```javascript
import { BaseFetcher } from "./src/base-crawler/fetcher/BaseFetcher.js";

class PlaywrightFetcher extends BaseFetcher {
  async fetch(url, options) {
    // ... implementation
    return { url, status, headers, body, contentType };
  }
  async close() {}
}

antiBot.registerFetcher("playwright", new PlaywrightFetcher());
```

## Thêm Store Mới

```javascript
import { BaseStore } from "./src/base-crawler/store/BaseStore.js";

class PostgresStore extends BaseStore {
  async save(job, parsed, response) {
    // insert into DB
  }
}
```

## Cấu hình Domain

```javascript
config: {
  domains: {
    "example.com": {
      rate: { rate: 2, interval: 1000 },  // 2 req/s
      strategy: "http",                   // hoặc "nodriver", "invisible_playwright"
      proxy: "http://user:pass@proxy:3128",
      maxRetries: 5,
      baseDelay: 1000,
      maxDelay: 60000
    }
  }
}
```

## Monitoring

- `crawl.success` / `crawl.failure` / `crawl.retry` / `crawl.skipped`
- `crawl.duration`
- `fetcher.success` / `fetcher.failure` (by strategy)

Thay `ConsoleMetrics` bằng `PrometheusMetrics` để expose `/metrics`.

## Anti-bot Strategy Escalation

Chuỗi escalate tự động khi gặp lỗi bot detect:

```
http → playwright → puppeteer
```

Ví dụ: domain `example.com` bị Cloudflare 403:

```javascript
const antiBot = new AntiBotHandler({ defaultStrategy: "http" });
antiBot.registerFetcher("http", new HttpFetcher());
antiBot.registerFetcher("playwright", new PlaywrightFetcher({ headless: true }));
antiBot.registerFetcher("puppeteer", new PuppeteerFetcher({ headless: true }));

const crawler = new Crawler({
  fetcher: antiBot,
  config: {
    domains: {
      "example.com": {
        strategy: "http",  // sẽ tự động escalate khi cần
        rate: { rate: 1, interval: 2000 }
      }
    }
  }
});
```

Lưu ý:
- Browser fetcher nên chạy với `concurrency: 1` hoặc rất thấp.
- Cần Chrome/Edge installed hoặc set `CHROME_EXECUTABLE`.

## Proxy Rotation

```javascript
import { StaticProxyRotator, AntiBotHandler, HttpFetcher } from "./index.js";

const proxyRotator = new StaticProxyRotator({
  proxies: [
    "http://user:pass@proxy1:8080",
    "http://user:pass@proxy2:8080",
    "socks5://user:pass@proxy3:1080"
  ],
  mode: "round_robin", // round_robin | random | sticky
  stickyKey: "domain",
  maxFailures: 3
});

const antiBot = new AntiBotHandler({
  defaultStrategy: "http",
  proxyRotator,
  logger
});
antiBot.registerFetcher("http", new HttpFetcher({ proxyRotator }));
```

Proxy rotator tự động:
- Chọn proxy mỗi request
- Bỏ qua proxy fail quá `maxFailures` lần
- `sticky` mode: giữ proxy cho cùng domain/session

## CAPTCHA Solving

```bash
npm install express
```

```javascript
import { CaptchaAwareAntiBotHandler, CapSolverSolver } from "./index.js";

const solver = new CapSolverSolver({ apiKey: process.env.CAPSOLVER_API_KEY });
// hoặc: new TwoCaptchaSolver({ apiKey: process.env.TWOCAPTCHA_API_KEY })

const antiBot = new CaptchaAwareAntiBotHandler({
  defaultStrategy: "http",
  captchaSolver: solver,
  logger
});
```

Hỗ trợ: `recaptcha_v2`, `recaptcha_v3`, `hcaptcha`, `turnstile`, `datadome`.

## PostgreSQL Store

```bash
npm install pg
```

```javascript
import { PostgresStore } from "./index.js";

const store = new PostgresStore({
  connectionString: process.env.DATABASE_URL
});
```

Tự động tạo bảng:
- `crawl_results`
- `crawl_snapshots`

## Prometheus Metrics

```bash
npm install prom-client
```

```javascript
import { PrometheusMetrics } from "./index.js";
import express from "express";

const metrics = new PrometheusMetrics();
const app = express();
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", await metrics.contentType());
  res.end(await metrics.metrics());
});
app.listen(9100);
```

## Auto-Healing Selector

```javascript
import { AutoHealingSelectorEngine } from "./index.js";

const selectorEngine = new AutoHealingSelectorEngine({
  defaultSchema: {
    fields: {
      title: {
        selectors: ["h1", "title", ".product-title"],
        extract: "text",
        validate: "required"
      }
    }
  },
  onHeal: (info) => console.log("Healed:", info)
});
```

Khi selector fail, engine tự tìm selector mới dựa trên:
1. Text content match
2. Stable attributes (id, name, itemprop)
3. Class partial match
4. Structural similarity

## Roadmap

- [x] Playwright/Puppeteer fetchers
- [x] Proxy rotator
- [x] CAPTCHA solver integration
- [x] PostgresStore
- [x] Prometheus metrics exporter
- [x] Auto-healing selector
- [ ] PostgresQueue implementation
