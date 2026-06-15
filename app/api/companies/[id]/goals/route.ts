/**
 * POST /api/companies/:id/goals — hand a high-level business goal to the
 * AI CEO. Body: { "goal": "Launch a waitlist landing page and email 50 leads" }
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma, withRetry } from "@/src/lib/db";
import { orchestrateGoal } from "@/src/engine/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ goal: z.string().min(8).max(4_000) });

// In-memory rate limiter: max 5 goals per IP per 60s
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 5;
const ipHits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now > entry.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Too many goals — wait 60 seconds" }, { status: 429 });
  }

  const { id } = await params;
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Body must be { goal: string }" }, { status: 400 });
  }

  const company = await withRetry(() =>
    prisma.company.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      select: { id: true },
    })
  );
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const result = await orchestrateGoal(company.id, parsed.data.goal);
  return NextResponse.json(result, { status: 202 });
}
