import { WorkerReplyMcpArgumentsSchema } from "@rah-os/protocol";

export type WorkerMcpBinding = {
  runAttemptId: string;
  threadId: string;
  admission: Promise<
    { kind: "accepted"; nativeTurnId: string } | { kind: "failed" }
  >;
  accessToken: string;
  isActive(): boolean;
};
export { mcpResult, type McpResult } from "./worker-mcp-execution.ts";
import {
  WorkerMcpExecution,
  mcpFailure as failure,
  type McpResult,
} from "./worker-mcp-execution.ts";
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Host-only original credentials. No "current Run" lookup or business queue. */
export class WorkerMcpTurns {
  readonly #bindings = new Map<
    string,
    {
      input: WorkerMcpBinding;
      closed: boolean;
      execution: WorkerMcpExecution;
    }
  >();
  #closed = false;
  readonly #origin: string;
  readonly #fetch: typeof fetch;
  constructor(origin: string, fetcher: typeof fetch) {
    this.#origin = origin;
    this.#fetch = fetcher;
  }

  bind(input: WorkerMcpBinding): () => void {
    if (this.#closed || this.#bindings.has(input.runAttemptId))
      throw Error("MCP binding unavailable");
    const binding = {
      input,
      closed: false,
      execution: new WorkerMcpExecution(this.#origin, this.#fetch, input),
    };
    this.#bindings.set(input.runAttemptId, binding);
    return () => {
      binding.closed = true;
      binding.execution.close();
      this.#bindings.delete(input.runAttemptId);
    };
  }
  close(): void {
    this.#closed = true;
    for (const b of this.#bindings.values()) {
      b.closed = true;
      b.execution.close();
    }
    this.#bindings.clear();
  }
  async call(params: unknown): Promise<McpResult> {
    if (!record(params) || params.name !== "loom_reply")
      return failure("INVALID_TOOL", "Unknown Worker tool");
    const parsed = WorkerReplyMcpArgumentsSchema.safeParse(params.arguments);
    if (!parsed.success)
      return failure(
        "INVALID_ARGUMENTS",
        "Use only the declared business fields; new replies require final, revisions only body and reviseDraftId.",
      );
    const meta = params._meta;
    const native = record(meta) ? meta["x-codex-turn-metadata"] : undefined;
    if (
      !record(meta) ||
      !record(native) ||
      typeof native.turn_id !== "string" ||
      !native.turn_id ||
      typeof native.thread_id !== "string" ||
      !native.thread_id ||
      native.session_id !== native.thread_id ||
      meta.threadId !== native.thread_id ||
      meta.sessionId !== native.thread_id ||
      typeof meta.callId !== "string" ||
      !meta.callId
    )
      return failure(
        "UNBOUND_CALL",
        "Missing or conflicting native execution identity; no action was sent.",
      );
    // Wait only on already registered original admissions and compare exact IDs.
    // An early call never receives credentials from a later registration.
    for (const b of [...this.#bindings.values()]) {
      if (
        this.#closed ||
        b.closed ||
        b.input.threadId !== native.thread_id ||
        !b.input.isActive()
      )
        continue;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const admission = await Promise.race([
        b.input.admission.catch(() => ({ kind: "failed" as const })),
        new Promise<{ kind: "failed" }>((resolve) => {
          timer = setTimeout(() => resolve({ kind: "failed" }), 5_000);
        }),
      ]).finally(() => clearTimeout(timer));
      if (
        admission.kind !== "accepted" ||
        admission.nativeTurnId !== native.turn_id
      )
        continue;
      if (this.#closed || b.closed || !b.input.isActive()) break;
      return await b.execution.call(meta.callId, parsed.data);
    }
    return failure(
      "UNBOUND_CALL",
      "No matching original execution is active; no action was sent.",
    );
  }
}
