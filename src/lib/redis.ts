import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// maxRetriesPerRequest: null is required by BullMQ's blocking commands.
// lazyConnect defers the TCP connect to first use so importing this module
// (e.g. during `next build` page-data collection) never needs a live Redis.
export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

/**
 * Pub/sub requires a dedicated connection — a subscribed ioredis client
 * cannot issue regular commands. Each SSE request gets its own subscriber.
 */
export function createSubscriber(): Redis {
  return new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
}

export const QUEUE_NAME = "agent-tasks";

/** Channel on which new ExecutionLog rows are broadcast per tenant. */
export function logChannel(companyId: string): string {
  return `company:${companyId}:logs`;
}
