/**
 * Two guardrails that keep recursive agent loops from draining API keys:
 *
 * 1. TokenBucketRateLimiter — atomic (Lua) token bucket in Redis, keyed per
 *    company. Caps model-call *rate* so a runaway loop can't hammer the API.
 * 2. BudgetTracker — per-company monthly token-spend ledger (Redis counter
 *    for the hot path, Postgres UsageEvent rows as the durable record). Caps
 *    model-call *volume*.
 */

import type Redis from "ioredis";
import { prisma } from "@/src/lib/db";

const BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_ms = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil then tokens = capacity end
if ts == nil then ts = now_ms end

tokens = math.min(capacity, tokens + (now_ms - ts) * refill_per_ms)

local allowed = 0
local wait_ms = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
else
  wait_ms = math.ceil((requested - tokens) / refill_per_ms)
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now_ms)
redis.call('PEXPIRE', key, 3600000)
return {allowed, wait_ms}
`;

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export class TokenBucketRateLimiter {
  constructor(private readonly redis: Redis) {}

  /**
   * Take one "model call" token from the company's bucket.
   * @param callsPerMinute sustained refill rate; capacity = 2x for bursts.
   */
  async take(companyId: string, callsPerMinute: number): Promise<RateLimitDecision> {
    const capacity = Math.max(1, callsPerMinute * 2);
    const refillPerMs = callsPerMinute / 60_000;
    const result = (await this.redis.eval(
      BUCKET_LUA,
      1,
      `ratelimit:model-calls:${companyId}`,
      String(capacity),
      String(refillPerMs),
      String(Date.now()),
      "1",
    )) as [number, number];
    return { allowed: result[0] === 1, retryAfterMs: result[1] };
  }
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly companyId: string,
    public readonly spent: number,
    public readonly budget: number,
  ) {
    super(
      `Company ${companyId} has spent ${spent} of its ${budget} monthly token budget`,
    );
    this.name = "BudgetExceededError";
  }
}

export class BudgetTracker {
  constructor(private readonly redis: Redis) {}

  private monthKey(companyId: string): string {
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    return `budget:tokens:${companyId}:${month}`;
  }

  /** Throws BudgetExceededError when the ceiling has been hit. */
  async assertWithinBudget(companyId: string, monthlyTokenBudget: number): Promise<void> {
    const spent = Number((await this.redis.get(this.monthKey(companyId))) ?? "0");
    if (spent >= monthlyTokenBudget) {
      throw new BudgetExceededError(companyId, spent, monthlyTokenBudget);
    }
  }

  /** Record actual usage after each model call (Redis + durable ledger). */
  async record(params: {
    companyId: string;
    agentId?: string;
    taskId?: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }): Promise<void> {
    const total = params.inputTokens + params.outputTokens;
    const key = this.monthKey(params.companyId);
    await this.redis
      .multi()
      .incrby(key, total)
      // Keep the counter ~62 days so a stale key never lingers forever.
      .expire(key, 62 * 24 * 3600, "NX")
      .exec();

    await prisma.usageEvent.create({
      data: {
        companyId: params.companyId,
        agentId: params.agentId,
        taskId: params.taskId,
        model: params.model,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
      },
    });
  }
}
