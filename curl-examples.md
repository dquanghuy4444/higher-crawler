# Curl Examples

Start the server first:

```bash
npm start
```

## Health

```bash
curl http://localhost:3000/health
```

## Sites

```bash
curl http://localhost:3000/sites
```

## SJC

```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -d '{"site":"sjc.com.vn"}'
```

## DOJI

```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -d '{"site":"doji.vn"}'
```

## Bao Tin Manh Hai

```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -d '{"site":"baotinmanhhai.vn"}'
```

## Viblo

```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "site": "viblo.asia",
    "url": "https://viblo.asia/p/request-di-qua-server-nhu-the-nao-backend-internals-p1-ymJXDlN5Jkq"
  }'
```

## Dantri

```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "site": "dantri.com.vn",
    "url": "https://dantri.com.vn/phap-luat/ben-trong-me-hon-tran-ban-ky-nghi-lua-nguoi-gia-20260618001815122.htm"
  }'
```

## YouTube Thumbnail Grabber

```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "site": "youtube-thumbnail-grabber.com",
    "youtube_url": "https://www.youtube.com/watch?v=xC1662uBym8",
    "timeout_ms": 60000,
    "browser_visible": true,
    "slow_mo_ms": 150,
    "keep_browser_open_ms": 10000
  }'
```

## FVidGo Facebook Reels

```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "site": "fvidgo.com",
    "facebook_url": "https://www.facebook.com/reel/1246139657674609",
    "timeout_ms": 90000,
    "browser_visible": true,
    "slow_mo_ms": 150,
    "keep_browser_open_ms": 10000
  }'
```

## Lazada

```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "site": "lazada.vn",
    "url": "https://www.lazada.vn/products/..."
  }'
```

## Pretty Output

Add `jq` when you want formatted JSON:

```bash
curl -s http://localhost:3000/sites | jq
```

```bash
curl -s -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -d '{"site":"doji.vn"}' | jq
```
