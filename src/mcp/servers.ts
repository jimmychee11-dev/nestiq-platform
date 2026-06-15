/**
 * Default MCP server fleet. Each entry is included only when its required
 * env vars are present, so a bare dev box still boots with the filesystem
 * and sequential-thinking servers alone.
 */

import type { McpServerConfig } from "./mcpGateway";

export function defaultServerConfigs(): McpServerConfig[] {
  const configs: McpServerConfig[] = [];

  // 1. Filesystem/code — Engineering agent's sandboxed workspace.
  const fsRoot = process.env.MCP_FS_ROOT;
  if (fsRoot) {
    configs.push({
      name: "filesystem",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", fsRoot],
    });
  }

  // 2. Sequential thinking — structured planning before execution.
  configs.push({
    name: "thinking",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
  });

  // 3. Slack — notifications + human-in-the-loop alerts.
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_TEAM_ID) {
    configs.push({
      name: "slack",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: {
        SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
        SLACK_TEAM_ID: process.env.SLACK_TEAM_ID,
      },
    });
  }

  // 4. Resend — Marketing agent's outbound email channel.
  if (process.env.RESEND_API_KEY) {
    configs.push({
      name: "resend",
      transport: "stdio",
      command: "npx",
      args: ["-y", "mcp-send-email"],
      env: { RESEND_API_KEY: process.env.RESEND_API_KEY },
    });
  }

  // 5. GitHub — Engineering agent ships code / opens PRs.
  if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
    configs.push({
      name: "github",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
      },
    });
  }

  return configs;
}

/** Which MCP servers each agent role is allowed to touch. */
export const ROLE_SERVER_ALLOWLIST: Record<string, string[]> = {
  CEO: ["thinking"],
  ENGINEERING: ["filesystem", "github", "thinking"],
  MARKETING: ["resend", "slack", "thinking"],
  SALES: ["resend", "slack", "thinking"],
  OPERATIONS: ["slack", "thinking"],
};
