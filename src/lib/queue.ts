/**
 * Task queue — replaced from BullMQ to HTTP-based self-trigger.
 *
 * Instead of pushing a job to Redis (which Upstash doesn't support via
 * BullMQ's blocking BLMOVE), we fire a POST to our own cron endpoint.
 * The cron endpoint atomically claims the next QUEUED task and runs it.
 *
 * Call graph:
 *   orchestrator/agentEngine → enqueueTask()
 *     → after() [post-response hook]  → GET /api/cron/run-tasks
 *       → runAgentLoopDirect()  → enqueueTask() for next sibling
 *         → after() → ... (chains until no QUEUED tasks remain)
 */

import { after } from "next/server";

// Kept for callers that destructure the type; the BullMQ queue itself is gone.
export type AgentJobData = { taskId: string };

function cronUrl(): string {
  // VERCEL_URL = current deployment URL (set automatically by Vercel).
  // NEXTAUTH_URL = explicit override for local dev or custom domains.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  return "http://localhost:3000";
}

async function triggerCron(): Promise<void> {
  try {
    await fetch(`${cronUrl()}/api/cron/run-tasks`, {
      headers: process.env.CRON_SECRET
        ? { Authorization: `Bearer ${process.env.CRON_SECRET}` }
        : {},
    });
  } catch {
    // Non-fatal — worst case the daily safety-net cron picks it up.
  }
}

export async function enqueueTask(_taskId: string): Promise<void> {
  // Task is already QUEUED in DB. Trigger the cron endpoint to pick it up.
  // Use next/server `after()` so the trigger fires after the current
  // response is sent (non-blocking from the caller's perspective).
  try {
    after(triggerCron());
  } catch {
    // `after` throws outside a Next.js request context (e.g., CLI runner).
    // Fall back to an immediate best-effort fetch.
    await triggerCron();
  }
}
