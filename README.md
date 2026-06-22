# High Crawler

API Node.js su dung ExpressJS de crawl data theo tung site. Thu muc `src/sites` chi chua logic crawl thuần, con phan dang ky site va dieu phoi API duoc tach ra ngoai.

## Cach chay

```bash
npm start
```

Server mac dinh chay tai `http://localhost:3000`.

## API

### `GET /health`

Kiem tra server dang song.

### `GET /sites`

Lay danh sach site dang duoc ho tro.

### `POST /api/crawl`

Body JSON:

```json
{
  "site": "sjc.com.vn"
}
```

Hoac:

```json
{
  "site": "doji.vn"
}
```

Hoac:

```json
{
  "site": "baotinmanhhai.vn"
}
```

Hoac crawl bai viet Viblo theo URL:

```json
{
  "site": "viblo.asia",
  "url": "https://viblo.asia/p/request-di-qua-server-nhu-the-nao-backend-internals-p1-ymJXDlN5Jkq"
}
```

Hoac crawl bai viet Dantri theo URL:

```json
{
  "site": "dantri.com.vn",
  "url": "https://dantri.com.vn/phap-luat/ben-trong-me-hon-tran-ban-ky-nghi-lua-nguoi-gia-20260618001815122.htm"
}
```

Hoac crawl job posting tren Horizont Jobs theo URL:

```json
{
  "site": "horizont.jobs",
  "url": "https://horizont.jobs/jobs/social-media-specialist-w-m-d-062074815-personalwerk-gmbh/"
}
```

Hoac crawl san pham Shopee theo URL:

```json
{
  "site": "shopee.vn",
  "url": "https://shopee.vn/Gi%C3%A0y-Th%E1%BB%83-Thao-sneaker-N%E1%BB%AF-Biti's-Hunter-HSW015500-i.25211549.51254808076"
}
```

Hoac crawl san pham Lazada theo URL:

```json
{
  "site": "lazada.vn",
  "url": "https://www.lazada.vn/products/..."
}
```

Hoac crawl san pham ASUS theo URL:

```json
{
  "site": "asus.com",
  "url": "https://www.asus.com/de/laptops/for-home/vivobook/asus-vivobook-s16-s3607/"
}
```

Hoac crawl san pham EXTRA Computer theo URL:

```json
{
  "site": "extracomputer.de",
  "url": "https://www.extracomputer.de/produkt/exone-business-mini-x14/153604"
}
```

## Them site moi

1. Tao file moi trong `src/sites`, vi du `my-site.js`
2. Export mot ham crawl:

```js
export default async function crawlMySite(input) {
  return {
    data: {}
  };
}
```

3. Dang ky file do trong `src/config/sites.js`
