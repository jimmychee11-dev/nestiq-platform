/**
 * Task queue — HTTP self-trigger replacing BullMQ.
 *
 * When a task is queued, this fires a GET to /api/cron/run-tasks which
 * processes all QUEUED tasks in a loop within one invocation (no chaining
 * needed). The daily Vercel Cron is a safety-net only.
 */

// Kept for callers that import the type.
export type AgentJobData = { taskId: string };

function cronUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  return "http://localhost:3000";
}

export async function enqueueTask(_taskId: string): Promise<void> {
  // Task is already QUEUED in the DB. Fire a best-effort trigger so the
  // cron endpoint picks it up without waiting for the daily safety-net.
  const url = `${cronUrl()}/api/cron/run-tasks`;
  const headers: Record<string, string> = process.env.CRON_SECRET
    ? { Authorization: `Bearer ${process.env.CRON_SECRET}` }
    : {};

  try {
    // Don't await — the cron endpoint runs for up to 270s in its own
    // invocation. We only need to send the trigger, not wait for it.
    fetch(url, { headers }).catch(() => undefined);
  } catch {
    // Non-fatal: the daily cron is the fallback.
  }
}
