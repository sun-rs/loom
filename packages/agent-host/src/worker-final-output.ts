import assert from "node:assert/strict";
import {
  WorkerFinalOutputEnvelopeSchema,
  WorkerMessagePostResponseSchema,
  workerMcpPublishedReceipt,
} from "@rah-os/protocol";

/** Transport result only; AgentHost owns the Activation disposition. */
export type FinalOutputReceipt = {
  state: "published" | "held" | "unknown" | "invalid" | "rejected";
  detail: string;
};
export function parseFinalOutput(text: string) {
  assert.equal(typeof text, "string");
  assert.ok(
    Buffer.byteLength(text, "utf8") <= 65536,
    "Final output exceeds buffer",
  );
  const value: unknown = JSON.parse(text);
  const keys = new Set<string>();
  for (const match of text.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    if (
      !text
        .slice(match.index + match[0].length)
        .trimStart()
        .startsWith(":")
    )
      continue;
    const key = JSON.parse(match[0]) as string;
    assert.ok(!keys.has(key), "Duplicate final output field");
    keys.add(key);
  }
  return WorkerFinalOutputEnvelopeSchema.parse(value);
}
/** One original warm turn. Never discovers a replacement token or retries a write. */
type SubmissionInput = {
  origin: string;
  accessToken: string;
  isActive(): boolean;
  fetcher?: typeof fetch;
};
export class WorkerFinalOutput {
  readonly #input: SubmissionInput;
  readonly #abort = new AbortController();
  #submission: Promise<FinalOutputReceipt> | undefined;
  constructor(input: SubmissionInput) {
    this.#input = input;
  }
  close() {
    this.#abort.abort();
  }
  submit(text: string): Promise<FinalOutputReceipt> {
    return (this.#submission ??= this.#send(text));
  }
  async #send(text: string): Promise<FinalOutputReceipt> {
    let intent;
    try {
      intent = parseFinalOutput(text);
    } catch {
      return {
        state: "invalid",
        detail:
          "Final output was not one valid explicit room.reply command; nothing was sent.",
      };
    }
    if (this.#abort.signal.aborted || !this.#input.isActive())
      return {
        state: "rejected",
        detail: "Original execution cancelled or ended; nothing was sent.",
      };
    try {
      const response = await (this.#input.fetcher ?? fetch)(
        `${this.#input.origin}/v1/worker/messages/final-output`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            authorization: `Bearer ${this.#input.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            body: intent.body,
            basedOnRoomSeq: intent.basedOnRoomSeq,
          }),
          signal: AbortSignal.any([
            this.#abort.signal,
            AbortSignal.timeout(30_000),
          ]),
        },
      );
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (!reader) throw Error("Missing response");
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw Error("Oversized response");
        }
        chunks.push(next.value);
      }
      const raw: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (response.status >= 500) throw Error("Unknown server outcome");
      if (!response.ok)
        return {
          state: "rejected",
          detail: `Final output refused by Worker service (HTTP ${response.status}); nothing was retried.`,
        };
      const value = WorkerMessagePostResponseSchema.parse(raw);
      if ("state" in value)
        return {
          state: "held",
          detail: `Final output saved, not published: ${value.state}; draft ${value.heldDraftId}. Human recovery is required.`,
        };
      const receipt = workerMcpPublishedReceipt(value);
      return {
        state: "published",
        detail: `Published message ${receipt.messageId} at Room sequence ${receipt.roomSeq}.`,
      };
    } catch {
      return {
        state: "unknown",
        detail:
          "Final output may have committed. It was not retried; verify the Room before recovery.",
      };
    }
  }
}
export function withFinalOutputGuidance(
  input: string,
  enabled: boolean,
): string {
  return input + (enabled ? "\nReply transport: explicit final-output." : "");
}
