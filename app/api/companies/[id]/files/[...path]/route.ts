import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/src/lib/db";
import { toErrorResponse } from "@/src/lib/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path: pathSegments } = await params;
  const filePath = pathSegments.join("/");

  try {
    const company = await prisma.company.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      select: { id: true },
    });
    if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const file = await prisma.companyFile.findUnique({
      where: { companyId_path: { companyId: company.id, path: filePath } },
    });
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

    return new NextResponse(file.content, {
      headers: {
        "Content-Type": file.mimeType || "text/plain",
        "Content-Disposition": `inline; filename="${file.path.split("/").pop()}"`,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
