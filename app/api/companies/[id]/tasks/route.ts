import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/src/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const limit  = Math.min(parseInt(url.searchParams.get("limit")  ?? "60", 10), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0",  10), 0);

  const company = await prisma.company.findFirst({
    where: { OR: [{ id }, { slug: id }] },
  });
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where: { companyId: company.id },
      include: { agent: { select: { role: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.task.count({ where: { companyId: company.id } }),
  ]);

  const taskIds = tasks.map((t) => t.id);
  const previews =
    taskIds.length > 0
      ? await prisma.executionLog.findMany({
          where: { taskId: { in: taskIds }, kind: "MESSAGE" },
          orderBy: { seq: "desc" },
          distinct: ["taskId"],
          select: { taskId: true, content: true },
        })
      : [];

  const previewMap = new Map(previews.map((p) => [p.taskId, p.content]));

  return NextResponse.json({
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      goal: t.goal.slice(0, 200),
      status: t.status,
      priority: t.priority,
      parentId: t.parentId,
      agent: t.agent ? { role: t.agent.role, name: t.agent.name } : null,
      startedAt: t.startedAt?.toISOString() ?? null,
      endedAt: t.endedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      preview: previewMap.get(t.id)?.slice(0, 400) ?? null,
    })),
    meta: { total, limit, offset },
  });
}
