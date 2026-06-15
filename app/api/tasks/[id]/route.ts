import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/src/lib/db";
import { toErrorResponse } from "@/src/lib/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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
          where: { kind: { in: ["MESSAGE", "SYSTEM", "TOOL_CALL", "TOOL_RESULT", "ERROR"] } },
          orderBy: { seq: "asc" },
          select: { id: true, seq: true, kind: true, agentRole: true, content: true, toolName: true, createdAt: true },
        },
      },
    });

    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({
      id: task.id,
      title: task.title,
      goal: task.goal,
      status: task.status,
      error: task.error,
      result: task.result,
      input: task.input,
      agent: task.agent,
      startedAt: task.startedAt?.toISOString() ?? null,
      endedAt: task.endedAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
      logs: task.executionLogs.map((l) => ({
        id: l.id, seq: l.seq, kind: l.kind, agentRole: l.agentRole,
        content: l.content, toolName: l.toolName, createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
