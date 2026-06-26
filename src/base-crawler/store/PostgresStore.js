import { BaseStore } from "./BaseStore.js";

/**
 * PostgreSQL persistent store.
 * Lưu kết quả crawl, job metadata, snapshots.
 * Peer dependency: pg (node-postgres)
 */
export class PostgresStore extends BaseStore {
  constructor(options = {}) {
    super();
    this.pool = options.pool || null;
    this.connectionString = options.connectionString || process.env.DATABASE_URL;
    this.tablePrefix = options.tablePrefix || "crawl";
    this._initialized = false;
  }

  async _getPool() {
    if (this.pool) return this.pool;
    const { Pool } = await import("pg");
    this.pool = new Pool({ connectionString: this.connectionString });
    return this.pool;
  }

  async save(job, parsed, response) {
    const pool = await this._getPool();
    await this._ensureTables(pool);

    const resultId = job.id;
    const url = job.url;
    const domain = job.domain;
    const status = response?.status || null;
    const finalUrl = response?.url || url;
    const title = parsed?.title?.value || parsed?.title || null;
    const data = JSON.stringify(parsed);
    const htmlSnapshot = response?.body || null;
    const contentType = response?.contentType || null;

    await pool.query(
      `INSERT INTO ${this.tablePrefix}_results
        (id, job_id, url, final_url, domain, status, title, data, html_snapshot, content_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (id) DO UPDATE SET
         final_url = EXCLUDED.final_url,
         status = EXCLUDED.status,
         title = EXCLUDED.title,
         data = EXCLUDED.data,
         html_snapshot = EXCLUDED.html_snapshot,
         content_type = EXCLUDED.content_type,
         updated_at = NOW()`,
      [resultId, job.id, url, finalUrl, domain, status, title, data, htmlSnapshot, contentType]
    );
  }

  async saveJobSnapshot(job, html) {
    const pool = await this._getPool();
    await this._ensureTables(pool);

    await pool.query(
      `INSERT INTO ${this.tablePrefix}_snapshots (job_id, url, domain, html, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [job.id, job.url, job.domain, html]
    );
  }

  async getLatestSnapshot(url) {
    const pool = await this._getPool();
    await this._ensureTables(pool);

    const result = await pool.query(
      `SELECT * FROM ${this.tablePrefix}_snapshots
       WHERE url = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [url]
    );

    return result.rows[0] || null;
  }

  async getResults(domain, limit = 100, offset = 0) {
    const pool = await this._getPool();
    await this._ensureTables(pool);

    const result = await pool.query(
      `SELECT * FROM ${this.tablePrefix}_results
       WHERE domain = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [domain, limit, offset]
    );

    return result.rows.map((row) => ({
      ...row,
      data: row.data ? JSON.parse(row.data) : null
    }));
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }

  async _ensureTables(pool) {
    if (this._initialized) return;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tablePrefix}_results (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        url TEXT NOT NULL,
        final_url TEXT,
        domain TEXT,
        status INTEGER,
        title TEXT,
        data JSONB,
        html_snapshot TEXT,
        content_type TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}_results_domain
      ON ${this.tablePrefix}_results(domain);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}_results_url
      ON ${this.tablePrefix}_results(url);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tablePrefix}_snapshots (
        id SERIAL PRIMARY KEY,
        job_id TEXT NOT NULL,
        url TEXT NOT NULL,
        domain TEXT,
        html TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}_snapshots_url
      ON ${this.tablePrefix}_snapshots(url);
    `);

    this._initialized = true;
  }
}
