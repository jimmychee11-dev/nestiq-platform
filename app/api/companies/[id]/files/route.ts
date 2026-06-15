import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/src/lib/db";
import { toErrorResponse } from "@/src/lib/apiError";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FileEntry {
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
  ext: string;
}

function walk(dir: string, root: string, out: FileEntry[]) {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, root, out);
    } else if (e.isFile()) {
      const stat = fs.statSync(full);
      out.push({
        name: e.name,
        relativePath: path.relative(root, full).replace(/\\/g, "/"),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        ext: path.extname(e.name).toLowerCase().replace(".", ""),
      });
    }
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const company = await prisma.company.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      select: { slug: true },
    });
    if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const fsRoot = process.env.MCP_FS_ROOT;
    if (!fsRoot) return NextResponse.json({ files: [] });

    const files: FileEntry[] = [];
    walk(fsRoot, fsRoot, files);
    files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

    return NextResponse.json({ files, fsRoot });
  } catch (err) {
    return toErrorResponse(err);
  }
}
