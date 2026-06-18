/**
 * SSE stream of ExecutionLogs for one company.
 * GET /api/companies/:id/stream  (:id accepts company id OR slug)
 *
 * 1. Backfill — 100 recent logs replay immediately so console isn't blank.
 * 2. Live — new logs published on the Redis channel forward in real-time.
 * 3. Heartbeat — `: ping` every 15s keeps proxies from closing idle connections.
 * 4. Self-healing — if DB/Redis is down, sends an SSE error event instead of crashing.
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/src/lib/db";
import { createSubscriber, logChannel } from "@/src/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKFILL_LIMIT = 100;
const HEARTBEAT_MS = 15_000;
const encoder = new TextEncoder();

function sse(data: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}
function sseError(message: string): Uint8Array {
  return encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  // DB lookup — if DB is down, return a self-healing SSE stream that
  // sends an error event and auto-closes instead of crashing.
  let companyId: string;
  try {
    const company = await prisma.company.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      select: { id: true },
    });
    if (!company) {
      return new Response(JSON.stringify({ error: "Company not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    companyId = company.id;
  } catch {
    const errStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sseError(
          process.env.VERCEL
            ? "Database unavailable — check Supabase project status and DATABASE_URL in Vercel"
            : "Database unavailable — run start-all.ps1"
        ));
        controller.close();
      },
    });
    return new Response(errStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  const subscriber = createSubscriber();
  const channel = logChannel(companyId);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        subscriber.unsubscribe(channel).catch(() => undefined);
        subscriber.quit().catch(() => undefined);
        try { controller.close(); } catch { /* already closed */ }
      };
      request.signal.addEventListener("abort", cleanup);

      // 1. Backfill
      try {
        const recent = await prisma.executionLog.findMany({
          where: { companyId },
          orderBy: { seq: "desc" },
          take: BACKFILL_LIMIT,
        });
        for (const row of recent.reverse()) {
          controller.enqueue(sse({
            id: row.id, seq: row.seq, createdAt: row.createdAt.toISOString(),
            kind: row.kind, level: row.level, agentRole: row.agentRole,
            content: row.content, toolName: row.toolName,
          }));
        }
      } catch {
        controller.enqueue(sseError("Backfill unavailable — DB starting up"));
      }

      // 2. Live tail
      try {
        subscriber.on("message", (incomingChannel: string, message: string) => {
          if (closed || incomingChannel !== channel) return;
          controller.enqueue(encoder.encode(`data: ${message}\n\n`));
        });
        await subscriber.subscribe(channel);
      } catch {
        controller.enqueue(sseError("Redis unavailable — live feed disabled"));
      }

      // 3. Heartbeat
      heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(": ping\n\n")); }
        catch { cleanup(); }
      }, HEARTBEAT_MS);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      subscriber.quit().catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
