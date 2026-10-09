import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

// Native evidence only. A driver supplies Host-captured bytes and lstat identity;
// neither diagnostics nor this collector own Room state or completion.
const MAX_STDOUT = 16 * 1024 * 1024;
const MAX_SUFFIX = 16 * 1024 * 1024;
const MAX_BODY = 65536;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const nonempty = (s) => typeof s === "string" && s.trim() !== "";
function requireProof(condition) {
  if (!condition) throw new Error("Incomplete or conflicting Codex exec proof");
}
function bytes(value) {
  requireProof(value instanceof Uint8Array);
  return Buffer.from(value);
}
function decode(value) {
  return new TextDecoder("utf-8", { fatal: true }).decode(value);
}
function rows(value) {
  requireProof(value.length > 0 && value.at(-1) === 10);
  return decode(value)
    .trimEnd()
    .split("\n")
    .map((line) => {
      requireProof(line.trim() !== "");
      const row = JSON.parse(line);
      requireProof(row && typeof row === "object" && !Array.isArray(row));
      return row;
    });
}
function one(values) {
  requireProof(values.length === 1);
  return values[0];
}
function file(snapshot) {
  requireProof(snapshot?.regular === true && snapshot.symlink === false);
  requireProof(nonempty(snapshot.device) && nonempty(snapshot.inode));
  requireProof(
    isAbsolute(snapshot.path) && resolve(snapshot.path) === snapshot.path,
  );
  return bytes(snapshot.bytes);
}
function textContent(message, kind) {
  requireProof(Array.isArray(message.content) && message.content.length > 0);
  requireProof(
    message.content.every(
      (item) => item.type === kind && typeof item.text === "string",
    ),
  );
  return message.content.map((item) => item.text).join("");
}
function nativeTurn(payload) {
  return payload.internal_chat_message_metadata_passthrough?.turn_id;
}
function inputProof(binding, evidence) {
  requireProof(
    nonempty(binding.launchId) && binding.launchId === evidence.launchId,
  );
  requireProof(nonempty(binding.model) && nonempty(binding.effort));
  requireProof(/^[a-f0-9]{64}$/.test(binding.inputSha256));
  requireProof(evidence.stdoutComplete === true);
  const stdout = bytes(evidence.stdout);
  requireProof(stdout.length <= MAX_STDOUT);
  const frames = rows(stdout);
  const sessionId = one(
    frames.filter((row) => row.type === "thread.started"),
  ).thread_id;
  requireProof(nonempty(sessionId));
  if (binding.expectedSessionId !== undefined)
    requireProof(binding.expectedSessionId === sessionId);
  const boundary = binding.rollout;
  requireProof(
    isAbsolute(boundary.root) && resolve(boundary.root) === boundary.root,
  );
  const data = file(evidence.rollout);
  const path = evidence.rollout.path;
  const rel = relative(boundary.root, path);
  requireProof(
    rel !== "" && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel),
  );
  requireProof(
    Number.isSafeInteger(boundary.byteOffset) &&
      boundary.byteOffset >= 0 &&
      boundary.byteOffset <= data.length,
  );
  const prefix = data.subarray(0, boundary.byteOffset);
  requireProof(hash(prefix) === boundary.prefixSha256);
  requireProof(prefix.length === 0 || prefix.at(-1) === 10);
  if (binding.expectedSessionId !== undefined) {
    requireProof(
      boundary.path === path &&
        boundary.device === evidence.rollout.device &&
        boundary.inode === evidence.rollout.inode,
    );
    requireProof(boundary.byteOffset > 0);
  } else {
    requireProof(boundary.path === undefined && boundary.byteOffset === 0);
    requireProof(
      Array.isArray(boundary.existingPaths) &&
        !boundary.existingPaths.includes(path),
    );
  }
  const suffixBytes = data.subarray(boundary.byteOffset);
  requireProof(suffixBytes.length <= MAX_SUFFIX);
  const suffix = rows(suffixBytes);
  // Metadata belongs to the exact bound file, never another guessed transcript.
  // Resume hashes the old prefix, but need not parse all historical tool output.
  const firstLineEnd = data.indexOf(10);
  requireProof(firstLineEnd >= 0 && firstLineEnd < MAX_SUFFIX);
  const first = one(rows(data.subarray(0, firstLineEnd + 1)));
  requireProof(first.type === "session_meta");
  const metadata = [
    first,
    ...suffix.filter((row) => row.type === "session_meta"),
  ];
  for (const row of metadata)
    requireProof(
      (row.payload?.id ?? row.payload?.session_id) === sessionId &&
        row.payload.memory_mode === "disabled",
    );
  const begun = one(
    suffix.filter(
      (row) => row.type === "event_msg" && row.payload?.type === "task_started",
    ),
  );
  const context = one(suffix.filter((row) => row.type === "turn_context"));
  const turnId = begun.payload.turn_id;
  requireProof(nonempty(turnId) && context.payload?.turn_id === turnId);
  requireProof(
    context.payload.model === binding.model &&
      context.payload.effort === binding.effort,
  );
  const users = suffix.filter(
    (row) =>
      row.type === "response_item" &&
      row.payload?.type === "message" &&
      row.payload.role === "user" &&
      row.payload.internal_chat_message_metadata_passthrough?.content_item_kinds?.includes(
        "user.text",
      ),
  );
  const user = one(users).payload;
  requireProof(
    nativeTurn(user) === turnId &&
      hash(Buffer.from(textContent(user, "input_text"))) ===
        binding.inputSha256,
  );
  requireProof(suffix.indexOf(begun) < suffix.indexOf(users[0]));
  return { sessionId, turnId, frames, suffix };
}

/** This deliberately does not require a final: a consumed failed turn must
 * still preserve its native session instead of silently starting another. */
export function proveCodexExecInput(binding, evidence) {
  try {
    const { sessionId, turnId } = inputProof(binding, evidence);
    return Object.freeze({
      sessionId,
      turnId,
      inputSha256: binding.inputSha256,
    });
  } catch {
    return undefined;
  }
}

export function createCodexExecFinalOutput(input) {
  const binding = structuredClone(input);
  let settled = false;
  let candidate;
  return {
    settle(evidence) {
      if (settled) return candidate;
      settled = true;
      try {
        requireProof(evidence.exitCode === 0 && evidence.signal === null);
        requireProof(
          binding.outputExistedBefore === false &&
            isAbsolute(binding.outputPath),
        );
        requireProof(evidence.output.path === binding.outputPath);
        const output = file(evidence.output);
        requireProof(output.length <= MAX_BODY + 2);
        const { sessionId, turnId, frames, suffix } = inputProof(
          binding,
          evidence,
        );
        requireProof(!frames.some((row) => row.type === "turn.failed"));
        const start = one(frames.filter((row) => row.type === "turn.started"));
        const completed = one(
          frames.filter((row) => row.type === "turn.completed"),
        );
        requireProof(
          frames.indexOf(start) >
            frames.findIndex((row) => row.type === "thread.started") &&
            frames.at(-1) === completed,
        );
        const done = one(
          suffix.filter(
            (row) =>
              row.type === "event_msg" && row.payload?.type === "task_complete",
          ),
        );
        requireProof(done.payload.turn_id === turnId);
        requireProof(
          !suffix.some(
            (row) =>
              row.type === "event_msg" &&
              ["error", "turn_aborted", "task_failed", "turn_failed"].includes(
                row.payload?.type,
              ),
          ),
        );
        const finalRow = one(
          suffix.filter(
            (row) =>
              row.type === "response_item" &&
              row.payload?.type === "message" &&
              row.payload.role === "assistant" &&
              row.payload.phase === "final_answer",
          ),
        );
        const final = finalRow.payload;
        for (const terminal of [final, done.payload, completed]) {
          requireProof(
            ![
              terminal.finish_reason,
              terminal.stop_reason,
              terminal.status,
            ].some((value) =>
              [
                "length",
                "max_tokens",
                "incomplete",
                "failed",
                "cancelled",
                "interrupted",
              ].includes(value),
            ),
          );
        }
        requireProof(nativeTurn(final) === turnId && nonempty(final.id));
        const text = textContent(final, "output_text");
        requireProof(text.trim() !== "" && Buffer.byteLength(text) <= MAX_BODY);
        const outputText = decode(output);
        requireProof(
          done.payload.last_agent_message === text &&
            [text, text + "\n", text + "\r\n"].includes(outputText),
        );
        const finalPosition = suffix.indexOf(finalRow);
        requireProof(
          finalPosition >
            suffix.findIndex((row) => row.type === "turn_context") &&
            finalPosition < suffix.indexOf(done),
        );
        const pending = new Set();
        for (const [index, row] of suffix.entries()) {
          const p = row.payload;
          if (row.type !== "response_item") continue;
          if (["function_call", "custom_tool_call"].includes(p?.type)) {
            requireProof(
              index < finalPosition &&
                nonempty(p.call_id) &&
                !pending.has(p.call_id),
            );
            requireProof(nativeTurn(p) === turnId);
            pending.add(p.call_id);
          } else if (
            ["function_call_output", "custom_tool_call_output"].includes(
              p?.type,
            )
          ) {
            requireProof(
              index < finalPosition &&
                nativeTurn(p) === turnId &&
                pending.delete(p.call_id),
            );
          } else if (
            p?.type?.endsWith("_call") ||
            p?.type?.endsWith("_call_output")
          ) {
            requireProof(false);
          }
        }
        requireProof(pending.size === 0);
        const matches = frames.filter(
          (row) =>
            row.type === "item.completed" &&
            row.item?.type === "agent_message" &&
            row.item.text === text,
        );
        const nativeItem = one(matches);
        requireProof(nonempty(nativeItem.item.id));
        const messages = frames.filter(
          (row) =>
            row.type === "item.completed" && row.item?.type === "agent_message",
        );
        requireProof(messages.at(-1) === nativeItem);
        const finalFramePosition = frames.indexOf(nativeItem);
        requireProof(finalFramePosition > frames.indexOf(start));
        // Codex 0.161.0 emits ServerNotification::Error while still Running;
        // only its terminal TurnStatus selects turn.completed or turn.failed.
        // Diagnostic wording is not a success signal. Admit the known event
        // shape only inside this fully proven turn, before its native final.
        for (const [index, row] of frames.entries()) {
          if (row.type !== "error") continue;
          requireProof(
            nonempty(row.message) &&
              Object.keys(row).every((key) =>
                ["type", "message"].includes(key),
              ) &&
              index > frames.indexOf(start) &&
              index < finalFramePosition,
          );
        }
        const inflight = new Set();
        for (const [index, row] of frames.entries()) {
          if (!row.type.startsWith("item.")) continue;
          requireProof(
            index > frames.indexOf(start) && index <= finalFramePosition,
          );
          const item = row.item;
          requireProof(nonempty(item?.id));
          if (row.type === "item.started") {
            requireProof(!inflight.has(item.id));
            inflight.add(item.id);
          }
          if (row.type === "item.completed") {
            // A failed business tool is terminal, not a failed native turn.
            requireProof(
              item.status === undefined ||
                item.status === "completed" ||
                (item.status === "failed" &&
                  [
                    "command_execution",
                    "file_change",
                    "mcp_tool_call",
                  ].includes(item.type)),
            );
            inflight.delete(item.id);
          }
        }
        requireProof(inflight.size === 0);
        candidate = Object.freeze({
          launchId: binding.launchId,
          sessionId,
          turnId,
          nativeMessageId: final.id,
          execItemId: nativeItem.item.id,
          text,
        });
      } catch {
        // A missing or invalid candidate never authorizes any Room mutation.
      }
      return candidate;
    },
  };
}
