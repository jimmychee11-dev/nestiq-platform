import { NextResponse, type NextRequest } from "next/server";
import { LogKind, TaskStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { enqueueTask } from "@/src/lib/queue";
import { publishLog } from "@/src/engine/agentEngine";
import { toErrorResponse } from "@/src/lib/apiError";

export const runtime = "nodejs";

const BodySchema = z.object({ instruction: z.string().max(4_000).optional() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const task = await prisma.task.findUnique({ where: { id }, include: { agent: true } });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    if (task.status !== TaskStatus.AWAITING_HUMAN_REVIEW) {
      return NextResponse.json(
        { error: `Task is ${task.status}, not AWAITING_HUMAN_REVIEW` },
        { status: 409 },
      );
    }

    const input = task.input as Record<string, unknown>;
    await prisma.task.update({
      where: { id },
      data: {
        status: TaskStatus.QUEUED,
        error: null,
        input: {
          ...input,
          humanOverride: {
            instruction: parsed.data.instruction ?? null,
            resumedAt: new Date().toISOString(),
          },
        },
      },
    });

    await publishLog({
      companyId: task.companyId,
      taskId: task.id,
      agentId: task.agentId ?? undefined,
      agentRole: task.agent?.role ?? null,
      kind: LogKind.SYSTEM,
      content: `▶ Human override received — task resumed${
        parsed.data.instruction ? `: "${parsed.data.instruction}"` : ""
      }`,
    });

    await enqueueTask(task.id);
    return NextResponse.json({ resumed: true, taskId: task.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
