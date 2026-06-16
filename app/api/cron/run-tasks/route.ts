/**
 * Vercel Cron endpoint — processes one QUEUED task per invocation.
 * Schedule: every minute (vercel.json crons config).
 * Auth:  Authorization: Bearer $CRON_SECRET (Vercel sets this automatically for cron requests).
 */

import { NextResponse, type NextRequest } from "next/server";
import { AgentStatus, LogKind, LogLevel, TaskStatus } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { McpClientManager } from "@/src/mcp/mcpGateway";
import { BudgetTracker, TokenBucketRateLimiter } from "@/src/engine/budget";
import { redis } from "@/src/lib/redis";
import { runAgentLoopDirect, publishLog } from "@/src/engine/agentEngine";
import { enqueueTask } from "@/src/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Find and atomically claim one QUEUED task.
  const candidate = await prisma.task.findFirst({
    where: { status: TaskStatus.QUEUED },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  if (!candidate) {
    return NextResponse.json({ message: "No queued tasks" });
  }

  // Atomic claim: only succeeds if status is still QUEUED (race-safe).
  const claimed = await prisma.task.updateMany({
    where: { id: candidate.id, status: TaskStatus.QUEUED },
    data: {
      status: TaskStatus.RUNNING,
      startedAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  if (claimed.count === 0) {
    return NextResponse.json({ message: "Task claimed by another invocation" });
  }

  const task = await prisma.task.findUnique({
    where: { id: candidate.id },
    include: { agent: true, company: true },
  });

  if (!task || !task.agent) {
    return NextResponse.json({ error: "Task or agent not found" }, { status: 500 });
  }

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

  // Empty gateway — no MCP child processes needed in serverless.
  // SAVE_DELIVERABLE_TOOL is always injected by runAgentLoop directly.
  const gateway = new McpClientManager({ onStatusChange: () => undefined });
  await gateway.init([]);

  const limiter = new TokenBucketRateLimiter(redis);
  const budget = new BudgetTracker(redis);

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

    // Unblock next pending sibling and immediately trigger it.
    if (task.parentId) {
      const next = await prisma.task.findFirst({
        where: {
          companyId: task.companyId,
          parentId: task.parentId,
          status: TaskStatus.PENDING,
        },
        orderBy: { priority: "asc" },
      });
      if (next) {
        await prisma.task.update({ where: { id: next.id }, data: { status: TaskStatus.QUEUED } });
        await enqueueTask(next.id); // chains the HTTP trigger for the next task
      }
    }

    return NextResponse.json({ ok: true, task: task.title, summary: outcome.summary });
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
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    await gateway.close().catch(() => undefined);
  }
}
