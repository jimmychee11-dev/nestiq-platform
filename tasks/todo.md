# NestIQ Platform — Build Plan

## Plan
- [x] A. Database schema (`prisma/schema.prisma`) — multi-tenant, enums, JSONB tool I/O, FK indexes
- [x] B. MCP Gateway (`src/mcp/mcpGateway.ts`) — McpClientManager, stdio/SSE/streamable-http transports, namespaced tool registry, retry-wrapped execution
- [x] C. Agent engine (`src/engine/agentEngine.ts`) — BullMQ worker, Plan-Act-Evaluate loop on claude-fable-5, ExecutionLog persistence + Redis pub/sub, AWAITING_HUMAN_REVIEW escalation
- [x] Rate limiting + budget (`src/engine/budget.ts`) — Redis token bucket (Lua, atomic) + per-company monthly token budget
- [x] CEO orchestrator (`src/engine/orchestrator.ts`) — structured-output goal decomposition into sequential tasks
- [x] D. SSE stream route (`app/api/companies/[id]/stream/route.ts`) — backfill + live Redis pub/sub + heartbeat
- [x] E. Dashboard (`app/dashboard/[companyId]/page.tsx`) — hero metrics, live console, agent status grid
- [x] Supporting: overview API, goal intake API, human-override resume webhook, worker entrypoint, seed script, docker-compose, README

## Review
- All five deliverables (A–E) generated plus the supporting plumbing they need to actually run end-to-end.
- Model calls use `claude-fable-5` with adaptive thinking and `output_config.effort` — no `temperature`/`budget_tokens` (both 400 on Fable 5).
- VERIFIED: `npm install` clean, `prisma generate` validates the schema, `tsc --noEmit` passes with zero errors, `next build` compiles all 5 routes + dashboard successfully.
- Fixes made during verification: upgraded `@anthropic-ai/sdk` to ^0.104 (older pin predated adaptive thinking / output_config), pinned `ioredis@5.10.1` to match BullMQ's bundled copy, added the BullMQ name generic, `lazyConnect` on Redis clients, unique BullMQ jobIds for human-resume re-enqueues.
- Still required to run: live Postgres + Redis (`docker compose up -d`), `prisma migrate dev`, `npm run seed`, and `ANTHROPIC_API_KEY` in `.env`.
