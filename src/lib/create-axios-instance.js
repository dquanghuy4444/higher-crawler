import axios from "axios";

import { decorateBlockedError, detectBlockFromBody, detectBlockFromStatus } from "../core/block-detector.js";
import { logEvent } from "../core/logger.js";

const DEFAULT_USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
];

function pickUserAgent(config) {
  const userAgents = config.userAgents || DEFAULT_USER_AGENTS;
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

export default function createAxiosInstance(baseURL, config = {}) {
  const instance = axios.create({
    baseURL,
    timeout: 15000,
    headers: {
      "User-Agent": pickUserAgent(config),
      ...config.headers
    },
    ...config,
    userAgents: undefined
  });

  instance.interceptors.request.use((request) => {
    request.metadata = {
      startedAt: Date.now()
    };

    if (config.rotateUserAgent !== false && !config.headers?.["User-Agent"]) {
      request.headers.set?.("User-Agent", pickUserAgent(config));
      if (!request.headers.set) {
        request.headers["User-Agent"] = pickUserAgent(config);
      }
    }

    return request;
  });

  instance.interceptors.response.use(
    (response) => {
      const durationMs = Date.now() - (response.config.metadata?.startedAt || Date.now());
      const blockInfo = detectBlockFromBody(response.data);

      logEvent("fetch_done", {
        base_url: baseURL,
        url: response.config.url,
        status: response.status,
        duration_ms: durationMs,
        blocked: Boolean(blockInfo),
        block_type: blockInfo?.blockType || null
      });

      if (blockInfo) {
        const error = new Error(`Fetch blocked by ${blockInfo.blockType}.`);
        error.statusCode = response.status;
        error.response = response;
        throw decorateBlockedError(error, blockInfo);
      }

      return response;
    },
    (error) => {
      const response = error.response;
      const durationMs = Date.now() - (error.config?.metadata?.startedAt || Date.now());
      const blockInfo = detectBlockFromStatus(response?.status, response?.headers);

      logEvent("fetch_done", {
        base_url: baseURL,
        url: error.config?.url,
        status: response?.status || null,
        duration_ms: durationMs,
        blocked: Boolean(blockInfo),
        block_type: blockInfo?.blockType || null
      });

      throw decorateBlockedError(error, blockInfo);
    }
  );

  return instance;
}
