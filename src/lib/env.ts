/**
 * Validates required environment variables at startup.
 * Import this module once in worker.ts / next.config.ts to catch misconfigs early.
 */

const REQUIRED: Record<string, string> = {
  DATABASE_URL: "Postgres connection string (pglite or real Postgres)",
  REDIS_URL: "Redis connection string (e.g. redis://127.0.0.1:6379)",
  ANTHROPIC_API_KEY: "Anthropic API key — get one at console.anthropic.com",
};

const OPTIONAL: Record<string, string> = {
  MCP_FS_ROOT: "Sandbox root for agent file output (default: /nestiq-sandbox)",
  AGENT_MODEL: "Claude model for agent execution (default: claude-opus-4-8)",
  DASHBOARD_TOKEN: "Optional token to enable dashboard auth",
};

export function validateEnv(): void {
  const missing: string[] = [];
  for (const [key, description] of Object.entries(REQUIRED)) {
    if (!process.env[key]) {
      missing.push(`  ${key}  — ${description}`);
    }
  }
  if (missing.length > 0) {
    console.error("\n[NestIQ] Missing required environment variables:\n" + missing.join("\n"));
    console.error("\nCopy .env.example to .env and fill in the values.\n");
    process.exit(1);
  }

  // Warn (don't exit) for common misconfiguration
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  if (key.length < 20 || key.includes("your_key") || key.includes("PASTE")) {
    console.warn("[NestIQ] WARNING: ANTHROPIC_API_KEY looks like a placeholder — agents will fail.");
  }

  if (process.env.NODE_ENV !== "production") {
    const optMissing = Object.keys(OPTIONAL).filter((k) => !process.env[k]);
    if (optMissing.length > 0) {
      console.log(`[NestIQ] Optional env vars not set (defaults apply): ${optMissing.join(", ")}`);
    }
  }
}
