/**
 * Agent Engine — BullMQ worker running the Plan-Act-Evaluate state machine.
 *
 * State machine per task:
 *
 *   QUEUED ──▶ RUNNING ──▶ (model turn ⇄ MCP tool calls)* ──▶ SUCCESS
 *                 │
 *                 ├─ escalate_to_human tool / budget hit ──▶ AWAITING_HUMAN_REVIEW
 *                 └─ error (final attempt) ───────────────▶ AWAITING_HUMAN_REVIEW
 *                    error (retryable) ───────────────────▶ re-queued by BullMQ
 *
 * Every step is persisted to ExecutionLog AND published on the company's
 * Redis channel so the dashboard console renders it live.
 */

import { Worker, type Job } from "bullmq";
import type Anthropic from "@anthropic-ai/sdk";
import {
  AgentStatus,
  LogKind,
  LogLevel,
  TaskStatus,
  type Agent,
  type AgentRole,
  type Company,
  type Task,
} from "@prisma/client";
import { anthropic, DEFAULT_AGENT_MODEL } from "@/src/lib/anthropic";
import { businessContextPrompt, parseBusinessProfile } from "@/src/lib/businessProfile";
import { prisma } from "@/src/lib/db";
import { logChannel, QUEUE_NAME, redis } from "@/src/lib/redis";
import { enqueueTask, type AgentJobData } from "@/src/lib/queue";
import { BudgetExceededError, BudgetTracker, TokenBucketRateLimiter } from "./budget";
import type { McpClientManager } from "@/src/mcp/mcpGateway";
import { ROLE_SERVER_ALLOWLIST } from "@/src/mcp/servers";

const MAX_TURNS = Number(process.env.AGENT_MAX_TURNS ?? "24");
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? "4");
const MAX_TOKENS_PER_TURN = 32_000;

// ---------------------------------------------------------------------------
// Human-in-the-loop escalation
// ---------------------------------------------------------------------------

/** Control-flow signal: the agent deliberately paused for human review. */
class HumanReviewRequested extends Error {
  constructor(
    public readonly reason: string,
    public readonly question: string | null,
  ) {
    super(reason);
    this.name = "HumanReviewRequested";
  }
}

const ESCALATE_TOOL: Anthropic.Tool = {
  name: "escalate_to_human",
  description:
    "Pause this task and hand it to a human operator. Call this — instead of guessing — when you hit " +
    "an ambiguity boundary: a payment or credential failure, an unexpected external API change, a " +
    "destructive/irreversible action that was not explicitly authorized, or a business decision the " +
    "goal does not answer. The task resumes only after a human responds via the dashboard or webhook.",
  input_schema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "One-sentence summary of why human review is required.",
      },
      question: {
        type: "string",
        description: "The specific decision or input you need from the human.",
      },
    },
    required: ["reason"],
  },
};

const REPORT_RESULT_TOOL: Anthropic.Tool = {
  name: "report_result",
  description:
    "Report the final structured outcome of this task. Call exactly once, when the goal is fully " +
    "achieved and verified. Do not call it for partial progress.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "What was accomplished, in 1-3 sentences." },
      artifacts: {
        type: "array",
        items: { type: "string" },
        description: "Paths, URLs, message IDs, or other references produced by this task.",
      },
    },
    required: ["summary"],
  },
};

// ---------------------------------------------------------------------------
// Execution log persistence + live broadcast
// ---------------------------------------------------------------------------

export interface PublishLogParams {
  companyId: string;
  taskId?: string;
  agentId?: string;
  agentRole?: AgentRole | null;
  kind: LogKind;
  level?: LogLevel;
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  tokensIn?: number;
  tokensOut?: number;
}

export async function publishLog(params: PublishLogParams): Promise<void> {
  const row = await prisma.executionLog.create({
    data: {
      companyId: params.companyId,
      taskId: params.taskId,
      agentId: params.agentId,
      agentRole: params.agentRole ?? undefined,
      kind: params.kind,
      level: params.level ?? LogLevel.INFO,
      content: params.content,
      toolName: params.toolName,
      toolInput: params.toolInput as object | undefined,
      toolOutput: params.toolOutput as object | undefined,
      tokensIn: params.tokensIn ?? 0,
      tokensOut: params.tokensOut ?? 0,
    },
  });

  await redis.publish(
    logChannel(params.companyId),
    JSON.stringify({
      id: row.id,
      seq: row.seq,
      createdAt: row.createdAt.toISOString(),
      kind: row.kind,
      level: row.level,
      agentRole: row.agentRole,
      content: row.content,
      toolName: row.toolName,
    }),
  );
}

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

type TaskWithRelations = Task & { agent: Agent | null; company: Company };

function buildSystemPrompt(agent: Agent, company: Company): string {
  const profile = parseBusinessProfile(company.businessProfile);
  const allowedServers = ROLE_SERVER_ALLOWLIST[agent.role] ?? [];
  return [
    agent.systemPrompt,
    "",
    `You are the ${agent.role} agent for the company "${company.name}".`,
    ...(profile ? ["", businessContextPrompt(profile), ""] : []),
    `Your available tool servers: ${allowedServers.join(", ") || "none"}.`,
    "",
    "Self-healing operating rules — exhaust ALL creative options before escalating:",
    "- Work autonomously toward the task goal using your tools. Never ask questions in plain text.",
    "- If you cannot fulfill the EXACT goal literally (e.g., no web access to pull live data), produce the",
    "  BEST POSSIBLE DELIVERABLE you CAN create with your tools: a template, a framework, a filled example,",
    "  a detailed research guide, a script, a strategy doc, or a placeholder structure the human can fill.",
    "  'I can't browse the web' is NOT a reason to escalate — create a template and save it instead.",
    "- If the human overrode a prior escalation with no instruction, try a DIFFERENT APPROACH from your",
    "  first attempt. Do not repeat the same strategy that failed. Be creative.",
    "- ONLY call escalate_to_human when ALL of these are true: (a) the goal cannot be approximated by any",
    "  deliverable you can create, AND (b) it requires a credential, payment, or irreversible external",
    "  action not authorized in the goal, AND (c) you have already tried at least one alternative approach.",
    "- Never take destructive or irreversible external actions (deleting data, charging cards, mass emails",
    "  to new lists) without explicit authorization in the goal — escalate instead.",
    "- When the goal is fully achieved (or the best achievable deliverable is created), call report_result",
    "  exactly once with a concise summary of what was produced.",
    "- Tool names are namespaced as <server>__<tool> (e.g. filesystem__read_file).",
  ].join("\n");
}

interface LoopOutcome {
  summary: string;
  artifacts: string[];
}

async function runAgentLoop(
  task: TaskWithRelations,
  agent: Agent,
  gateway: McpClientManager,
  limiter: TokenBucketRateLimiter,
  budget: BudgetTracker,
): Promise<LoopOutcome> {
  const company = task.company;
  const model = agent.model || DEFAULT_AGENT_MODEL;
  const allowedServers = ROLE_SERVER_ALLOWLIST[agent.role] ?? [];
  const tools: Anthropic.ToolUnion[] = [
    ...gateway.getAnthropicTools(allowedServers),
    ESCALATE_TOOL,
    REPORT_RESULT_TOOL,
  ];

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        `# Task: ${task.title}`,
        "",
        task.goal,
        "",
        `Structured context: ${JSON.stringify(task.input)}`,
      ].join("\n"),
    },
  ];

  const logBase = {
    companyId: company.id,
    taskId: task.id,
    agentId: agent.id,
    agentRole: agent.role,
  };

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    // Guardrails run before every model call, not just at task start —
    // that's what stops a recursive loop mid-flight.
    await budget.assertWithinBudget(company.id, company.monthlyTokenBudget);
    const decision = await limiter.take(company.id, company.modelCallsPerMinute);
    if (!decision.allowed) {
      await publishLog({
        ...logBase,
        kind: LogKind.SYSTEM,
        level: LogLevel.WARN,
        content: `Rate limit reached; backing off ${decision.retryAfterMs}ms`,
      });
      await new Promise((resolve) => setTimeout(resolve, decision.retryAfterMs));
    }

    // Opus 4.8: adaptive thinking only; sampling params (temperature/top_p/top_k) are removed.
    const stream = anthropic.messages.stream({
      model,
      max_tokens: MAX_TOKENS_PER_TURN,
      system: buildSystemPrompt(agent, company),
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      tools,
      messages,
    });
    const response = await stream.finalMessage();

    await budget.record({
      companyId: company.id,
      agentId: agent.id,
      taskId: task.id,
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    // Persist what the model said this turn.
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim().length > 0) {
        await publishLog({
          ...logBase,
          kind: LogKind.MESSAGE,
          content: block.text,
          tokensIn: response.usage.input_tokens,
          tokensOut: response.usage.output_tokens,
        });
      }
    }

    // Server-side iteration pause — re-send and let the model resume.
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    if (response.stop_reason !== "tool_use") {
      // end_turn without report_result: treat the last text as the result.
      const finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return { summary: finalText || "Task completed (no summary provided).", artifacts: [] };
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const input = (toolUse.input ?? {}) as Record<string, unknown>;

      if (toolUse.name === ESCALATE_TOOL.name) {
        throw new HumanReviewRequested(
          typeof input.reason === "string" ? input.reason : "Agent requested human review",
          typeof input.question === "string" ? input.question : null,
        );
      }

      if (toolUse.name === REPORT_RESULT_TOOL.name) {
        const artifacts = Array.isArray(input.artifacts)
          ? input.artifacts.filter((a): a is string => typeof a === "string")
          : [];
        return {
          summary: typeof input.summary === "string" ? input.summary : "Done.",
          artifacts,
        };
      }

      await publishLog({
        ...logBase,
        kind: LogKind.TOOL_CALL,
        content: `Running: ${toolUse.name} ${JSON.stringify(input)}`,
        toolName: toolUse.name,
        toolInput: input,
      });

      let resultContent: string;
      let isError = false;
      try {
        const result = await gateway.callTool(toolUse.name, input);
        resultContent = result.content;
        isError = !result.ok;
        await publishLog({
          ...logBase,
          kind: LogKind.TOOL_RESULT,
          level: isError ? LogLevel.WARN : LogLevel.INFO,
          content: truncate(resultContent, 4_000),
          toolName: toolUse.name,
          toolOutput: result.raw,
        });
      } catch (error) {
        // Gateway exhausted its retries. Surface to the model once; if the
        // model can't route around it, it should escalate.
        resultContent = `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`;
        isError = true;
        await publishLog({
          ...logBase,
          kind: LogKind.ERROR,
          level: LogLevel.ERROR,
          content: resultContent,
          toolName: toolUse.name,
        });
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: truncate(resultContent, 50_000),
        is_error: isError,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  throw new Error(`Agent exceeded MAX_TURNS (${MAX_TURNS}) without completing the task`);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

// ---------------------------------------------------------------------------
// Job processor + worker
// ---------------------------------------------------------------------------

async function setAgentStatus(agentId: string, status: AgentStatus): Promise<void> {
  await prisma.agent.update({
    where: { id: agentId },
    data: { status, lastActiveAt: new Date() },
  });
}

async function pauseForHumanReview(
  task: TaskWithRelations,
  reason: string,
  question: string | null,
): Promise<void> {
  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: TaskStatus.AWAITING_HUMAN_REVIEW,
      error: reason,
      input: {
        ...(task.input as Record<string, unknown>),
        humanReview: { reason, question, requestedAt: new Date().toISOString() },
      },
    },
  });
  if (task.agentId) await setAgentStatus(task.agentId, AgentStatus.PAUSED);
  await publishLog({
    companyId: task.companyId,
    taskId: task.id,
    agentId: task.agentId ?? undefined,
    agentRole: task.agent?.role ?? null,
    kind: LogKind.SYSTEM,
    level: LogLevel.WARN,
    content: `⏸ AWAITING_HUMAN_REVIEW — ${reason}${question ? ` | Question: ${question}` : ""}`,
  });
}

/** After one task succeeds, dispatch the next pending sibling in the plan. */
async function dispatchNextTask(companyId: string, parentId: string | null): Promise<void> {
  if (!parentId) return;
  const next = await prisma.task.findFirst({
    where: { companyId, parentId, status: TaskStatus.PENDING },
    orderBy: { priority: "asc" },
  });
  if (!next) return;
  await prisma.task.update({ where: { id: next.id }, data: { status: TaskStatus.QUEUED } });
  await enqueueTask(next.id);
}

export function startAgentWorker(gateway: McpClientManager): Worker<AgentJobData> {
  const limiter = new TokenBucketRateLimiter(redis);
  const budget = new BudgetTracker(redis);

  const worker = new Worker<AgentJobData>(
    QUEUE_NAME,
    async (job: Job<AgentJobData>) => {
      const task = await prisma.task.findUnique({
        where: { id: job.data.taskId },
        include: { agent: true, company: true },
      });
      if (!task) throw new Error(`Task ${job.data.taskId} not found`);
      if (!task.agent) throw new Error(`Task ${task.id} has no assigned agent`);
      if (
        task.status === TaskStatus.SUCCESS ||
        task.status === TaskStatus.CANCELLED ||
        task.status === TaskStatus.AWAITING_HUMAN_REVIEW
      ) {
        return; // Stale job for a task a human already resolved.
      }

      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

      await prisma.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.RUNNING,
          startedAt: task.startedAt ?? new Date(),
          attempts: { increment: 1 },
        },
      });
      await setAgentStatus(task.agent.id, AgentStatus.EXECUTING);
      await publishLog({
        companyId: task.companyId,
        taskId: task.id,
        agentId: task.agent.id,
        agentRole: task.agent.role,
        kind: LogKind.SYSTEM,
        content: `▶ Task started: ${task.title} (attempt ${task.attempts + 1})`,
      });

      try {
        const outcome = await runAgentLoop(task, task.agent, gateway, limiter, budget);

        await prisma.task.update({
          where: { id: task.id },
          data: {
            status: TaskStatus.SUCCESS,
            result: { summary: outcome.summary, artifacts: outcome.artifacts },
            endedAt: new Date(),
            error: null,
          },
        });
        await setAgentStatus(task.agent.id, AgentStatus.IDLE);
        await publishLog({
          companyId: task.companyId,
          taskId: task.id,
          agentId: task.agent.id,
          agentRole: task.agent.role,
          kind: LogKind.SYSTEM,
          content: `✔ Task complete: ${outcome.summary}`,
        });

        await dispatchNextTask(task.companyId, task.parentId);
      } catch (error) {
        if (error instanceof HumanReviewRequested) {
          await pauseForHumanReview(task, error.reason, error.question);
          return; // Deliberate pause — not a job failure.
        }
        if (error instanceof BudgetExceededError) {
          await pauseForHumanReview(
            task,
            `Monthly token budget exhausted (${error.spent}/${error.budget}). Raise the budget to resume.`,
            null,
          );
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        await publishLog({
          companyId: task.companyId,
          taskId: task.id,
          agentId: task.agent.id,
          agentRole: task.agent.role,
          kind: LogKind.ERROR,
          level: LogLevel.ERROR,
          content: `✖ Task error: ${message}`,
        });

        if (isFinalAttempt) {
          // Retries exhausted — park for a human instead of dying silently.
          await pauseForHumanReview(task, `Failed after ${job.attemptsMade + 1} attempts: ${message}`, null);
          return;
        }

        await prisma.task.update({
          where: { id: task.id },
          data: { status: TaskStatus.QUEUED, error: message },
        });
        await setAgentStatus(task.agent.id, AgentStatus.ERROR);
        throw error; // Let BullMQ schedule the backoff retry.
      }
    },
    { connection: redis, concurrency: WORKER_CONCURRENCY },
  );

  worker.on("failed", (job, error) => {
    console.error(`[agent-worker] job ${job?.id} failed:`, error.message);
  });

  return worker;
}
