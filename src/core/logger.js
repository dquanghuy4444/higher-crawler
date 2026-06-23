function safeDetails(details) {
  if (!details || typeof details !== "object") {
    return details ?? null;
  }

  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined)
  );
}

export function logEvent(event, details = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    event,
    ...safeDetails(details)
  };

  console.info(JSON.stringify(payload));
}

export function logWarn(event, details = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level: "warn",
    event,
    ...safeDetails(details)
  };

  console.warn(JSON.stringify(payload));
}

export function logError(event, details = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level: "error",
    event,
    ...safeDetails(details)
  };

  console.error(JSON.stringify(payload));
}
