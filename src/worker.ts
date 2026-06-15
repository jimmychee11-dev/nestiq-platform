/**
 * Worker entrypoint — runs outside the Next.js process.
 *
 *   npm run worker
 *
 * Boots the MCP gateway, mirrors connection status into the McpServers table
 * (which feeds the dashboard's agent/integration grid), then starts the
 * BullMQ agent worker.
 */

import { McpServerStatus } from "@prisma/client";
import { validateEnv } from "@/src/lib/env";
import { prisma } from "@/src/lib/db";

validateEnv();
import { McpClientManager, type McpConnectionStatus } from "@/src/mcp/mcpGateway";
import { defaultServerConfigs } from "@/src/mcp/servers";
import { startAgentWorker } from "@/src/engine/agentEngine";

const STATUS_MAP: Record<McpConnectionStatus, McpServerStatus> = {
  connected: McpServerStatus.CONNECTED,
  disconnected: McpServerStatus.DISCONNECTED,
  error: McpServerStatus.ERROR,
};

async function syncServerStatus(name: string, status: McpConnectionStatus): Promise<void> {
  // Global registry rows (companyId = null) describe the shared fleet.
  await prisma.mcpServer.updateMany({
    where: { name, companyId: null },
    data: { status: STATUS_MAP[status], lastSeenAt: new Date() },
  });
}

async function main(): Promise<void> {
  const configs = defaultServerConfigs();
  console.log(`[worker] connecting ${configs.length} MCP server(s): ${configs.map((c) => c.name).join(", ")}`);

  const gateway = new McpClientManager({
    onStatusChange: (name, status) => {
      console.log(`[mcp] ${name} → ${status}`);
      void syncServerStatus(name, status).catch((error) =>
        console.error(`[mcp] failed to persist status for ${name}:`, error),
      );
    },
  });
  await gateway.init(configs);

  // Ensure registry rows exist so the dashboard can render the fleet.
  // (Postgres treats NULLs as distinct in unique indexes, so upsert on the
  // composite key can't target global rows — find-then-write instead.)
  for (const config of configs) {
    const transport =
      config.transport === "stdio"
        ? ("STDIO" as const)
        : config.transport === "sse"
          ? ("SSE" as const)
          : ("STREAMABLE_HTTP" as const);
    const existing = await prisma.mcpServer.findFirst({
      where: { name: config.name, companyId: null },
    });
    if (existing) {
      await prisma.mcpServer.update({
        where: { id: existing.id },
        data: { status: McpServerStatus.CONNECTED, lastSeenAt: new Date() },
      });
    } else {
      await prisma.mcpServer.create({
        data: {
          name: config.name,
          transport,
          command: config.command,
          args: config.args ?? [],
          url: config.url,
          status: McpServerStatus.CONNECTED,
          lastSeenAt: new Date(),
        },
      });
    }
  }

  console.table(gateway.statusReport());

  const worker = startAgentWorker(gateway);
  console.log("[worker] agent worker started — waiting for tasks");

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received — shutting down`);
    await worker.close();
    await gateway.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
