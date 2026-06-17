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
