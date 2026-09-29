import { writeWorkerCheckOutput } from "./worker-message-check.ts";
import {
  renderWorkerReadResult,
  workerReadCommandOffersJson,
} from "./worker-read-render.ts";

/** Hidden output receipt: does not add model text or acknowledge Room/Inbox delivery. */
export async function writeWorkerReadResult(input: {
  request: { path: string; body: unknown };
  result: unknown;
  jsonOutput: boolean;
  stdout: { write(text: string): unknown };
  send(request: { path: string; body: unknown }): Promise<unknown>;
}): Promise<void> {
  const { request } = input;
  let result = input.result;
  const receipted = [
    "/v1/worker/messages/history",
    "/v1/worker/rooms/read",
  ].includes(request.path);
  let readReceiptId: string | undefined;
  if (
    receipted &&
    result !== null &&
    typeof result === "object" &&
    "readReceiptId" in result &&
    typeof result.readReceiptId === "string"
  ) {
    readReceiptId = result.readReceiptId;
    const { readReceiptId: _, ...body } = result;
    result = body;
  }
  const rendered =
    input.jsonOutput && workerReadCommandOffersJson(request.path)
      ? undefined
      : renderWorkerReadResult(request.path, request.body, result);
  const text =
    (rendered === undefined ? JSON.stringify(result) : rendered) + "\n";
  if (readReceiptId === undefined) {
    input.stdout.write(text);
    return;
  }
  await writeWorkerCheckOutput(input.stdout, text);
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
    throw new Error(
      "Read output receipt was not accepted; consumption remains unconfirmed",
    );
}
