import { Writable } from "node:stream";
import {
  WorkerMessageCheckResponseSchema,
  WorkerAcknowledgeResponseSchema,
} from "@rah-os/protocol";
import { renderWorkerReadResult } from "./worker-read-render.ts";

/** Raft SEA 1.0.18 drainInbox (677012), messageCheckCommand (729502).
 * Bounded drain and hidden ACK are structural ports. Output-before-ACK and
 * Kernel replay preserve local finite-Activation recovery; not upstream code. */
export async function drainWorkerMessages(input: {
  send(request: { path: string; body: unknown }): Promise<unknown>;
  write(text: string): Promise<void>;
  replay: boolean;
  maxRounds?: number;
  maxBytes?: number;
}): Promise<void> {
  const maxRounds = input.maxRounds ?? 50;
  const maxBytes = input.maxBytes ?? 8 * 1024 * 1024;
  if (
    !Number.isSafeInteger(maxRounds) ||
    maxRounds < 1 ||
    maxRounds > 50 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1
  )
    throw new Error("Invalid message-check budget");
  let bytes = 0;
  const deadline = Date.now() + 60_000;
  for (let round = 0; round < maxRounds; round++) {
    const page = WorkerMessageCheckResponseSchema.parse(
      await input.send({
        path: "/v1/worker/message-check",
        body: round === 0 && input.replay ? { replay: true } : {},
      }),
    );
    const text =
      renderWorkerReadResult(
        "/v1/worker/sync",
        {},
        { ...page.delivery, latestRoomSeq: page.throughSeq },
      )!
        .replaceAll(
          "No new inbox messages.",
          "No new deliveries in the current Activation.",
        )
        .replaceAll(
          "No more new inbox messages.",
          "No more deliveries in the current Activation. Later work remains queued.",
        )
        .replaceAll(
          "More messages are pending. Run `rah worker sync` again.",
          "More deliveries remain in the current Activation; continue with `rah worker message-check`.",
        ) + "\n";
    if (bytes + Buffer.byteLength(text) > maxBytes) {
      await input.write(
        "Message-check output budget reached; remaining deliveries are unacknowledged. Run `rah worker message-check` again.\n",
      );
      return;
    }
    await input.write(text);
    bytes += Buffer.byteLength(text);
    const ack = WorkerAcknowledgeResponseSchema.parse(
      await input.send({
        path: "/v1/worker/acknowledge",
        body: { throughSeq: page.delivery.cursorAfter },
      }),
    );
    if (ack.acknowledgedThrough !== page.delivery.cursorAfter)
      throw new Error("Delivery acknowledgement returned another sequence");
    if (page.delivery.cursorAfter === page.throughSeq) return;
    if (Date.now() >= deadline) break;
  }
  await input.write(
    "Message-check drain limit reached; more deliveries remain in the current Activation. Run `rah worker message-check` again.\n",
  );
}

/** Real pipes wait for the callback (including asynchronous EPIPE/backpressure).
 * Synchronous test writers remain supported; successful output never proves
 * that a model read it. Kernel replay supplies crash recovery. */
export async function writeWorkerCheckOutput(
  output: { write(text: string): unknown },
  text: string,
  timeoutMs = 10_000,
): Promise<void> {
  if (!(output instanceof Writable)) {
    await output.write(text);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error | null) => {
      if (settled) return;
      settled = true;
      error ? reject(error) : resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      output.off("error", onError);
      output.off("close", onClose);
    };
    const onError = (error: Error) => {
      cleanup();
      settle(error);
    };
    const onClose = () => {
      cleanup();
      settle(new Error("Worker output closed before delivery"));
    };
    // Timeout does not detach the pending write's listener. Its callback may
    // still fail asynchronously; that late error must remain handled.
    const timer = setTimeout(
      () =>
        settle(
          new Error("Worker output timed out; delivery was not acknowledged"),
        ),
      timeoutMs,
    );
    output.once("error", onError);
    output.once("close", onClose);
    try {
      output.write(text, (error) => {
        clearTimeout(timer);
        if (error) {
          settle(error);
          setImmediate(cleanup);
        } else {
          cleanup();
          settle();
        }
      });
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
