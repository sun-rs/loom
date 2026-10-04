import { WorkerReplyMcpArgumentsSchema } from "@rah-os/protocol";
import {
  WorkerMcpExecution,
  mcpFailure,
  type WorkerMcpExecutionBinding,
  type McpResult,
} from "./worker-mcp-execution.ts";
/** Exactly one original Run per fresh transport. No native-session/current-Run lookup. */
export class ClaudeColdWorkerMcp {
  readonly #execution: WorkerMcpExecution;
  constructor(
    origin: string,
    fetcher: typeof fetch,
    binding: WorkerMcpExecutionBinding,
  ) {
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
    const meta = "_meta" in params ? params._meta : undefined;
    const callId =
      meta && typeof meta === "object" && "claudecode/toolUseId" in meta
        ? meta["claudecode/toolUseId"]
        : undefined;
    if (typeof callId !== "string" || !callId)
      return mcpFailure(
        "UNBOUND_CALL",
        "Missing native Claude toolUseId; no action was sent.",
      );
    return await this.#execution.call(callId, params.arguments);
  }
}
