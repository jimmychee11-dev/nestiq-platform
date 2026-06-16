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
    const company = await prisma.company.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      select: { id: true },
    });
    if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const rows = await prisma.companyFile.findMany({
      where: { companyId: company.id },
      orderBy: { updatedAt: "desc" },
      select: {
        path: true,
        mimeType: true,
        sizeBytes: true,
        updatedAt: true,
        agentRole: true,
        taskId: true,
      },
    });

    const files = rows.map((r) => ({
      name: r.path.split("/").pop() ?? r.path,
      relativePath: r.path,
      size: r.sizeBytes,
      modifiedAt: r.updatedAt.toISOString(),
      ext: r.path.split(".").pop()?.toLowerCase() ?? "",
      agentRole: r.agentRole,
      taskId: r.taskId,
      mimeType: r.mimeType,
    }));

    return NextResponse.json({ files });
  } catch (err) {
    return toErrorResponse(err);
  }
}

