// Structural port: Raft Computer 1.0.32 main.js:836632, busyDeliveryMode=direct.
// SHA256: 531f41e2ee626d729c92933fbc753008af42380c5745c54b5d0af9901e43d170.
// Native stream-json owns ordering, including tools and compaction. Receipts
// below acknowledge transport only; the Kernel retains delivery/ACK ownership.
import { randomUUID } from "node:crypto";
import { writeSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

export function attachClaudeBusyInput({
  input,
  resumedSession = false,
  session,
  write,
  receipt = (frame) => writeSync(3, `${JSON.stringify(frame)}\n`),
  // Host control frames on the same private pipe (final-reply turn end).
  control,
}) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let discarding = false;
  let terminal = false;
  let lastWritten;
  let inFlight;
  let writtenCount = 0;
  // Each written input carries a uuid chosen here, so a result that ran it
  // (alone or folded into the running turn) is attributable.
  const writtenUuids = new Set();
  const respond = (id, accepted) => {
    try {
      receipt({ protocol: "rah-runtime-notice-result/v1", id, accepted });
    } catch {
      /* disconnected parent */
    }
  };
  const admit = (line) => {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      return;
    }
    if (frame?.protocol === "rah-final-reply/v1") {
      if (!terminal) control?.(frame);
      return;
    }
    if (
      frame?.protocol !== "rah-runtime-notice/v1" ||
      typeof frame.id !== "string" ||
      frame.id.length > 64
    )
      return;
    const sessionId = session();
    if (
      !resumedSession ||
      terminal ||
      !sessionId ||
      typeof frame.text !== "string" ||
      !frame.text ||
      typeof frame.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/u.test(frame.fingerprint) ||
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
    if (inFlight) {
      respond(frame.id, false);
      return;
    }
    let settled = false;
    const uuid = randomUUID();
    const written = (error) => {
      if (settled) return;
      settled = true;
      inFlight = undefined;
      const accepted = !error && !terminal && session() === sessionId;
      if (accepted) {
        lastWritten = frame.fingerprint;
        writtenCount++;
        writtenUuids.add(uuid);
      }
      respond(frame.id, accepted);
    };
    inFlight = written;
    try {
      write(
        JSON.stringify({
          type: "user",
          uuid,
          message: {
            role: "user",
            content: [{ type: "text", text: frame.text }],
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
    for (;;) {
      const end = buffer.indexOf("\n");
      if (end < 0) break;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!discarding && Buffer.byteLength(line) <= 8192) admit(line);
      discarding = false;
    }
    if (Buffer.byteLength(buffer) > 8192) {
      buffer = "";
      discarding = true;
    }
  };
  input.on("data", onData);
  input.resume();
  const close = () => {
    terminal = true;
    inFlight?.(new Error("Claude input admission closed"));
    input.removeListener("data", onData);
    input.pause();
  };
  return {
    get writtenCount() {
      return writtenCount;
    },
    get writtenUuids() {
      return writtenUuids;
    },
    observe(frame) {
      if (frame.type === "result" || frame.type === "error") close();
    },
    close,
  };
}
