import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler, Server } from "@modelcontextprotocol/server";
import {
  ManagedMcpCallResultSchema,
  ManagedMcpCallRequestSchema,
  ManagedMcpCatalogSchema,
  type ManagedMcpCallRequest,
  type ManagedMcpCallResult,
  type ManagedMcpCatalog,
} from "@rah-os/protocol";

const HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = 1_024 * 1_024;
const MAX_NATIVE_MCP_TOOL_NAME_LENGTH = 48;
const SERVER_NAME_PREFIX = "rm";

export type ManagedMcpWorkerClient = {
  callTool: (request: ManagedMcpCallRequest) => Promise<ManagedMcpCallResult>;
  loadCatalog: () => Promise<ManagedMcpCatalog>;
};

export type ManagedMcpRuntimeProxyRegistration = {
  name: string;
  release: () => Promise<void>;
  url: string;
};

type Registration = {
  close: () => Promise<void>;
  nodeHandler: ReturnType<typeof toNodeHandler>;
};

export type ManagedMcpRuntimeProxyRegistryOptions = {
  createServer?: (requestListener: RequestListener) => HttpServer;
};

export class ManagedMcpRuntimeProxyRegistry {
  readonly #createServer: (requestListener: RequestListener) => HttpServer;
  readonly #registrations = new Map<string, Registration>();
  readonly #validateHost = localhostHostValidation();
  readonly #validateOrigin = localhostOriginValidation();
  #baseUrl: string | undefined;
  #closed = false;
  #closePromise: Promise<void> | undefined;
  #server: HttpServer | undefined;
  #startPromise: Promise<void> | undefined;

  constructor(options: ManagedMcpRuntimeProxyRegistryOptions = {}) {
    this.#createServer = options.createServer ?? createServer;
  }

  async register(
    client: ManagedMcpWorkerClient,
  ): Promise<ManagedMcpRuntimeProxyRegistration> {
    if (this.#closed) {
      throw new Error("managed MCP proxy registry is closed");
    }
    await this.#start();
    if (this.#closed) {
      throw new Error("managed MCP proxy registry is closed");
    }
    const token = randomBytes(32).toString("base64url");
    const handler = createMcpHandler(() => createManagedMcpServer(client));
    this.#registrations.set(token, {
      close: handler.close,
      nodeHandler: toNodeHandler(handler),
    });
    const suffix = token.replace(/[^a-zA-Z0-9]/gu, "").slice(0, 6);
    return {
      name: `${SERVER_NAME_PREFIX}${suffix}`,
      release: async () => {
        const registration = this.#registrations.get(token);
        if (registration === undefined) return;
        this.#registrations.delete(token);
        await registration.close();
      },
      url: `${this.#baseUrl!}/mcp/${token}`,
    };
  }

  async close(): Promise<void> {
    if (this.#closePromise !== undefined) {
      await this.#closePromise;
      return;
    }
    this.#closed = true;
    this.#closePromise = this.#closeAll();
    await this.#closePromise;
  }

  async #closeAll(): Promise<void> {
    await this.#startPromise?.catch(() => undefined);
    const registrations = [...this.#registrations.values()];
    this.#registrations.clear();
    await Promise.allSettled(registrations.map(({ close }) => close()));
    const server = this.#server;
    this.#server = undefined;
    this.#baseUrl = undefined;
    if (server === undefined || !server.listening) return;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async #start(): Promise<void> {
    if (this.#closed) {
      throw new Error("managed MCP proxy registry is closed");
    }
    if (this.#server !== undefined) return;
    if (this.#startPromise !== undefined) {
      await this.#startPromise;
      return;
    }
    this.#startPromise = this.#startListener();
    try {
      await this.#startPromise;
    } finally {
      this.#startPromise = undefined;
    }
  }

  async #startListener(): Promise<void> {
    const server = this.#createServer((request, response) => {
      void this.#handle(request, response).catch((error: unknown) => {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        writeJson(
          response,
          error instanceof ManagedMcpRequestTooLargeError ? 413 : 500,
          {
            error: {
              code: -32603,
              message: boundedErrorMessage(error),
            },
            id: null,
            jsonrpc: "2.0",
          },
        );
      });
    });
    server.requestTimeout = 30_000;
    server.headersTimeout = 5_000;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, HOST, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo | null;
    if (address === null) {
      server.close();
      throw new Error("managed MCP runtime proxy did not bind");
    }
    server.unref();
    this.#server = server;
    this.#baseUrl = `http://${HOST}:${address.port}`;
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (
      !this.#validateHost(request, response) ||
      !this.#validateOrigin(request, response)
    ) {
      return;
    }
    const requestUrl = new URL(request.url ?? "/", "http://managed-mcp.local");
    const token = requestUrl.pathname.startsWith("/mcp/")
      ? requestUrl.pathname.slice("/mcp/".length)
      : "";
    const registration =
      requestUrl.search === "" ? this.#registrations.get(token) : undefined;
    if (registration === undefined) {
      writeJson(response, 404, {
        error: "managed MCP runtime endpoint not found",
      });
      return;
    }
    const parsedBody =
      request.method === "POST"
        ? await readBoundedJsonBody(request)
        : undefined;
    response.setHeader("cache-control", "no-store");
    if (request.method === undefined || request.url === undefined) {
      writeJson(response, 400, { error: "invalid managed MCP request" });
      return;
    }
    await registration.nodeHandler(
      request as IncomingMessage & { method: string; url: string },
      response,
      parsedBody,
    );
  }
}

export function nativeManagedMcpToolName(
  runtimeName: string,
  toolName: string,
): string {
  const digest = createHash("sha256")
    .update(runtimeName)
    .digest("hex")
    .slice(0, 8);
  const readable = toolName.replace(/[^a-zA-Z0-9_-]+/gu, "_") || "tool";
  const prefix = `r${digest}_`;
  return `${prefix}${readable.slice(
    0,
    MAX_NATIVE_MCP_TOOL_NAME_LENGTH - prefix.length,
  )}`;
}

export function assertNoNativeManagedMcpToolNameCollisions(
  tools: ReadonlyArray<{ runtimeName: string; toolName: string }>,
): void {
  const names = new Set<string>();
  for (const tool of tools) {
    const name = nativeManagedMcpToolName(tool.runtimeName, tool.toolName);
    if (names.has(name)) {
      throw new Error(`managed MCP native tool name collision: ${name}`);
    }
    names.add(name);
  }
}

function createManagedMcpServer(client: ManagedMcpWorkerClient): Server {
  const server = new Server(
    { name: "rah-managed-mcp-runtime", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler("tools/list", async () => {
    const catalog = ManagedMcpCatalogSchema.parse(await client.loadCatalog());
    assertNoNativeManagedMcpToolNameCollisions(catalog.tools);
    return {
      tools: catalog.tools.map((tool) => ({
        ...(tool.annotations === undefined
          ? {}
          : { annotations: tool.annotations }),
        description:
          tool.description === undefined
            ? `Call ${tool.toolName} on ${tool.serverName}.`
            : `${tool.description}\n\nManaged MCP source: ${tool.serverName} / ${tool.toolName}.`,
        inputSchema: tool.inputSchema,
        name: nativeManagedMcpToolName(tool.runtimeName, tool.toolName),
        ...(tool.title === undefined ? {} : { title: tool.title }),
      })),
    };
  });
  server.setRequestHandler("tools/call", async (request) => {
    try {
      const catalog = ManagedMcpCatalogSchema.parse(await client.loadCatalog());
      assertNoNativeManagedMcpToolNameCollisions(catalog.tools);
      const tool = catalog.tools.find(
        (candidate) =>
          nativeManagedMcpToolName(
            candidate.runtimeName,
            candidate.toolName,
          ) === request.params.name,
      );
      if (tool === undefined) {
        throw new Error(
          `Managed MCP tool ${request.params.name} is not currently available to this Agent`,
        );
      }
      const callRequest = ManagedMcpCallRequestSchema.parse({
        arguments: request.params.arguments ?? {},
        expectedAssignmentVersion: tool.assignmentVersion,
        expectedConfigVersion: tool.configVersion,
        mcpServerId: tool.mcpServerId,
        toolName: tool.toolName,
      });
      return ManagedMcpCallResultSchema.parse(
        await client.callTool(callRequest),
      );
    } catch (error) {
      return toolError(error);
    }
  });
  return server;
}

function toolError(error: unknown): ManagedMcpCallResult {
  return {
    content: [{ text: boundedErrorMessage(error), type: "text" }],
    isError: true,
  };
}

async function readBoundedJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new ManagedMcpRequestTooLargeError();
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      throw new ManagedMcpRequestTooLargeError();
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks, bytes).toString("utf8");
  if (raw.length === 0) return undefined;
  return JSON.parse(raw);
}

class ManagedMcpRequestTooLargeError extends Error {
  constructor() {
    super("managed MCP runtime request is too large");
  }
}

function boundedErrorMessage(error: unknown): string {
  return (
    error instanceof Error ? error.message : "Managed MCP tool call failed"
  ).slice(0, 500);
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}
