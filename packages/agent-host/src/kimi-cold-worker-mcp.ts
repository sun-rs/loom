import { WorkerReplyMcpArgumentsSchema } from "@rah-os/protocol";
import {
  WorkerMcpExecution,
  mcpFailure,
  type WorkerMcpExecutionBinding,
  type McpResult,
} from "./worker-mcp-execution.ts";
/** Exactly one original Run per fresh transport. No native-session/current-Run lookup. */
export class KimiColdWorkerMcp {
  readonly #execution: WorkerMcpExecution;
  readonly #nonce: string;
  constructor(
    origin: string,
    fetcher: typeof fetch,
    binding: WorkerMcpExecutionBinding,
    transportNonce: string,
  ) {
    this.#nonce = transportNonce;
    this.#execution = new WorkerMcpExecution(origin, fetcher, binding);
  }
  close() {
    this.#execution.close();
  }
  async call(params: unknown): Promise<McpResult> {
    if (
      !params ||
      typeof params !== "object" ||
      !("name" in params) ||
      params.name !== "loom_reply" ||
      !("arguments" in params) ||
      !WorkerReplyMcpArgumentsSchema.safeParse(params.arguments).success
    )
      return mcpFailure(
        "INVALID_ARGUMENTS",
        "Use only declared business fields.",
      );
    const identity =
      "transportIdentity" in params ? params.transportIdentity : undefined;
    if (
      !identity ||
      typeof identity !== "object" ||
      !("nonce" in identity) ||
      !("requestId" in identity) ||
      identity.nonce !== this.#nonce ||
      !/^[a-f0-9-]{36}$/.test(identity.nonce) ||
      !["string", "number"].includes(typeof identity.requestId)
    )
      return mcpFailure(
        "UNBOUND_CALL",
        "Missing cold transport identity; no action was sent.",
      );
    const callId = JSON.stringify([identity.nonce, identity.requestId]);
    return await this.#execution.call(callId, params.arguments);
  }
}
