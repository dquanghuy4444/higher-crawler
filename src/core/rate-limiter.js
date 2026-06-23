const domainQueues = new Map();

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getDomainQueue(domain) {
  if (!domainQueues.has(domain)) {
    domainQueues.set(domain, {
      active: 0,
      lastStartedAt: 0,
      waiting: []
    });
  }

  return domainQueues.get(domain);
}

function pump(domain, options) {
  const queue = getDomainQueue(domain);
  const concurrency = Math.max(1, Number(options?.concurrency || 1));

  while (queue.active < concurrency && queue.waiting.length > 0) {
    const next = queue.waiting.shift();
    queue.active += 1;
    next();
  }
}

export async function withDomainRateLimit(domain, options, task) {
  const queue = getDomainQueue(domain);

  await new Promise((resolve) => {
    queue.waiting.push(resolve);
    pump(domain, options);
  });

  try {
    const delayMs = Math.max(0, Number(options?.delayMs || 0));
    const elapsed = Date.now() - queue.lastStartedAt;
    const waitMs = Math.max(0, delayMs - elapsed);

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    queue.lastStartedAt = Date.now();
    return await task();
  } finally {
    queue.active -= 1;
    pump(domain, options);
  }
}
