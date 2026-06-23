import fs from "node:fs";
import path from "node:path";

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), ".crawler-output");

function sanitizeFileName(value) {
  return String(value).replace(/[^a-z0-9_.-]+/gi, "_");
}

export function saveOutput(siteKey, data, metadata = {}) {
  fs.mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
  const filePath = path.join(DEFAULT_OUTPUT_DIR, `${sanitizeFileName(siteKey)}.jsonl`);
  const records = Array.isArray(data) ? data : [data];
  const savedAt = new Date().toISOString();
  const lines = records.map((record) =>
    JSON.stringify({
      saved_at: savedAt,
      site: siteKey,
      ...metadata,
      data: record
    })
  );

  fs.appendFileSync(filePath, `${lines.join("\n")}\n`);
  return {
    filePath,
    count: records.length
  };
}
