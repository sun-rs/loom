import { createHash } from "node:crypto";
import {
  WorkerReplyMcpArgumentsSchema,
  WorkerMessagePostRequestSchema,
  WorkerMessagePostResponseSchema,
} from "@rah-os/protocol";

export type WorkerMcpBinding = {
  runAttemptId: string;
  threadId: string;
  admission: Promise<
    { kind: "accepted"; nativeTurnId: string } | { kind: "failed" }
  >;
  accessToken: string;
  isActive(): boolean;
};
export type McpResult = {
  content: { type: "text"; text: string }[];
  isError: boolean;
};
export const mcpResult = (value: unknown, isError = false): McpResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  isError,
});
const failure = (code: string, message: string) =>
  mcpResult({ error: { code, message } }, true);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Host-only original credentials. No "current Run" lookup or business queue. */
export class WorkerMcpTurns {
  readonly #bindings = new Map<
    string,
    {
      input: WorkerMcpBinding;
      closed: boolean;
      unknown: boolean;
      abort: AbortController;
      calls: Map<string, { fingerprint: string; result: Promise<McpResult> }>;
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
      unknown: false,
      abort: new AbortController(),
      calls: new Map<
        string,
        { fingerprint: string; result: Promise<McpResult> }
      >(),
    };
    this.#bindings.set(input.runAttemptId, binding);
    return () => {
      binding.closed = true;
      binding.abort.abort();
      this.#bindings.delete(input.runAttemptId);
    };
  }
  close(): void {
    this.#closed = true;
    for (const b of this.#bindings.values()) {
      b.closed = true;
      b.abort.abort();
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
      const fingerprint = JSON.stringify(parsed.data);
      const old = b.calls.get(meta.callId);
      if (old)
        return old.fingerprint === fingerprint
          ? await old.result
          : failure(
              "CALL_CONFLICT",
              "This native call already has different arguments; no new action was sent.",
            );
      if (b.unknown)
        return failure(
          "RESULT_UNKNOWN",
          "A prior write has an unknown outcome. Do not repeat it; Human verification is required.",
        );
      if (b.calls.size >= 256)
        return failure("CALL_LIMIT", "Worker call limit reached for this Run.");
      const idempotencyKey =
        "mcp:" +
        createHash("sha256")
          .update(JSON.stringify([b.input.runAttemptId, meta.callId]))
          .digest("hex");
      const { final, ...business } = parsed.data;
      const command = WorkerMessagePostRequestSchema.parse({
        ...business,
        ...(final === true ? { final: true } : {}),
        idempotencyKey,
      });
      // Install the promise before the first send so concurrent same-call retries share it.
      const result = Promise.resolve().then(async () => {
        if (this.#closed || b.closed || !b.input.isActive())
          return failure(
            "UNBOUND_CALL",
            "Original execution ended; no action was sent.",
          );
        try {
          const response = await this.#fetch(
            `${this.#origin}/v1/worker/messages/post`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${b.input.accessToken}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(command),
              signal: AbortSignal.any([
                b.abort.signal,
                AbortSignal.timeout(30_000),
              ]),
              redirect: "error",
            },
          );
          const reader = response.body?.getReader();
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          if (reader)
            for (;;) {
              const next = await reader.read();
              if (next.done) break;
              bytes += next.value.length;
              if (bytes > 8 * 1024 * 1024) {
                await reader.cancel();
                throw Error("Result too large");
              }
              chunks.push(next.value);
            }
          const value: unknown = JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          );
          if (!record(value) || response.status >= 500)
            throw Error("Unrecognized Worker result");
          if (response.ok) WorkerMessagePostResponseSchema.parse(value);
          const { readReceiptId: _receipt, ...visible } = value;
          if (
            value.state === "held" ||
            value.state === "target_confirmation_required"
          )
            return mcpResult(
              {
                ...visible,
                recovery:
                  "Saved draft, not published. Do not repeat the original post. Use the Worker CLI read/recovery commands with this wake's original turn handle before revising; MCP output does not acknowledge delivery.",
              },
              true,
            );
          // Only the application service decides publication; this facade never ACKs.
          return mcpResult(visible, !response.ok);
        } catch {
          b.unknown = true;
          return failure(
            "RESULT_UNKNOWN",
            "The original write may have committed. It was not retried. Do not repeat it; Human verification is required.",
          );
        }
      });
      b.calls.set(meta.callId, { fingerprint, result });
      return await result;
    }
    return failure(
      "UNBOUND_CALL",
      "No matching original execution is active; no action was sent.",
    );
  }
}
