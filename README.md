# NestIQ — Autonomous Multi-Agent Company Operations Platform

A Polsia-inspired, multi-tenant orchestration engine: an AI **CEO** accepts
high-level business goals, decomposes them into tasks for specialist
sub-agents (Engineering, Marketing, Sales, Operations), and executes them
24/7 through **Model Context Protocol** tool servers — with a real-time
streaming dashboard per company at `/dashboard/<slug>` (e.g.
`/dashboard/nestiq-22`).

## Architecture

```
                       ┌────────────────────────────────────────────┐
  POST /goals ────────▶│  Orchestrator (AI CEO, claude-fable-5)     │
                       │  structured-output plan → Tasks table      │
                       └──────────────┬─────────────────────────────┘
                                      │ enqueue (BullMQ / Redis)
                                      ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Agent Engine  (src/worker.ts — separate Node process)       │
   │  Plan-Act-Evaluate loop per task:                            │
   │    budget check → rate-limit token bucket → model turn       │
   │    → MCP tool calls → ExecutionLog rows → repeat             │
   │  escalate_to_human / failure ⇒ AWAITING_HUMAN_REVIEW         │
   └───────┬──────────────────────────────┬───────────────────────┘
           │ tool calls                   │ publish log rows
           ▼                              ▼
   ┌───────────────────┐          ┌─────────────────────┐
   │  MCP Gateway      │          │  Redis pub/sub      │
   │  filesystem       │          │  company:<id>:logs  │
   │  sequential think │          └─────────┬───────────┘
   │  slack / resend   │                    │ SSE
   │  github           │                    ▼
   └───────────────────┘          ┌──────────────────────────────┐
                                  │  Next.js 15 dashboard        │
   ┌───────────────────┐          │  hero metrics · live console │
   │  PostgreSQL       │◀────────▶│  agent status grid           │
   │  (Prisma)         │          └──────────────────────────────┘
   └───────────────────┘
```

## Module map

| Deliverable | Path |
|---|---|
| A. Database schema | `prisma/schema.prisma` |
| B. MCP Gateway / `McpClientManager` | `src/mcp/mcpGateway.ts` (+ fleet config in `src/mcp/servers.ts`) |
| C. Agentic state-machine loop (BullMQ worker) | `src/engine/agentEngine.ts` |
| — Token-bucket rate limiter + budget tracker | `src/engine/budget.ts` |
| — AI-CEO goal decomposition | `src/engine/orchestrator.ts` |
| D. Real-time SSE stream | `app/api/companies/[id]/stream/route.ts` |
| E. Dashboard UI | `app/dashboard/[companyId]/page.tsx` |
| Goal intake API | `app/api/companies/[id]/goals/route.ts` |
| Human-override resume webhook | `app/api/tasks/[id]/resume/route.ts` |
| Metrics API | `app/api/companies/[id]/overview/route.ts` |
| Worker entrypoint | `src/worker.ts` |

## Resiliency model

- **Human-in-the-loop:** agents carry an `escalate_to_human` tool. Payment
  failures, credential problems, destructive actions, and ambiguity all pause
  the task as `AWAITING_HUMAN_REVIEW`; `POST /api/tasks/:id/resume` (with an
  optional instruction) re-queues it. Final-attempt job failures park the
  task the same way instead of dying silently.
- **Rate limiting:** atomic Redis token bucket (Lua) per company, refilled at
  `Company.modelCallsPerMinute`, checked before *every* model turn.
- **Budget:** per-company monthly token ceiling (`Company.monthlyTokenBudget`)
  enforced from a Redis counter on the hot path, with `UsageEvent` rows as
  the durable ledger. Exhaustion pauses tasks for human review.
- **MCP resiliency:** the gateway retries tool calls with exponential
  backoff, reconnects dropped transports, and converts tool-level errors
  into `is_error` tool results the model can route around.

## Model usage

All agents default to `claude-fable-5` with adaptive thinking and
`output_config.effort: "high"`. Fable 5 constraints are respected: no
`temperature`/`top_p`/`top_k`, no `budget_tokens`, no assistant prefills —
plan decomposition uses structured outputs (`output_config.format`).

## Quickstart

```bash
docker compose up -d              # Postgres + Redis
cp .env.example .env              # fill in ANTHROPIC_API_KEY (+ optional MCP creds)
npm install
npx prisma migrate dev --name init
npm run seed                      # creates company "nestiq-22" + 5 agents

npm run dev                       # terminal 1 — dashboard at :3000
npm run worker                    # terminal 2 — MCP gateway + agent engine
```

Then hand the CEO a goal and watch the console stream:

```bash
curl -X POST http://localhost:3000/api/companies/nestiq-22/goals \
  -H "Content-Type: application/json" \
  -d '{"goal": "Write a one-page launch plan to docs/launch.md and summarize it"}'
```

Dashboard: <http://localhost:3000/dashboard/nestiq-22>

## Production notes

- Encrypt `McpServer.env` at rest (KMS) before storing real credentials.
- Put the goal/resume endpoints behind auth (the `User`/`Membership` tables
  are ready for it) — they are unauthenticated in this scaffold.
- Run multiple `npm run worker` replicas for horizontal scale; BullMQ
  handles distribution, and the Redis token bucket stays correct across
  processes.
- For >1 dashboard region, swap Redis pub/sub for Redis Streams so SSE
  backfill and live tail share one cursor.
