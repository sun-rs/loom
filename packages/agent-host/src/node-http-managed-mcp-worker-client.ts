import {
  ManagedMcpCallRequestSchema,
  ManagedMcpCallResultSchema,
  ManagedMcpCatalogSchema,
  type ManagedMcpCallRequest,
  type ManagedMcpCallResult,
  type ManagedMcpCatalog,
} from "@rah-os/protocol";

import type { ManagedMcpWorkerClient } from "./managed-mcp-runtime-proxy.ts";

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_RESPONSE_BYTES = 512 * 1_024;
const MAX_TOKEN_BYTES = 65_536;

export type NodeHttpManagedMcpWorkerClientOptions = {
  accessToken: string;
  fetch?: typeof fetch;
  origin: string;
  timeoutMs?: number;
};

export class NodeHttpManagedMcpWorkerClient implements ManagedMcpWorkerClient {
  readonly #accessToken: string;
  readonly #fetch: typeof fetch;
  readonly #origin: string;
  readonly #timeoutMs: number;

  constructor(options: NodeHttpManagedMcpWorkerClientOptions) {
    this.#accessToken = validateToken(options.accessToken);
    this.#fetch = options.fetch ?? fetch;
    this.#origin = validateOrigin(options.origin);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive integer");
    }
  }

  async loadCatalog(): Promise<ManagedMcpCatalog> {
    return ManagedMcpCatalogSchema.parse(
      await this.#post("/v1/worker/mcp/tools", {}),
    );
  }

  async callTool(
    uncheckedRequest: ManagedMcpCallRequest,
  ): Promise<ManagedMcpCallResult> {
    return ManagedMcpCallResultSchema.parse(
      await this.#post(
        "/v1/worker/mcp/call",
        ManagedMcpCallRequestSchema.parse(uncheckedRequest),
      ),
    );
  }

  async #post(path: string, body: object): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#origin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${this.#accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new Error("managed MCP Worker endpoint is unavailable");
    }
    const payload = await readBoundedJson(response);
    if (!response.ok) {
      throw new Error(workerErrorMessage(payload, response.status));
    }
    return payload;
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const body = response.body;
  if (body === null) throw new Error("managed MCP Worker response is empty");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("managed MCP Worker response exceeds 512 KiB");
      }
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(merged));
  } catch {
    throw new Error("managed MCP Worker response is invalid JSON");
  }
}

function validateOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("managed MCP Worker origin is invalid");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (
    url.origin !== value ||
    url.username !== "" ||
    url.password !== "" ||
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
  ) {
    throw new Error(
      "managed MCP Worker origin requires HTTPS outside numeric loopback",
    );
  }
  return value;
}

function validateToken(value: string): string {
  if (
    value.length === 0 ||
    Buffer.byteLength(value) > MAX_TOKEN_BYTES ||
    /[\0\r\n]/u.test(value)
  ) {
    throw new Error("managed MCP Worker token is invalid");
  }
  return value;
}

function workerErrorMessage(value: unknown, status: number): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null &&
    "code" in value.error &&
    typeof value.error.code === "string" &&
    value.error.code.length <= 128
  ) {
    return `managed MCP Worker request failed: HTTP ${String(status)} (${value.error.code})`;
  }
  return `managed MCP Worker request failed: HTTP ${String(status)}`;
}
