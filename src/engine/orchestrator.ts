/**
 * Orchestrator — the AI CEO.
 *
 * Takes a high-level business goal, decomposes it into an ordered task plan
 * via a structured-output model call, persists the plan to the Tasks table,
 * and dispatches the first task. Subsequent tasks are dispatched by the
 * worker as each predecessor succeeds (sequential execution per goal).
 */

import { AgentRole, LogKind, TaskStatus } from "@prisma/client";
import { z } from "zod";
import { anthropic, DEFAULT_AGENT_MODEL } from "@/src/lib/anthropic";
import { businessContextPrompt, parseBusinessProfile } from "@/src/lib/businessProfile";
import { prisma } from "@/src/lib/db";
import { enqueueTask } from "@/src/lib/queue";
import { publishLog } from "./agentEngine";

const WORKER_ROLES = [
  AgentRole.ENGINEERING,
  AgentRole.MARKETING,
  AgentRole.SALES,
  AgentRole.OPERATIONS,
] as const;

const PlanSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().min(1),
        goal: z.string().min(1),
        agentRole: z.enum(["ENGINEERING", "MARKETING", "SALES", "OPERATIONS"]),
      }),
    )
    .min(1)
    .max(12),
});

// JSON Schema mirror of PlanSchema for output_config.format (the API
// guarantees the response parses; zod re-validates defensively).
const PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short imperative task title." },
          goal: {
            type: "string",
            description:
              "Complete, self-contained instructions for the sub-agent, including success criteria.",
          },
          agentRole: { type: "string", enum: [...WORKER_ROLES] },
        },
        required: ["title", "goal", "agentRole"],
        additionalProperties: false,
      },
    },
  },
  required: ["tasks"],
  additionalProperties: false,
} as const;

export interface OrchestrationResult {
  parentTaskId: string;
  taskIds: string[];
}

export async function orchestrateGoal(
  companyId: string,
  goal: string,
): Promise<OrchestrationResult> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const ceo = await prisma.agent.findUniqueOrThrow({
    where: { companyId_role: { companyId, role: AgentRole.CEO } },
  });
  const workers = await prisma.agent.findMany({
    where: { companyId, role: { in: [...WORKER_ROLES] } },
  });
  const workersByRole = new Map(workers.map((w) => [w.role, w]));

  await publishLog({
    companyId,
    agentId: ceo.id,
    agentRole: AgentRole.CEO,
    kind: LogKind.SYSTEM,
    content: `🎯 New goal received: ${goal}`,
  });

  const profile = parseBusinessProfile(company.businessProfile);

  const response = await anthropic.messages.create({
    model: ceo.model || DEFAULT_AGENT_MODEL,
    max_tokens: 16_000,
    thinking: { type: "adaptive" },
    system: [
      ceo.systemPrompt,
      "",
      `You are the AI CEO of "${company.name}". Decompose the business goal into 1-12 sequential`,
      "tasks for your sub-agents. Each task's goal must be fully self-contained — the sub-agent",
      "sees nothing but its own task.",
      "",
      "CRITICAL — Agent capabilities and tool constraints:",
      "- ENGINEERING: filesystem (read/write files to sandbox), github (if configured), sequential-thinking.",
      "  → Best for: creating files, writing code, building templates, saving documents.",
      "  → Cannot: browse web, access external APIs without credentials.",
      "- MARKETING: resend email (if configured), slack (if configured), sequential-thinking.",
      "  → Best for: drafting email content, campaign copy, messaging frameworks.",
      "  → Cannot: browse web, scrape LinkedIn, access CRMs without credentials.",
      "- SALES: resend email (if configured), slack (if configured), sequential-thinking.",
      "  → Best for: writing outreach sequences, follow-up templates, sales scripts.",
      "  → Cannot: browse web, pull live lead data, access external databases.",
      "- OPERATIONS: slack (if configured), sequential-thinking.",
      "  → Best for: strategic frameworks, process docs, SOPs, research guides.",
      "  → Cannot: browse web, access external data sources.",
      "",
      "PLANNING RULES:",
      "- Assign tasks that are achievable within each agent's tool constraints.",
      "- When data gathering from the web is needed, assign the task as 'create a template and research",
      "  guide that humans can fill in' — agents cannot scrape live data but CAN create frameworks.",
      "- Frame goals as 'produce a deliverable' not 'find data that may not be accessible'.",
      "- Order tasks so each one's prerequisites are produced by earlier tasks.",
      ...(profile ? ["", businessContextPrompt(profile)] : []),
    ].join("\n"),
    output_config: {
      format: { type: "json_schema", schema: PLAN_JSON_SCHEMA },
    },
    messages: [{ role: "user", content: goal }],
  });

  const planText = response.content.find(
    (block): block is Extract<typeof block, { type: "text" }> => block.type === "text",
  )?.text;
  if (!planText) throw new Error("CEO planning call returned no text content");
  const plan = PlanSchema.parse(JSON.parse(planText));

  // Persist plan: one parent task owned by the CEO + ordered children.
  const parent = await prisma.task.create({
    data: {
      companyId,
      agentId: ceo.id,
      title: `Goal: ${goal.slice(0, 120)}`,
      goal,
      status: TaskStatus.RUNNING,
      input: { kind: "goal", source: "api" },
    },
  });

  const taskIds: string[] = [];
  for (const [index, step] of plan.tasks.entries()) {
    const agent = workersByRole.get(step.agentRole as AgentRole);
    if (!agent) {
      throw new Error(`Plan references ${step.agentRole}, but ${company.name} has no such agent`);
    }
    const task = await prisma.task.create({
      data: {
        companyId,
        agentId: agent.id,
        parentId: parent.id,
        title: step.title,
        goal: step.goal,
        priority: index,
        status: index === 0 ? TaskStatus.QUEUED : TaskStatus.PENDING,
        input: { kind: "plan-step", planIndex: index, parentGoal: goal },
      },
    });
    taskIds.push(task.id);
    await publishLog({
      companyId,
      taskId: task.id,
      agentId: ceo.id,
      agentRole: AgentRole.CEO,
      kind: LogKind.MESSAGE,
      content: `📋 Planned task ${index + 1}/${plan.tasks.length} → [${step.agentRole}] ${step.title}`,
    });
  }

  const firstTaskId = taskIds[0];
  if (firstTaskId) await enqueueTask(firstTaskId);

  return { parentTaskId: parent.id, taskIds };
}
