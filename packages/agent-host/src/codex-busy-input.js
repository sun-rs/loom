// Structural port: Raft Computer 1.0.18, main.js RuntimeTurnState (758175),
// Codex encodeStdinMessage (759052). The private pipe/receipt envelope is RAH glue.
// Source SHA256: 20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e.
import { writeSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

export function attachCodexBusyInput({
  input,
  state,
  request,
  receipt = (frame) => writeSync(3, `${JSON.stringify(frame)}\n`),
}) {
  let buffer = "";
  let busy = false;
  let lastWritten;
  let turnReady = false;
  let toolBoundary = false;
  let terminal = false;
  const decoder = new StringDecoder("utf8");
  const respond = (id, accepted) => {
    try {
      receipt({ protocol: "rah-runtime-notice-result/v1", id, accepted });
    } catch {
      /* parent disconnected */
    }
  };
  const handle = async (line) => {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      return;
    }
    if (
      frame?.protocol !== "rah-runtime-notice/v1" ||
      typeof frame.id !== "string" ||
      frame.id.length > 64
    )
      return;
    const current = state();
    if (
      busy ||
      terminal ||
      !turnReady ||
      toolBoundary ||
      current.stopping ||
      !current.threadId ||
      !current.turnId ||
      typeof frame.text !== "string" ||
      !frame.text ||
      typeof frame.fingerprint !== "string" ||
      frame.fingerprint.length !== 64 ||
      Buffer.byteLength(
        JSON.stringify({ text: frame.text, fingerprint: frame.fingerprint }),
      ) > 5500
    ) {
      respond(frame.id, false);
      return;
    }
    if (lastWritten === frame.fingerprint) {
      respond(frame.id, true);
      return;
    }
    busy = true;
    lastWritten = frame.fingerprint;
    try {
      await request(
        "turn/steer",
        {
          threadId: current.threadId,
          expectedTurnId: current.turnId,
          input: [{ type: "text", text: frame.text }],
        },
        1000,
      );

      respond(frame.id, true);
    } catch (error) {
      // Raft records the notice on write. A missing/late RPC reply is ambiguous:
      // do not re-inject the same input; durable follow-up remains authoritative.
      if (error?.providerRejected === true) lastWritten = undefined;
      respond(frame.id, error?.providerRejected !== true);
    } finally {
      busy = false;
    }
  };
  const onData = (chunk) => {
    buffer += decoder.write(chunk);
    if (Buffer.byteLength(buffer) > 8192) {
      buffer = "";
      return;
    }
    for (;;) {
      const end = buffer.indexOf("\n");
      if (end < 0) break;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      void handle(line);
    }
  };
  input.on("data", onData);
  return {
    observe(frame) {
      if (frame.method === "turn/started" && !terminal) turnReady = true;
      if (frame.method === "turn/completed") {
        terminal = true;
        return;
      }
      const item = frame.params?.item;
      if (
        frame.method === "item/completed" &&
        [
          "commandExecution",
          "fileChange",
          "mcpToolCall",
          "collabAgentToolCall",
          "webSearch",
        ].includes(item?.type)
      ) {
        toolBoundary = true;
        return;
      }
      if (
        frame.method === "turn/started" ||
        [
          "item/agentMessage/delta",
          "item/reasoning/summaryTextDelta",
          "item/reasoning/textDelta",
        ].includes(frame.method) ||
        (frame.method === "item/started" &&
          [
            "commandExecution",
            "fileChange",
            "mcpToolCall",
            "collabAgentToolCall",
            "webSearch",
            "contextCompaction",
            "enteredReviewMode",
          ].includes(item?.type)) ||
        (frame.method === "item/completed" &&
          [
            "agentMessage",
            "reasoning",
            "contextCompaction",
            "exitedReviewMode",
          ].includes(item?.type))
      )
        toolBoundary = false;
    },
    close() {
      terminal = true;
      input.removeListener("data", onData);
      input.pause();
    },
  };
}
