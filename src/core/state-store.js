import fs from "node:fs";
import path from "node:path";

const DEFAULT_STATE_DIR = path.join(process.cwd(), ".crawler-state");
const DEFAULT_STATE_FILE = path.join(DEFAULT_STATE_DIR, "visited.json");

let stateCache = null;

function loadState() {
  if (stateCache) {
    return stateCache;
  }

  try {
    const raw = fs.readFileSync(DEFAULT_STATE_FILE, "utf8");
    stateCache = JSON.parse(raw);
  } catch {
    stateCache = {
      visited: {}
    };
  }

  return stateCache;
}

function saveState(state) {
  fs.mkdirSync(DEFAULT_STATE_DIR, { recursive: true });
  fs.writeFileSync(DEFAULT_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

export function createVisitKey(siteKey, input = {}) {
  const url = input.url || input.facebook_url || input.youtube_url || input.video_url || input.reel_url || "";
  return `${siteKey}:${url || "root"}`;
}

export function isVisited(siteKey, input = {}) {
  const state = loadState();
  return Boolean(state.visited[createVisitKey(siteKey, input)]);
}

export function markVisited(siteKey, input = {}, metadata = {}) {
  const state = loadState();
  state.visited[createVisitKey(siteKey, input)] = {
    visited_at: new Date().toISOString(),
    ...metadata
  };
  saveState(state);
}
