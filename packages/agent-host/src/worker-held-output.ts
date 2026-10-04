import {
  MAX_RENDERED_BODY_CHARACTERS,
  SEND_HELD_AS_DRAFT_MESSAGE,
  SEND_HELD_AS_DRAFT_NEXT_ACTION,
  workerHeldSendGuidance,
} from "./worker-held-send.ts";
import { cliError, renderWorkerCliError } from "./worker-cli-error.ts";
import { writeWorkerCheckOutput } from "./worker-message-check.ts";

/** Text excerpts cannot establish receipt of omitted bodies or attachments. */
function showsCompleteMessages(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value.newerMessages) &&
    value.newerMessages.length > 0 &&
    value.newerMessages.every((event: unknown) => {
      if (!event || typeof event !== "object") return false;
      const row = event as Record<string, unknown>;
      if (
        row.type !== "message.posted" ||
        !row.payload ||
        typeof row.payload !== "object"
      )
        return false;
      const payload = row.payload as Record<string, unknown>;
      return (
        typeof payload.body === "string" &&
        payload.body.length <= MAX_RENDERED_BODY_CHARACTERS &&
        [
          payload.attachments,
          payload.attachmentIds,
          payload.attachmentComment,
        ].every(
          (value) =>
            value === undefined ||
            value === null ||
            (Array.isArray(value) && value.length === 0),
        )
      );
    })
  );
}

/** A held post stays an error; output receipt is transport proof, never Room ACK. */
export async function writeWorkerHeldResult(input: {
  result: unknown;
  jsonOutput: boolean;
  turnSuffix: string;
  prefix: string;
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  send(request: { path: string; body: unknown }): Promise<unknown>;
}): Promise<boolean> {
  if (
    !input.result ||
    typeof input.result !== "object" ||
    !("state" in input.result) ||
    input.result.state !== "held"
  )
    return false;
  const { readReceiptId, ...result } = input.result as Record<string, unknown>;
  const guidance = workerHeldSendGuidance(result, input.turnSuffix);
  if (guidance === undefined) return false;
  const errorText = (failure?: unknown) => {
    let text = "";
    renderWorkerCliError(
      {
        write: (value) => {
          text += value;
        },
      },
      cliError(
        "SEND_HELD_AS_DRAFT",
        failure === undefined
          ? SEND_HELD_AS_DRAFT_MESSAGE
          : `${SEND_HELD_AS_DRAFT_MESSAGE} Output delivery or its receipt failed; consumption remains unconfirmed. Do not repeat the original post; follow the saved draft recovery.`,
        {
          details: { held: result },
          draftSaved: true,
          effect: "draft_saved",
          outputMode: input.jsonOutput ? "json" : "text",
          retryable: false,
          suggestedNextAction: SEND_HELD_AS_DRAFT_NEXT_ACTION,
        },
      ),
    );
    return text;
  };
  let failure: unknown;
  let outputSucceeded = false;
  try {
    await writeWorkerCheckOutput(
      input.jsonOutput ? input.stderr : input.stdout,
      input.jsonOutput ? errorText() : `${input.prefix}${guidance}`,
    );
    outputSucceeded = true;
    if (
      typeof readReceiptId === "string" &&
      (input.jsonOutput || showsCompleteMessages(result))
    ) {
      const response = await input.send({
        path: "/v1/worker/read-received",
        body: { readReceiptId },
      });
      if (
        !response ||
        typeof response !== "object" ||
        !("received" in response) ||
        response.received !== true
      )
        throw new Error("Read output receipt was not accepted");
    }
  } catch (error) {
    failure = error;
  }
  if (!input.jsonOutput || (failure !== undefined && outputSucceeded)) {
    try {
      await writeWorkerCheckOutput(input.stderr, errorText(failure));
    } catch {
      // A broken diagnostic pipe cannot create consumption proof or retry a post.
    }
  }
  return true;
}
