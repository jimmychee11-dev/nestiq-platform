/**
 * Vercel Cron endpoint — processes all QUEUED tasks within the budget window.
 * Schedule: daily safety-net (vercel.json); also self-triggered via enqueueTask().
 * Auth: Authorization: Bearer $CRON_SECRET
 */

import { NextResponse, type NextRequest } from "next/server";
import { AgentStatus, LogKind, LogLevel, TaskStatus } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { McpClientManager } from "@/src/mcp/mcpGateway";
import { BudgetTracker, TokenBucketRateLimiter } from "@/src/engine/budget";
import { redis } from "@/src/lib/redis";
import { runAgentLoopDirect, publishLog } from "@/src/engine/agentEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Leave a 30s buffer so the loop exits cleanly before Vercel kills the function.
const BUDGET_MS = 270_000;

async function claimNextTask() {
  const candidate = await prisma.task.findFirst({
    where: { status: TaskStatus.QUEUED },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (!candidate) return null;

  const claimed = await prisma.task.updateMany({
    where: { id: candidate.id, status: TaskStatus.QUEUED },
    data: { status: TaskStatus.RUNNING, startedAt: new Date(), attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return null; // race-lost to another invocation

  return prisma.task.findUnique({
    where: { id: candidate.id },
    include: { agent: true, company: true },
  });
}

async function dispatchNextSibling(
  companyId: string,
  parentId: string | null,
): Promise<void> {
  if (!parentId) return;
  const next = await prisma.task.findFirst({
    where: { companyId, parentId, status: TaskStatus.PENDING },
    orderBy: { priority: "asc" },
  });
  if (next) {
    await prisma.task.update({ where: { id: next.id }, data: { status: TaskStatus.QUEUED } });
  }
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const gateway = new McpClientManager({ onStatusChange: () => undefined });
  await gateway.init([]);

  const limiter = new TokenBucketRateLimiter(redis);
  const budget = new BudgetTracker(redis);

  const results: Array<{ task: string; ok: boolean; error?: string }> = [];
  const deadline = Date.now() + BUDGET_MS;

  try {
    while (Date.now() < deadline) {
      const task = await claimNextTask();
      if (!task || !task.agent) break; // no more work

      const logBase = {
        companyId: task.companyId,
        taskId: task.id,
        agentId: task.agent.id,
        agentRole: task.agent.role,
      };

      await prisma.agent.update({
        where: { id: task.agent.id },
        data: { status: AgentStatus.EXECUTING, lastActiveAt: new Date() },
      });
      await publishLog({
        ...logBase,
        kind: LogKind.SYSTEM,
        content: `▶ Task started (cron): ${task.title}`,
      });

      try {
        const outcome = await runAgentLoopDirect(task, task.agent, gateway, limiter, budget);

        await prisma.task.update({
          where: { id: task.id },
          data: {
            status: TaskStatus.SUCCESS,
            result: { summary: outcome.summary, artifacts: outcome.artifacts },
            endedAt: new Date(),
            error: null,
          },
        });
        await prisma.agent.update({
          where: { id: task.agent.id },
          data: { status: AgentStatus.IDLE, lastActiveAt: new Date() },
        });
        await publishLog({
          ...logBase,
          kind: LogKind.SYSTEM,
          content: `✔ Task complete (cron): ${outcome.summary}`,
        });

        // Promote next pending sibling so the loop picks it up on next iteration.
        await dispatchNextSibling(task.companyId, task.parentId);
        results.push({ task: task.title, ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await prisma.task.update({
          where: { id: task.id },
          data: { status: TaskStatus.AWAITING_HUMAN_REVIEW, error: msg },
        });
        await prisma.agent.update({
          where: { id: task.agent.id },
          data: { status: AgentStatus.ERROR, lastActiveAt: new Date() },
        });
        await publishLog({
          ...logBase,
          kind: LogKind.ERROR,
          level: LogLevel.ERROR,
          content: `✖ Task error (cron): ${msg}`,
        });
        results.push({ task: task.title, ok: false, error: msg });
        // Don't break — continue with next task in queue.
      }
    }
  } finally {
    await gateway.close().catch(() => undefined);
  }

  return NextResponse.json({
    processed: results.length,
    results,
    remainingMs: Math.max(0, deadline - Date.now()),
  });
}
