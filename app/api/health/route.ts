import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { redis } from "@/src/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`.then(() => "ok"),
    redis.ping().then(() => "ok"),
  ]);

  const db    = checks[0].status === "fulfilled" ? "ok" : "down";
  const cache = checks[1].status === "fulfilled" ? "ok" : "down";
  const healthy = db === "ok" && cache === "ok";

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", db, cache, ts: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
