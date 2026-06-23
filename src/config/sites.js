import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { defineSite } from "../core/crawler-site.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SITES_DIR = path.join(__dirname, "../sites");

async function findConfigFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await findConfigFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".config.js")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

async function loadSiteRegistry() {
  const configFiles = await findConfigFiles(SITES_DIR);
  const modules = await Promise.all(
    configFiles.map((file) => import(pathToFileURL(file).href))
  );

  return modules.map((module) => defineSite(module.default));
}

export const siteRegistry = await loadSiteRegistry();
