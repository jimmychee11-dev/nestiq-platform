/**
 * Direct task runner — bypasses BullMQ and processes QUEUED tasks in order.
 * Use when the queue broker doesn't support BullMQ's blocking commands (e.g. Upstash).
 *
 *   npx tsx src/run-tasks.ts
 */

import { validateEnv } from "@/src/lib/env";
validateEnv();

import { AgentStatus, LogKind, LogLevel, TaskStatus } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { McpClientManager } from "@/src/mcp/mcpGateway";
import { defaultServerConfigs } from "@/src/mcp/servers";
import { BudgetTracker, TokenBucketRateLimiter, BudgetExceededError } from "@/src/engine/budget";
import { redis } from "@/src/lib/redis";
import { publishLog } from "@/src/engine/agentEngine";
import { runAgentLoopDirect } from "@/src/engine/agentEngine";

const POLL_INTERVAL_MS = 3_000;

async function setAgentStatus(agentId: string, status: AgentStatus): Promise<void> {
  await prisma.agent.update({ where: { id: agentId }, data: { status, lastActiveAt: new Date() } });
}

async function processTask(
  taskId: string,
  gateway: McpClientManager,
  limiter: TokenBucketRateLimiter,
  budget: BudgetTracker,
): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { agent: true, company: true },
  });
  if (!task || !task.agent) { console.log(`[runner] Task ${taskId} not found or no agent`); return; }
  if ([TaskStatus.SUCCESS, TaskStatus.CANCELLED, TaskStatus.AWAITING_HUMAN_REVIEW].includes(task.status)) {
    console.log(`[runner] Task ${taskId} is already ${task.status} — skipping`);
    return;
  }

  console.log(`[runner] ▶ Starting: ${task.title}`);

  await prisma.task.update({
    where: { id: taskId },
    data: { status: TaskStatus.RUNNING, startedAt: task.startedAt ?? new Date(), attempts: { increment: 1 } },
  });
  await setAgentStatus(task.agent.id, AgentStatus.EXECUTING);
  await publishLog({
    companyId: task.companyId, taskId: task.id, agentId: task.agent.id, agentRole: task.agent.role,
    kind: LogKind.SYSTEM, content: `▶ Task started: ${task.title} (direct runner)`,
  });

  try {
    const outcome = await runAgentLoopDirect(task, task.agent, gateway, limiter, budget);
    await prisma.task.update({
      where: { id: taskId },
      data: { status: TaskStatus.SUCCESS, result: { summary: outcome.summary, artifacts: outcome.artifacts }, endedAt: new Date(), error: null },
    });
    await setAgentStatus(task.agent.id, AgentStatus.IDLE);
    await publishLog({
      companyId: task.companyId, taskId: task.id, agentId: task.agent.id, agentRole: task.agent.role,
      kind: LogKind.SYSTEM, content: `✔ Task complete: ${outcome.summary}`,
    });
    console.log(`[runner] ✔ Done: ${task.title}`);

    // Dispatch next pending sibling
    if (task.parentId) {
      const next = await prisma.task.findFirst({
        where: { companyId: task.companyId, parentId: task.parentId, status: TaskStatus.PENDING },
        orderBy: { priority: "asc" },
      });
      if (next) {
        await prisma.task.update({ where: { id: next.id }, data: { status: TaskStatus.QUEUED } });
        console.log(`[runner] → Queued next: ${next.title}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[runner] ✖ Error on ${task.title}: ${msg}`);
    await prisma.task.update({ where: { id: taskId }, data: { status: TaskStatus.AWAITING_HUMAN_REVIEW, error: msg } });
    await setAgentStatus(task.agent.id, AgentStatus.ERROR);
    await publishLog({
      companyId: task.companyId, taskId: task.id, agentId: task.agent.id, agentRole: task.agent.role,
      kind: LogKind.ERROR, level: LogLevel.ERROR, content: `✖ Task error: ${msg}`,
    });
  }
}

async function main(): Promise<void> {
  const configs = defaultServerConfigs();
  const gateway = new McpClientManager({ onStatusChange: (n, s) => console.log(`[mcp] ${n} → ${s}`) });
  await gateway.init(configs);
  console.table(gateway.statusReport());

  const limiter = new TokenBucketRateLimiter(redis);
  const budget = new BudgetTracker(redis);

  console.log("[runner] Polling for QUEUED tasks...");

  while (true) {
    const task = await prisma.task.findFirst({
      where: { status: TaskStatus.QUEUED },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });

    if (task) {
      await processTask(task.id, gateway, limiter, budget);
    } else {
      // Check if anything is pending that should be queued
      const pending = await prisma.task.count({ where: { status: { in: [TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.PENDING] } } });
      if (pending === 0) {
        console.log("[runner] All tasks complete. Exiting.");
        break;
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  await gateway.close();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(e => { console.error("[runner] fatal:", e); process.exit(1); });
