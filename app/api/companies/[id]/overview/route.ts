import { NextResponse, type NextRequest } from "next/server";
import { McpServerStatus, TaskStatus } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { toErrorResponse } from "@/src/lib/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const THROUGHPUT_DAYS = 14;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  try {
    const company = await prisma.company.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      include: { agents: { orderBy: { role: "asc" } } },
    });
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const since = new Date(Date.now() - THROUGHPUT_DAYS * 24 * 3600 * 1000);
    const [tasksCompleted, tasksRunning, awaitingReview, connectedServers, recentSuccesses] =
      await Promise.all([
        prisma.task.count({ where: { companyId: company.id, status: TaskStatus.SUCCESS } }),
        prisma.task.count({
          where: { companyId: company.id, status: { in: [TaskStatus.RUNNING, TaskStatus.QUEUED] } },
        }),
        prisma.task.count({
          where: { companyId: company.id, status: TaskStatus.AWAITING_HUMAN_REVIEW },
        }),
        prisma.mcpServer.count({
          where: {
            status: McpServerStatus.CONNECTED,
            OR: [{ companyId: company.id }, { companyId: null }],
          },
        }),
        prisma.task.findMany({
          where: { companyId: company.id, status: TaskStatus.SUCCESS, endedAt: { gte: since } },
          select: { endedAt: true },
        }),
      ]);

    const throughput: Array<{ day: string; tasks: number }> = [];
    for (let i = THROUGHPUT_DAYS - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 3600 * 1000);
      const day = date.toISOString().slice(0, 10);
      throughput.push({
        day: day.slice(5),
        tasks: recentSuccesses.filter((t) => t.endedAt?.toISOString().slice(0, 10) === day).length,
      });
    }

    const activeAgents = company.agents.filter(
      (a) => a.status === "EXECUTING" || a.status === "PLANNING",
    ).length;

    return NextResponse.json({
      company: {
        id: company.id,
        slug: company.slug,
        name: company.name,
        arrCents: Number(company.arrCents),
      },
      metrics: { tasksCompleted, tasksRunning, awaitingReview, activeAgents, connectedServers },
      throughput,
      agents: company.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        status: agent.status,
        model: agent.model,
        lastActiveAt: agent.lastActiveAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
