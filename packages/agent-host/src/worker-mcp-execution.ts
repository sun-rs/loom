import { createHash } from "node:crypto";
import {
  WorkerReplyMcpArgumentsSchema,
  WorkerMessagePostRequestSchema,
  WorkerMessagePostResponseSchema,
  workerMcpPublishedReceipt,
} from "@rah-os/protocol";
export type McpResult = {
  content: { type: "text"; text: string }[];
  isError: boolean;
};
export const mcpResult = (value: unknown, isError = false): McpResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  isError,
});
export const mcpFailure = (code: string, message: string) =>
  mcpResult({ error: { code, message } }, true);
const failure = mcpFailure;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export type WorkerMcpExecutionBinding = {
  runAttemptId: string;
  accessToken: string;
  isActive(): boolean;
};
/** Shared mutation owner adapter. Identity must be resolved before this call. */
export class WorkerMcpExecution {
  readonly #origin: string;
  readonly #fetch: typeof fetch;
  readonly #binding: {
    input: WorkerMcpExecutionBinding;
    closed: boolean;
    unknown: boolean;
    abort: AbortController;
    calls: Map<string, { fingerprint: string; result: Promise<McpResult> }>;
  };
  constructor(
    origin: string,
    fetcher: typeof fetch,
    input: WorkerMcpExecutionBinding,
  ) {
    this.#origin = origin;
    this.#fetch = fetcher;
    this.#binding = {
      input: { ...input },
      closed: false,
      unknown: false,
      abort: new AbortController(),
      calls: new Map(),
    };
  }
  close() {
    this.#binding.closed = true;
    this.#binding.abort.abort();
  }
  async call(callId: string, args: unknown): Promise<McpResult> {
    const b = this.#binding;
    if (b.closed || !b.input.isActive())
      return failure(
        "UNBOUND_CALL",
        "Original execution ended; no action was sent.",
      );
    const parsed = WorkerReplyMcpArgumentsSchema.safeParse(args);
    if (!parsed.success)
      return failure("INVALID_ARGUMENTS", "Use only declared business fields.");
    const fingerprint = JSON.stringify(parsed.data);
    const old = b.calls.get(callId);
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
        .update(JSON.stringify([b.input.runAttemptId, callId]))
        .digest("hex");
    const { final, ...business } = parsed.data;
    const command = WorkerMessagePostRequestSchema.parse({
      ...business,
      ...(final === true ? { final: true } : {}),
      idempotencyKey,
    });
    // Install the promise before the first send so concurrent same-call retries share it.
    const result = Promise.resolve().then(async () => {
      if (b.closed || !b.input.isActive())
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
        return mcpResult(
          response.ok ? workerMcpPublishedReceipt(visible) : visible,
          !response.ok,
        );
      } catch {
        b.unknown = true;
        return failure(
          "RESULT_UNKNOWN",
          "The original write may have committed. It was not retried. Do not repeat it; Human verification is required.",
        );
      }
    });
    b.calls.set(callId, { fingerprint, result });
    return await result;
  }
}
