// Structural port: Raft Computer 1.0.18 main.js 736148 (tool batch),
// 736184/736577 (compaction/readiness), 758145 (user envelope), 768770 (flush).
// SHA256: 20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e.
// The one bounded, expiring transport request is RAH glue, not an Inbox or ACK.
import { writeSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

export function attachClaudeBusyInput({
  input,
  resumedSession = false,
  session,
  write,
  receipt = (frame) => writeSync(3, `${JSON.stringify(frame)}\n`),
}) {
  const tools = new Set();
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let pending;
  let compacting = false;
  let boundary = false;
  let terminal = false;
  let disabled = false;
  let lastWritten;
  let writing = false;
  let writtenCount = 0;
  const respond = (id, accepted) => {
    try {
      receipt({ protocol: "rah-runtime-notice-result/v1", id, accepted });
    } catch {
      /* disconnected parent */
    }
  };
  const finish = (accepted) => {
    if (!pending) return;
    const current = pending;
    pending = undefined;
    clearTimeout(current.timer);
    respond(current.id, accepted);
  };
  const flush = () => {
    const sessionId = session();
    if (
      !resumedSession ||
      !pending ||
      terminal ||
      disabled ||
      compacting ||
      tools.size ||
      !sessionId
    )
      return;
    const current = pending;
    pending = undefined;
    clearTimeout(current.timer);
    writing = true;
    let settled = false;
    const written = (error) => {
      if (settled) return;
      settled = true;
      writing = false;
      if (!error) {
        lastWritten = current.fingerprint;
        writtenCount++;
      }
      respond(current.id, !error);
    };
    try {
      write(
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [{ type: "text", text: current.text }],
          },
          session_id: sessionId,
        }) + "\n",
        written,
      );
    } catch (error) {
      written(error);
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
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        continue;
      }
      if (
        frame?.protocol !== "rah-runtime-notice/v1" ||
        typeof frame.id !== "string" ||
        frame.id.length > 64
      )
        continue;
      if (
        !resumedSession ||
        terminal ||
        disabled ||
        !session() ||
        typeof frame.text !== "string" ||
        !frame.text ||
        typeof frame.fingerprint !== "string" ||
        !/^[a-f0-9]{64}$/u.test(frame.fingerprint) ||
        Buffer.byteLength(
          JSON.stringify({ text: frame.text, fingerprint: frame.fingerprint }),
        ) > 5500
      ) {
        respond(frame.id, false);
        continue;
      }
      if (lastWritten === frame.fingerprint) {
        respond(frame.id, true);
        continue;
      }
      if (writing) {
        respond(frame.id, false);
        continue;
      }
      // Raft retains an Inbox projection until the tool boundary. Keep just
      // the latest authenticated Host snapshot across its receipt timeout;
      // retries replace it, never append a second queue. Five seconds bounds
      // stale notices if the Host stops refreshing (its normal cycle is 2.5 s).
      // Written notice is still transport-only; Worker execution rechecks ACL.
      finish(false);
      const timer = setTimeout(() => finish(false), 5000);
      timer.unref?.();
      pending = { ...frame, timer };
      if (boundary) flush();
    }
  };
  input.on("data", onData);
  // A failed resume closes the previous gate and pauses this shared stream.
  // The fresh attempt must receive/reject retries rather than silently stall.
  input.resume();
  const close = () => {
    terminal = true;
    finish(false);
    input.removeListener("data", onData);
    input.pause();
  };
  return {
    get writtenCount() {
      return writtenCount;
    },
    observe(frame) {
      if (terminal) return;
      if (
        frame.type === "assistant" ||
        frame.type === "stream_event" ||
        (frame.type === "system" && frame.status === "requesting")
      )
        boundary = false;
      if (frame.type === "result") {
        close();
        return;
      }
      if (
        frame.type === "system" &&
        frame.subtype === "status" &&
        frame.status === "compacting"
      ) {
        boundary = false;
        compacting = true;
        return;
      }
      if (frame.type === "system" && frame.subtype === "compact_boundary") {
        compacting = false;
        boundary = true;
        flush();
        return;
      }
      if (frame.type === "error") {
        disabled = true;
        finish(false);
        return;
      }
      const content = frame.message?.content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (
          frame.type === "assistant" &&
          block?.type === "tool_use" &&
          typeof block.id === "string"
        ) {
          if (tools.size >= 256) {
            disabled = true;
            finish(false);
            return;
          }
          tools.add(block.id);
        }
        if (
          frame.type === "user" &&
          block?.type === "tool_result" &&
          tools.delete(block.tool_use_id) &&
          tools.size === 0
        ) {
          boundary = true;
          flush();
        }
      }
    },
    close,
  };
}
