const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 404, 422]);

const RETRYABLE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND"
]);

export function classifyCrawlerError(error) {
  const statusCode = error?.statusCode || error?.response?.status || null;
  const code = error?.code || null;
  const message = String(error?.message || "");

  if (error?.blocked) {
    return {
      retryable: Boolean(error.retryable),
      category: error.blockType || "blocked",
      statusCode
    };
  }

  if (statusCode && NON_RETRYABLE_STATUS_CODES.has(statusCode)) {
    return {
      retryable: false,
      category: statusCode === 404 ? "not_found" : "client_error",
      statusCode
    };
  }

  if (statusCode && RETRYABLE_STATUS_CODES.has(statusCode)) {
    return {
      retryable: true,
      category: statusCode === 429 ? "rate_limit" : "server_error",
      statusCode
    };
  }

  if (code && RETRYABLE_ERROR_CODES.has(code)) {
    return {
      retryable: true,
      category: "network_error",
      statusCode
    };
  }

  if (/timeout|timed out|navigation timeout|net::err/i.test(message)) {
    return {
      retryable: true,
      category: "timeout",
      statusCode
    };
  }

  if (/could not fetch|could not load|source data|source page/i.test(message)) {
    return {
      retryable: true,
      category: "fetch_error",
      statusCode
    };
  }

  if (/content was not found|selector|parse|schema|invalid/i.test(message)) {
    return {
      retryable: false,
      category: "parse_or_validation_error",
      statusCode
    };
  }

  return {
    retryable: false,
    category: "unknown",
    statusCode
  };
}
