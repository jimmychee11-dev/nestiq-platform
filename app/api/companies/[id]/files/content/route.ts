import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/src/lib/db";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = 500_000; // 500 KB read limit

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath) return NextResponse.json({ error: "Missing path" }, { status: 400 });

  const company = await prisma.company.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    select: { slug: true },
  });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const fsRoot = process.env.MCP_FS_ROOT;
  if (!fsRoot) return NextResponse.json({ error: "No sandbox configured" }, { status: 500 });

  // Path traversal guard — resolved path must stay inside fsRoot
  const resolved = path.resolve(fsRoot, filePath);
  if (!resolved.startsWith(path.resolve(fsRoot))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const stat = fs.statSync(resolved);
  if (stat.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large to preview" }, { status: 413 });
  }

  const content = fs.readFileSync(resolved, "utf8");
  return NextResponse.json({ content, size: stat.size, modifiedAt: stat.mtime.toISOString() });
}
