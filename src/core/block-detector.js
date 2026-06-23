const BLOCK_STATUS_CODES = new Set([403, 407, 408, 409, 425, 429, 503]);

const CHALLENGE_PATTERNS = [
  /just a moment/i,
  /checking your browser/i,
  /verify you are human/i,
  /cf-turnstile/i,
  /cloudflare (ray id|challenge|error)/i,
  /captcha/i,
  /challenge/i,
  /access denied/i,
  /unusual traffic/i
];

export function detectBlockFromStatus(statusCode, headers = {}) {
  if (!statusCode || !BLOCK_STATUS_CODES.has(statusCode)) {
    return null;
  }

  if (statusCode === 429) {
    return {
      blocked: true,
      blockType: "rate_limit",
      retryable: true,
      retryAfter: headers["retry-after"] ?? null
    };
  }

  if (statusCode === 403 || statusCode === 503) {
    return {
      blocked: true,
      blockType: "forbidden_or_challenge",
      retryable: statusCode === 503
    };
  }

  return {
    blocked: true,
    blockType: "temporary_block",
    retryable: true
  };
}

export function detectBlockFromBody(body = "") {
  const text = typeof body === "string" ? body.slice(0, 20000) : "";
  const matched = CHALLENGE_PATTERNS.find((pattern) => pattern.test(text));

  if (!matched) {
    return null;
  }

  const value = matched.source.toLowerCase();
  return {
    blocked: true,
    blockType: value.includes("captcha") || value.includes("turnstile") ? "captcha" : "challenge",
    retryable: false,
    marker: matched.source
  };
}

export function decorateBlockedError(error, blockInfo = null) {
  if (!blockInfo) {
    return error;
  }

  error.blocked = true;
  error.blockType = blockInfo.blockType;
  error.retryable = blockInfo.retryable;
  error.retryAfter = blockInfo.retryAfter;
  error.blockMarker = blockInfo.marker;
  return error;
}
