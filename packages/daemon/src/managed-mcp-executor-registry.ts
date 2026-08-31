import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/client";
import type {
  ManagedMcpExecutorCall,
  ManagedMcpAdministrationPort,
  ManagedMcpExecutorPort,
} from "@rah-os/application-service";
import {
  ManagedMcpCallResultSchema,
  ManagedMcpInputSchemaSchema,
  ManagedMcpToolDefinitionSchema,
  type ManagedMcpCallResult,
  type ManagedMcpToolDefinition,
} from "@rah-os/protocol";

const REQUEST_TIMEOUT_MS = 30_000;

export type ManagedMcpExecutorConnection = Readonly<{
  bearerToken?: string;
  executorRef: string;
  url: string;
}>;

export class NodeManagedMcpExecutorRegistry
  implements ManagedMcpAdministrationPort, ManagedMcpExecutorPort
{
  readonly #connections = new Map<string, ManagedMcpExecutorConnection>();
  readonly #active = new Set<AbortController>();
  #closed = false;

  constructor(connections: readonly ManagedMcpExecutorConnection[]) {
    for (const untrusted of connections) {
      const connection = normalizeConnection(untrusted);
      if (this.#connections.has(connection.executorRef)) {
        throw new Error(
          `duplicate managed MCP executorRef: ${connection.executorRef}`,
        );
      }
      this.#connections.set(connection.executorRef, connection);
    }
  }

  async call(
    input: ManagedMcpExecutorCall,
    options: { signal: AbortSignal },
  ): Promise<ManagedMcpCallResult> {
    return await this.#withClient(
      input.executorRef,
      options.signal,
      async (client, signal) =>
        normalizeCallResult(
          await client.callTool(
            { arguments: input.arguments, name: input.toolName },
            { signal, timeout: REQUEST_TIMEOUT_MS },
          ),
        ),
    );
  }

  async discover(
    executorRef: string,
    options: { signal: AbortSignal },
  ): Promise<ManagedMcpToolDefinition[]> {
    return await this.#withClient(
      executorRef,
      options.signal,
      async (client, signal) =>
        (
          await client.listTools(undefined, {
            cacheMode: "refresh",
            signal,
            timeout: REQUEST_TIMEOUT_MS,
          })
        ).tools.map(toolDefinition),
    );
  }

  listExecutors(): Array<{
    executorRef: string;
    transportKind: "streamable-http";
  }> {
    return [...this.#connections.keys()].sort().map((executorRef) => ({
      executorRef,
      transportKind: "streamable-http",
    }));
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const controller of this.#active) controller.abort();
  }

  async #withClient<T>(
    executorRef: string,
    externalSignal: AbortSignal,
    operation: (client: Client, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.#closed)
      throw new Error("managed MCP executor registry is closed");
    const connection = this.#connections.get(executorRef);
    if (connection === undefined) {
      throw new Error(`managed MCP executor ${executorRef} is not configured`);
    }
    const controller = new AbortController();
    this.#active.add(controller);
    const signal = AbortSignal.any([externalSignal, controller.signal]);
    const client = new Client({ name: "rah-managed-mcp", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(connection.url),
      {
        requestInit: {
          ...(connection.bearerToken === undefined
            ? {}
            : {
                headers: {
                  authorization: `Bearer ${connection.bearerToken}`,
                },
              }),
          redirect: "error",
        },
      },
    );
    let failed = false;
    try {
      await client.connect(transport, { signal, timeout: REQUEST_TIMEOUT_MS });
      return await operation(client, signal);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      this.#active.delete(controller);
      try {
        await client.close();
      } catch (closeError) {
        if (!failed) throw closeError;
      }
    }
  }
}

function normalizeConnection(
  input: ManagedMcpExecutorConnection,
): ManagedMcpExecutorConnection {
  const executorRef = input.executorRef.trim();
  if (executorRef.length === 0) throw new Error("executorRef is required");
  const url = new URL(input.url);
  if (url.username !== "" || url.password !== "" || url.hash !== "") {
    throw new Error("managed MCP executor URL contains forbidden credentials");
  }
  const loopback =
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]" ||
    url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("managed MCP executor URL must use HTTPS or loopback HTTP");
  }
  if (input.bearerToken !== undefined && input.bearerToken.length === 0) {
    throw new Error("managed MCP bearer token must not be empty");
  }
  return Object.freeze({
    ...(input.bearerToken === undefined
      ? {}
      : { bearerToken: input.bearerToken }),
    executorRef,
    url: url.toString(),
  });
}

function toolDefinition(tool: Tool): ManagedMcpToolDefinition {
  const annotations = tool.annotations;
  return ManagedMcpToolDefinitionSchema.parse({
    ...(annotations === undefined
      ? {}
      : {
          annotations: {
            ...(annotations.destructiveHint === undefined
              ? {}
              : { destructiveHint: annotations.destructiveHint }),
            ...(annotations.idempotentHint === undefined
              ? {}
              : { idempotentHint: annotations.idempotentHint }),
            ...(annotations.openWorldHint === undefined
              ? {}
              : { openWorldHint: annotations.openWorldHint }),
            ...(annotations.readOnlyHint === undefined
              ? {}
              : { readOnlyHint: annotations.readOnlyHint }),
          },
        }),
    ...(tool.description === undefined
      ? {}
      : { description: tool.description }),
    inputSchema: ManagedMcpInputSchemaSchema.parse(tool.inputSchema),
    runtimeName: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    toolName: tool.name,
  });
}

function normalizeCallResult(result: CallToolResult): ManagedMcpCallResult {
  return ManagedMcpCallResultSchema.parse({
    content: result.content.map((content) => {
      if (content.type === "text") {
        return { text: content.text, type: "text" as const };
      }
      if (content.type === "image") {
        return {
          data: content.data,
          mimeType: content.mimeType,
          type: "image" as const,
        };
      }
      throw new Error(
        `managed MCP result content type ${content.type} is not supported`,
      );
    }),
    isError: result.isError === true,
    ...(result.structuredContent === undefined
      ? {}
      : { structuredContent: result.structuredContent }),
  });
}
