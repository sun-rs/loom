import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * Per-turn Codex driver, final-reply turn end. Real driver process, FAKE
 * app-server (no model): its turn runs one tool item (the final post), and
 * after the tool result the tool loop would request one more generation that
 * only says "sent". The Host's `rah-final-reply/v1` stdin frame must end the
 * turn at the tool boundary with a native `turn/interrupt`, and the driver
 * must treat that interrupted turn as a success.
 */
type Scenario = {
  signal?: { runAttemptId: string; turnId?: string };
  /** Send the signal only after the follow-up generation began. */
  signalAfterFollowUp?: boolean;
  rejectInterrupt?: boolean;
  /** Resume this recorded thread; the fake answers after the delay. */
  resume?: { threadId: string; delayMs: number };
  /** The Host cancels the run (SIGTERM) while the posting tool runs. */
  cancelWhileRunning?: boolean;
};

async function runTurn(scenario: Scenario) {
  const directory = mkdtempSync(join(tmpdir(), "rah-final-reply-driver-"));
  chmodSync(directory, 0o700);
  const executable = join(directory, "fake-codex.mjs");
  const record = join(directory, "record.jsonl");
  const release = join(directory, "release");
  writeFileSync(executable, fakeAppServer, { mode: 0o700 });
  try {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL("../src/codex-app-server-driver.mjs", import.meta.url),
        ),
        "--executable",
        executable,
        "--tool-access-mode",
        "full_access",
        "--prompt",
        "FAKE standing prompt",
        ...(scenario.resume === undefined
          ? []
          : ["--resume-session", scenario.resume.threadId]),
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          FAKE_RECORD: record,
          FAKE_RELEASE: release,
          FAKE_REJECT_INTERRUPT: scenario.rejectInterrupt ? "1" : "",
          FAKE_FOLLOW_UP_FIRST: scenario.signalAfterFollowUp ? "1" : "",
          FAKE_RESUME_DELAY_MS: String(scenario.resume?.delayMs ?? 0),
          RAH_RUN_ATTEMPT_ID: "run-1",
        },
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      },
    );
    let fd3 = "";
    child.stdio[3]!.on("data", (chunk: Buffer) => (fd3 += chunk.toString()));
    let stderr = "";
    child.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const closed = new Promise<number | null>((resolve) =>
      child.once("close", (code) => resolve(code)),
    );
    const records = () =>
      existsSync(record)
        ? readFileSync(record, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Record<string, unknown>)
        : [];
    await until(() =>
      records().some(
        (r) =>
          r.event ===
          (scenario.signalAfterFollowUp ? "follow-up-started" : "tool-running"),
      ),
    );
    if (scenario.signal !== undefined)
      child.stdin!.write(
        `${JSON.stringify({ protocol: "rah-final-reply/v1", ...scenario.signal })}\n`,
      );
    if (scenario.cancelWhileRunning === true) child.kill("SIGTERM");
    // Let the frame reach the driver while the posting tool is still running.
    await new Promise((resolve) => setTimeout(resolve, 100));
    writeFileSync(release, "1");
    const code = await closed;
    const frames = fd3
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    return { code, frames, records: records(), stderr };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

async function until(check: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("fake app-server did not reach the expected point");
}

const finalFrame = (frames: Record<string, unknown>[]) =>
  frames.find((frame) => frame.protocol === "rah-final-interrupt/v1");
const sessionFrame = (frames: Record<string, unknown>[]) =>
  frames.find((frame) => frame.protocol === "rah-provider-session/v1");
const interrupts = (records: Record<string, unknown>[]) =>
  records.filter((r) => r.method === "turn/interrupt");

test("final reply: the turn ends at the tool boundary with no follow-up generation and exits successfully", async () => {
  const result = await runTurn({
    signal: { runAttemptId: "run-1", turnId: "turn-1" },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.records.some((r) => r.event === "follow-up-generation"),
    false,
    "the post-reply generation never ran",
  );
  const [interrupt] = interrupts(result.records);
  assert.deepEqual(interrupt?.params, {
    threadId: "thread-1",
    turnId: "turn-1",
  });
  const toolDone = result.records.findIndex(
    (r) => r.event === "tool-completed",
  );
  assert.ok(
    result.records.indexOf(interrupt!) > toolDone,
    "the posting tool was never cut off",
  );
  assert.deepEqual(finalFrame(result.frames), {
    protocol: "rah-final-interrupt/v1",
    requested: true,
    accepted: true,
    terminal: true,
    sent: true,
    preemptedFollowUp: true,
  });
  // The session binding is still written: the next turn resumes this thread.
  assert.equal(sessionFrame(result.frames)?.providerSessionId, "thread-1");
});

test("without the final signal the turn is unchanged: the follow-up generation runs", async () => {
  const result = await runTurn({});
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.records.some((r) => r.event === "follow-up-generation"));
  assert.deepEqual(interrupts(result.records), []);
  assert.equal(finalFrame(result.frames), undefined);
});

for (const [label, signal] of [
  ["another turn id", { runAttemptId: "run-1", turnId: "turn-other" }],
  ["another RunAttempt", { runAttemptId: "run-other", turnId: "turn-1" }],
] as const)
  test(`a final signal naming ${label} never interrupts`, async () => {
    const result = await runTurn({ signal });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(interrupts(result.records), []);
    assert.ok(result.records.some((r) => r.event === "follow-up-generation"));
    assert.equal(finalFrame(result.frames), undefined);
  });

test("a rejected interrupt falls back to the unchanged turn and never fails the reply", async () => {
  const result = await runTurn({
    rejectInterrupt: true,
    signal: { runAttemptId: "run-1", turnId: "turn-1" },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(interrupts(result.records).length, 1);
  assert.ok(result.records.some((r) => r.event === "follow-up-generation"));
  assert.deepEqual(finalFrame(result.frames), {
    protocol: "rah-final-interrupt/v1",
    requested: true,
    accepted: false,
    terminal: false,
    sent: false,
    preemptedFollowUp: "unknown",
  });
  assert.equal(sessionFrame(result.frames)?.providerSessionId, "thread-1");
});

test("a signal that arrives after the follow-up began still ends the turn and records it was not preempted", async () => {
  const result = await runTurn({
    signal: { runAttemptId: "run-1", turnId: "turn-1" },
    signalAfterFollowUp: true,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(interrupts(result.records).length, 1);
  assert.equal(
    result.records.some((r) => r.event === "follow-up-generation"),
    false,
    "the interrupt aborted the follow-up before it completed",
  );
  assert.deepEqual(finalFrame(result.frames), {
    protocol: "rah-final-interrupt/v1",
    requested: true,
    accepted: true,
    terminal: true,
    sent: true,
    preemptedFollowUp: false,
  });
});

const resumeFrame = (frames: Record<string, unknown>[]) =>
  frames.filter((frame) => frame.protocol === "rah-session-resume/v1");

test("S2-b: the per-turn (cold) path reports its measured thread/resume duration", async () => {
  const result = await runTurn({
    resume: { delayMs: 120, threadId: "thread-1" },
    signal: { runAttemptId: "run-1", turnId: "turn-1" },
  });
  assert.equal(result.code, 0, result.stderr);
  const frames = resumeFrame(result.frames);
  assert.equal(frames.length, 1, "one measurement per run");
  const measured = frames[0]!.sessionResumeMs as number;
  assert.ok(Number.isInteger(measured) && measured >= 120, String(measured));
  assert.ok(measured < 5_000);
});

test("S2-b: a fresh thread (no resume) reports no session resume measurement", async () => {
  const result = await runTurn({
    signal: { runAttemptId: "run-1", turnId: "turn-1" },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(resumeFrame(result.frames), []);
});

/**
 * Full review batch 2 (drivers P2-1, contract §3): once `turn/start` accepted
 * this turn's input, the thread is bound even if the Host then cancels the
 * run, so the next Activation resumes it instead of silently starting a new
 * thread.
 */
test("session binding: a run cancelled after turn/start still reports its thread", async () => {
  const result = await runTurn({ cancelWhileRunning: true });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(sessionFrame(result.frames)?.providerSessionId, "thread-1");
});

/**
 * FAKE Codex app-server over stdio. One turn: a `commandExecution` item (the
 * final post) that runs until the test's release file exists, then — like the
 * real tool loop — one more generation that says "sent", unless the turn was
 * interrupted first. `FAKE_FOLLOW_UP_FIRST` starts that generation at once
 * and holds it open, so the Host's signal arrives mid-generation.
 */
const fakeAppServer = `#!/usr/bin/env node
import { appendFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
const record = (value) => appendFileSync(process.env.FAKE_RECORD, JSON.stringify(value) + "\\n");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const notify = (method, params) => send({ jsonrpc: "2.0", method, params: { threadId: "thread-1", turnId: "turn-1", ...params } });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let interrupted = false;
let wake = () => {};
async function runTurn() {
  notify("turn/started", { turn: { id: "turn-1" } });
  const item = { id: "post-1", type: "commandExecution" };
  notify("item/started", { item });
  record({ event: "tool-running" });
  const firstFollowUp = process.env.FAKE_FOLLOW_UP_FIRST === "1";
  if (!firstFollowUp) while (!existsSync(process.env.FAKE_RELEASE)) await delay(10);
  notify("item/completed", { item: { ...item, status: "completed" } });
  record({ event: "tool-completed" });
  if (firstFollowUp) {
    notify("item/agentMessage/delta", { itemId: "msg-2", delta: "se" });
    record({ event: "follow-up-started" });
    await new Promise((resolve) => { wake = resolve; setTimeout(resolve, 3000); });
  } else {
    await new Promise((resolve) => { wake = resolve; setTimeout(resolve, 400); });
  }
  if (!interrupted) {
    notify("item/agentMessage/delta", { itemId: "msg-2", delta: "sent" });
    notify("thread/tokenUsage/updated", { tokenUsage: { last: { inputTokens: 26000, cachedInputTokens: 25000, outputTokens: 19, reasoningOutputTokens: 0, totalTokens: 26019 }, total: { inputTokens: 26000, cachedInputTokens: 25000, outputTokens: 19, reasoningOutputTokens: 0, totalTokens: 26019 }, modelContextWindow: 200000 } });
    record({ event: "follow-up-generation" });
  }
  send({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: interrupted ? "interrupted" : "completed" } } });
}
createInterface({ input: process.stdin }).on("line", (line) => {
  const frame = JSON.parse(line);
  record({ method: frame.method, params: frame.params });
  if (frame.method === "initialize") send({ jsonrpc: "2.0", id: frame.id, result: { userAgent: "fake-codex/1" } });
  else if (frame.method === "thread/start") send({ jsonrpc: "2.0", id: frame.id, result: { thread: { id: "thread-1" } } });
  else if (frame.method === "thread/resume") setTimeout(() => send({ jsonrpc: "2.0", id: frame.id, result: { thread: { id: frame.params.threadId } } }), Number(process.env.FAKE_RESUME_DELAY_MS));
  else if (frame.method === "turn/start") {
    send({ jsonrpc: "2.0", id: frame.id, result: { turn: { id: "turn-1", status: "inProgress" } } });
    void runTurn();
  } else if (frame.method === "turn/interrupt") {
    if (process.env.FAKE_REJECT_INTERRUPT === "1") {
      send({ jsonrpc: "2.0", id: frame.id, error: { code: -32600, message: "interrupt unsupported" } });
      return;
    }
    if (frame.params.turnId === "turn-1") { interrupted = true; wake(); }
    send({ jsonrpc: "2.0", id: frame.id, result: {} });
  }
}).on("close", () => process.exit(0));
`;
