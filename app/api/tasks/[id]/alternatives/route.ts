import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/src/lib/db";
import { anthropic } from "@/src/lib/anthropic";
import { ROLE_SERVER_ALLOWLIST } from "@/src/mcp/servers";
import { toErrorResponse } from "@/src/lib/apiError";
import type { AgentRole } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Alternative {
  title: string;
  description: string;
  instruction: string;
  effort: string;
}

const ALTERNATIVES_SCHEMA = {
  type: "object",
  properties: {
    alternatives: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          title:       { type: "string", description: "Short action title (5-8 words)." },
          description: { type: "string", description: "One sentence explaining what this approach does." },
          instruction: { type: "string", description: "Complete, precise instruction for the agent." },
          effort:      { type: "string", description: "Expected effort, e.g. 'Quick — 2 min'." },
        },
        required: ["title", "description", "instruction", "effort"],
        additionalProperties: false,
      },
    },
  },
  required: ["alternatives"],
  additionalProperties: false,
} as const;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        agent: { select: { role: true, name: true } },
        executionLogs: {
          where: { kind: { in: ["MESSAGE", "ERROR", "SYSTEM"] } },
          orderBy: { seq: "desc" },
          take: 10,
          select: { kind: true, content: true, createdAt: true },
        },
      },
    });
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const agentRole = task.agent?.role as AgentRole | undefined;
    const allowedTools = agentRole ? (ROLE_SERVER_ALLOWLIST[agentRole] ?? []) : [];

    const recentContext = task.executionLogs
      .reverse()
      .map((l) => `[${l.kind}] ${l.content.slice(0, 300)}`)
      .join("\n");

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2_000,
      system: [
        "You are an expert business operations advisor. A sub-agent hit a blocker and needs recovery options.",
        "Generate 3-4 concrete alternative approaches the agent can take RIGHT NOW with its available tools.",
        "Be specific and practical. Each instruction must be self-contained and immediately actionable.",
        "Think creatively — if the agent can't get live data, it can create templates, frameworks, guides,",
        "example structures, or process documents instead. If it should skip a step, say so explicitly.",
      ].join(" "),
      output_config: {
        format: { type: "json_schema", schema: ALTERNATIVES_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            `AGENT ROLE: ${agentRole ?? "unknown"}`,
            `AVAILABLE TOOLS: ${allowedTools.join(", ") || "sequential-thinking only"}`,
            `TASK TITLE: ${task.title}`,
            `TASK GOAL: ${task.goal}`,
            `REASON STUCK: ${task.error ?? "Agent escalated without specifying reason"}`,
            "",
            "RECENT AGENT LOGS:",
            recentContext || "(no logs)",
            "",
            "Generate 3-4 specific alternative approaches this agent can execute with its available tools.",
            "Always include one option that creates a deliverable (template/framework/doc) and one that simply skips this step.",
          ].join("\n"),
        },
      ],
    });

    const text = response.content.find((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")?.text;
    if (!text) return NextResponse.json({ error: "No response from model" }, { status: 500 });

    const parsed = JSON.parse(text) as { alternatives: Alternative[] };
    return NextResponse.json(parsed);
  } catch (err) {
    return toErrorResponse(err);
  }
}
