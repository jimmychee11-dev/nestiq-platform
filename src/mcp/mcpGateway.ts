/**
 * MCP Gateway — central manager for all Model Context Protocol connections.
 *
 * Responsibilities:
 *  - hold long-lived connections to N MCP servers (stdio, SSE, streamable HTTP)
 *  - flatten every server's tool list into one namespaced registry
 *    (`filesystem__read_file`, `slack__post_message`, ...)
 *  - expose that registry in Anthropic `tools` format so the reasoning model
 *    can call any tool without knowing which server backs it
 *  - wrap execution in retry + reconnect so one flaky server doesn't take
 *    down an agent loop mid-task
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type Anthropic from "@anthropic-ai/sdk";

export type McpTransportKind = "stdio" | "sse" | "streamable_http";

export interface McpServerConfig {
  /** Unique registry name; becomes the tool namespace prefix. */
  name: string;
  transport: McpTransportKind;
  /** stdio transport */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** sse / streamable_http transport */
  url?: string;
}

export interface McpToolDescriptor {
  serverName: string;
  toolName: string;
  /** `${serverName}__${toolName}` — the name the model sees. */
  namespacedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolCallResult {
  ok: boolean;
  /** Flattened text content suitable for a tool_result block. */
  content: string;
  /** Raw MCP result for audit logging (persisted as JSONB). */
  raw: unknown;
}

export type McpConnectionStatus = "connected" | "disconnected" | "error";

interface ManagedConnection {
  config: McpServerConfig;
  client: Client;
  status: McpConnectionStatus;
  tools: McpToolDescriptor[];
  lastError?: string;
}

const NAMESPACE_SEPARATOR = "__";
const CALL_MAX_ATTEMPTS = 3;
const CALL_BASE_BACKOFF_MS = 500;
const CALL_TIMEOUT_MS = 120_000;

export class McpToolError extends Error {
  constructor(
    message: string,
    public readonly serverName: string,
    public readonly toolName: string,
    public readonly attempts: number,
  ) {
    super(message);
    this.name = "McpToolError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class McpClientManager {
  private readonly connections = new Map<string, ManagedConnection>();
  private readonly onStatusChange?: (
    serverName: string,
    status: McpConnectionStatus,
  ) => void;

  constructor(options?: {
    onStatusChange?: (serverName: string, status: McpConnectionStatus) => void;
  }) {
    this.onStatusChange = options?.onStatusChange;
  }

  /**
   * Connect to every configured server. Individual failures are recorded,
   * not thrown — a company with a broken Slack server should still get its
   * filesystem tools.
   */
  async init(configs: McpServerConfig[]): Promise<void> {
    const results = await Promise.allSettled(
      configs.map((config) => this.connect(config)),
    );
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        const name = configs[i]?.name ?? "unknown";
        console.error(`[mcp-gateway] failed to connect "${name}":`, result.reason);
      }
    });
  }

  async connect(config: McpServerConfig): Promise<void> {
    await this.disconnect(config.name);

    const client = new Client({ name: "nestiq-mcp-gateway", version: "1.0.0" });
    const connection: ManagedConnection = {
      config,
      client,
      status: "disconnected",
      tools: [],
    };
    this.connections.set(config.name, connection);

    const transport = this.buildTransport(config);
    transport.onclose = () => {
      this.setStatus(connection, "disconnected");
    };
    transport.onerror = (error: Error) => {
      connection.lastError = error.message;
      this.setStatus(connection, "error");
    };

    await client.connect(transport);
    this.setStatus(connection, "connected");
    await this.refreshTools(config.name);
  }

  private buildTransport(config: McpServerConfig) {
    switch (config.transport) {
      case "stdio": {
        if (!config.command) {
          throw new Error(`MCP server "${config.name}": stdio transport requires "command"`);
        }
        return new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          // Child MCP processes need PATH etc. plus their own secrets.
          env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
        });
      }
      case "sse": {
        if (!config.url) {
          throw new Error(`MCP server "${config.name}": sse transport requires "url"`);
        }
        return new SSEClientTransport(new URL(config.url));
      }
      case "streamable_http": {
        if (!config.url) {
          throw new Error(`MCP server "${config.name}": streamable_http transport requires "url"`);
        }
        return new StreamableHTTPClientTransport(new URL(config.url));
      }
    }
  }

  async refreshTools(serverName: string): Promise<McpToolDescriptor[]> {
    const connection = this.requireConnection(serverName);
    const { tools } = await connection.client.listTools();
    connection.tools = tools.map((tool) => ({
      serverName,
      toolName: tool.name,
      namespacedName: `${serverName}${NAMESPACE_SEPARATOR}${tool.name}`,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
    return connection.tools;
  }

  /** All tools across all connected servers, namespaced. */
  listTools(allowedServers?: readonly string[]): McpToolDescriptor[] {
    const tools: McpToolDescriptor[] = [];
    for (const connection of this.connections.values()) {
      if (connection.status !== "connected") continue;
      if (allowedServers && !allowedServers.includes(connection.config.name)) continue;
      tools.push(...connection.tools);
    }
    // Deterministic order keeps the prompt-cache prefix stable across calls.
    return tools.sort((a, b) => a.namespacedName.localeCompare(b.namespacedName));
  }

  /**
   * The registry in the exact shape `tools: [...]` expects on
   * `client.messages.create()`. Trigger guidance is prepended so the model
   * knows when (not just how) to reach for each integration.
   */
  getAnthropicTools(allowedServers?: readonly string[]): Anthropic.Tool[] {
    return this.listTools(allowedServers).map((tool) => ({
      name: tool.namespacedName,
      description: `[${tool.serverName} MCP] ${tool.description}`,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    }));
  }

  isGatewayTool(name: string): boolean {
    return this.resolve(name) !== undefined;
  }

  private resolve(
    namespacedName: string,
  ): { connection: ManagedConnection; toolName: string } | undefined {
    const sep = namespacedName.indexOf(NAMESPACE_SEPARATOR);
    if (sep <= 0) return undefined;
    const serverName = namespacedName.slice(0, sep);
    const toolName = namespacedName.slice(sep + NAMESPACE_SEPARATOR.length);
    const connection = this.connections.get(serverName);
    if (!connection) return undefined;
    return { connection, toolName };
  }

  /**
   * Execute a namespaced tool with retry + reconnect. Tool-level errors
   * (isError results) are returned to the model, not thrown — the model is
   * usually able to adapt. Transport errors retry, then throw McpToolError.
   */
  async callTool(
    namespacedName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    const resolved = this.resolve(namespacedName);
    if (!resolved) {
      return {
        ok: false,
        content: `Unknown tool "${namespacedName}". It may belong to a disconnected MCP server.`,
        raw: null,
      };
    }
    const { connection, toolName } = resolved;

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= CALL_MAX_ATTEMPTS; attempt++) {
      try {
        if (connection.status !== "connected") {
          await this.connect(connection.config);
        }
        const result = await connection.client.callTool(
          { name: toolName, arguments: args },
          undefined,
          { timeout: CALL_TIMEOUT_MS },
        );
        return {
          ok: result.isError !== true,
          content: flattenContent(result.content),
          raw: result,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        connection.lastError = lastError.message;
        this.setStatus(connection, "error");
        if (attempt < CALL_MAX_ATTEMPTS) {
          const backoff =
            CALL_BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * 250;
          await sleep(backoff);
        }
      }
    }

    throw new McpToolError(
      `Tool "${namespacedName}" failed after ${CALL_MAX_ATTEMPTS} attempts: ${lastError?.message}`,
      connection.config.name,
      toolName,
      CALL_MAX_ATTEMPTS,
    );
  }

  statusReport(): Array<{ name: string; status: McpConnectionStatus; tools: number; lastError?: string }> {
    return [...this.connections.values()].map((connection) => ({
      name: connection.config.name,
      status: connection.status,
      tools: connection.tools.length,
      lastError: connection.lastError,
    }));
  }

  async disconnect(serverName: string): Promise<void> {
    const existing = this.connections.get(serverName);
    if (!existing) return;
    try {
      await existing.client.close();
    } catch {
      // Already dead — nothing to clean up.
    }
    this.connections.delete(serverName);
  }

  async close(): Promise<void> {
    await Promise.allSettled(
      [...this.connections.keys()].map((name) => this.disconnect(name)),
    );
  }

  private requireConnection(serverName: string): ManagedConnection {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`MCP server "${serverName}" is not registered`);
    }
    return connection;
  }

  private setStatus(connection: ManagedConnection, status: McpConnectionStatus): void {
    if (connection.status === status) return;
    connection.status = status;
    this.onStatusChange?.(connection.config.name, status);
  }
}

/** MCP content blocks → single string for the model's tool_result. */
function flattenContent(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content ?? null);
  return content
    .map((block: { type?: string; text?: string; [key: string]: unknown }) => {
      if (block.type === "text" && typeof block.text === "string") return block.text;
      return JSON.stringify(block);
    })
    .join("\n");
}
