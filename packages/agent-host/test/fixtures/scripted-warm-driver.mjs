#!/usr/bin/env node
// SCRIPTED warm-runtime driver for InstanceRuntimePool tests. Not Codex and
// not the warm Codex driver: it speaks only the Host <-> driver envelope
// (stdin commands, fd3 `warm-runtime/v1` envelopes) and misbehaves on
// purpose according to `--mode a,b,c`:
//   never-ready          never reports ready
//   ignore-term          ignores SIGTERM and the shutdown command
//   seq-gap              skips one envelope sequence number inside the turn
//   foreign-turn         sends a frame of this run under another native turn
//   watermark            drains naming a frame the Host never received
//   overflow             writes an oversized fd3 line inside the turn
//   unattributed-usage   reports a usage notification it could not attribute
// S2-b supervision modes (the turn is accepted and never drains by itself):
//   hold                 accepts the turn, then stays silent
//   keepalive            accepts, then only transport keepalives (no progress)
//   progress             accepts, then native progress envelopes
//   tool-silent          accepts, reports one tool in flight, then silence
//   approval-wait        accepts, reports awaiting approval, then silence
//   interrupt-drains     `turn.interrupt` drains the held turn as interrupted
// `--resume-ms N` reports N as the ready's measured session resume.
import { writeSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const runtimeId = value("--runtime-id");
const hostGeneration = value("--host-generation");
const modes = new Set((value("--mode") ?? "").split(",").filter(Boolean));
let seq = 0;

function emit(type, fields = {}, skip = 0) {
  seq += 1 + skip;
  writeSync(
    3,
    `${JSON.stringify({ loom: "warm-runtime/v1", seq, runtimeId, hostGeneration, type, ...fields })}\n`,
  );
  return seq;
}

if (modes.has("ignore-term")) process.on("SIGTERM", () => undefined);
setInterval(() => undefined, 1_000);
if (!modes.has("never-ready"))
  emit("ready", {
    sessionResumeMs: args.includes("--resume-ms")
      ? Number(value("--resume-ms"))
      : null,
    threadId: "thread-scripted",
  });

const HELD = ["hold", "keepalive", "progress", "tool-silent", "approval-wait"];
let held;

createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  if (command.op === "shutdown" && !modes.has("ignore-term")) process.exit(0);
  if (command.op === "turn.interrupt" && held !== undefined) {
    if (!modes.has("interrupt-drains")) return;
    clearInterval(held.timer);
    emit("turn.drained", {
      inFlightToolCount: 0,
      lastFrameSeq: held.last,
      nativeTurnId: "nt-1",
      runAttemptId: held.runAttemptId,
      status: "interrupted",
    });
    held = undefined;
    return;
  }
  if (command.op !== "turn.begin") return;
  const runAttemptId = command.runAttemptId;
  const nativeTurnId = "nt-1";
  const frame = (fields = {}, skip = 0) =>
    emit(
      "frame",
      {
        frame: { protocol: "scripted/v1" },
        nativeTurnId,
        runAttemptId,
        ...fields,
      },
      skip,
    );
  emit("turn.accepted", { nativeTurnId, runAttemptId });
  let last = frame();
  if (HELD.some((mode) => modes.has(mode))) {
    const progress = (fields = {}) =>
      emit("progress", { nativeTurnId, runAttemptId, ...fields });
    if (modes.has("tool-silent")) progress({ toolsInFlight: 1 });
    if (modes.has("approval-wait")) progress({ awaitingApproval: true });
    held = {
      last,
      runAttemptId,
      timer: setInterval(() => {
        if (modes.has("keepalive")) emit("keepalive");
        if (modes.has("progress")) progress({ toolsInFlight: 0 });
      }, 20),
    };
    return;
  }
  if (modes.has("seq-gap")) last = frame({}, 1);
  if (modes.has("foreign-turn")) frame({ nativeTurnId: "nt-other" });
  if (modes.has("overflow")) {
    writeSync(3, "x".repeat(5 * 1024 * 1024));
    writeSync(3, "\n");
    last = frame();
  }
  if (modes.has("unattributed-usage"))
    emit("unattributed", {
      method: "thread/tokenUsage/updated",
      reason: "no_turn_id",
    });
  if (modes.has("watermark"))
    last = emit("unattributed", { method: "item/other", reason: "no_turn_id" });
  emit("turn.drained", {
    inFlightToolCount: 0,
    lastFrameSeq: last,
    nativeTurnId,
    runAttemptId,
    status: "completed",
  });
});
