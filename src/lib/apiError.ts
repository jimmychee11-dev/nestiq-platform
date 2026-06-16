import { NextResponse } from "next/server";

const DB_ERR_PATTERNS = /P1001|P1002|P1008|ECONNREFUSED|Can't reach database|connect ETIMEDOUT|PrismaClientInitializationError/;

const isVercel  = !!process.env.VERCEL;
const isProd    = process.env.NODE_ENV === "production";

function dbErrorMessage(): string {
  if (isVercel || isProd) {
    return "Database unavailable — add DATABASE_URL (Neon) and REDIS_URL (Upstash) in your Vercel environment settings, then redeploy.";
  }
  return "Database unavailable — run start-all.ps1 to boot the local stack.";
}

/** Converts any thrown error into a typed NextResponse with correct HTTP status. */
export function toErrorResponse(err: unknown): NextResponse {
  const msg  = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.constructor.name : "";

  if (DB_ERR_PATTERNS.test(msg) || DB_ERR_PATTERNS.test(name)) {
    return NextResponse.json({ error: dbErrorMessage() }, { status: 503 });
  }

  if (msg.includes("credit balance") || msg.includes("authentication_error") || msg.includes("invalid_api_key")) {
    return NextResponse.json(
      { error: "AI API error — check your ANTHROPIC_API_KEY and credit balance at console.anthropic.com" },
      { status: 402 },
    );
  }

  console.error("[API error]", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
