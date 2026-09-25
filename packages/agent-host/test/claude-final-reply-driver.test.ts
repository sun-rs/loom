import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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
 * S2-c1 per-turn Claude driver. Real driver process, FAKE Claude stream-json
 * CLI (`fixtures/fake-claude-stream.mjs`, no model).
 *
 * Acceptance: the driver stamps the wake input with a fresh uuid; only the
 * replay echo of THAT uuid carrying exactly that text is this turn's
 * acceptance (`rah-delivery-accepted/v1` with the wake's SHA-256). A resumed
 * session's earlier message with the same text, or an echo under another
 * uuid, never is.
 *
 * Final reply: the Host's `rah-final-reply/v1` stdin frame ends the turn at
 * the tool boundary with the native stream-json `control_request`
 * `interrupt`; the interrupted turn is a success.
 */
type Scenario = {
  wake?: string;
  signal?: { runAttemptId: string; turnId?: string | "accepted" };
  signalAfterFollowUp?: boolean;
  rejectInterrupt?: boolean;
  resume?: string;
  env?: Record<string, string>;
};

const FAKE = fileURLToPath(
  new URL("./fixtures/fake-claude-stream.mjs", import.meta.url),
);
const DRIVER = fileURLToPath(
  new URL("../src/claude-stream-json-driver.mjs", import.meta.url),
);

async function runTurn(scenario: Scenario) {
  const directory = mkdtempSync(join(tmpdir(), "rah-claude-final-"));
  chmodSync(directory, 0o700);
  const record = join(directory, "record.jsonl");
  const release = join(directory, "release");
  const wakePath = join(directory, "wake.md");
  const executable = join(directory, "fake-claude.mjs");
  writeFileSync(executable, readFileSync(FAKE), { mode: 0o700 });
  if (scenario.wake !== undefined)
    writeFileSync(wakePath, scenario.wake, { mode: 0o600 });
  try {
    const child = spawn(
      process.execPath,
      [
        DRIVER,
        "--executable",
        executable,
        "--tool-access-mode",
        "full_access",
        "--prompt",
        "FAKE standing prompt",
        ...(scenario.resume === undefined
          ? []
          : ["--resume-session", scenario.resume]),
        ...(scenario.wake === undefined ? [] : ["--wake-input-file", wakePath]),
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          FAKE_RECORD: record,
          FAKE_RELEASE: release,
          FAKE_REJECT_INTERRUPT: scenario.rejectInterrupt ? "1" : "",
          FAKE_FOLLOW_UP_FIRST: scenario.signalAfterFollowUp ? "1" : "",
          RAH_RUN_ATTEMPT_ID: "run-1",
          ...scenario.env,
        },
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      },
    );
    let fd3 = "";
    child.stdio[3]!.on("data", (chunk: Buffer) => (fd3 += chunk.toString()));
    let stderr = "";
    child.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdout!.resume();
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
    const frames = () =>
      fd3
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    const reached = scenario.signalAfterFollowUp
      ? "follow-up-started"
      : scenario.env?.FAKE_TOOL === "none"
        ? "turn-started"
        : "tool-running";
    await until(
      () =>
        records().some((r) => r.kind === reached) || child.exitCode !== null,
    );
    if (scenario.signal !== undefined) {
      const turnId =
        scenario.signal.turnId === "accepted"
          ? (records().find((r) => r.kind === "input")?.uuid as string)
          : scenario.signal.turnId;
      child.stdin!.write(
        `${JSON.stringify({
          protocol: "rah-final-reply/v1",
          runAttemptId: scenario.signal.runAttemptId,
          ...(turnId === undefined ? {} : { turnId }),
        })}\n`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    writeFileSync(release, "1");
    const code = await closed;
    return { code, frames: frames(), records: records(), stderr };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

async function until(check: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("fake Claude did not reach the expected point");
}

const byProtocol = (frames: Record<string, unknown>[], protocol: string) =>
  frames.filter((frame) => frame.protocol === protocol);
const interrupts = (records: Record<string, unknown>[]) =>
  records.filter((r) => r.kind === "control" && r.subtype === "interrupt");
const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

const WAKE =
  '#main seq 7 msg=0123abcd @human: build?\nReply: message-post --target "#main" --based-on-room-seq 7 --final · no reply needed: message-check';

test("acceptance: the replay echo of this turn's uuid and exact text is reported with the wake SHA-256", async () => {
  const result = await runTurn({ wake: WAKE, env: { FAKE_TOOL: "none" } });
  assert.equal(result.code, 0, result.stderr);
  const input = result.records.find((r) => r.kind === "input")!;
  assert.equal(input.text, WAKE, "the wake file is the whole turn input");
  assert.match(String(input.uuid), /^[0-9a-f-]{36}$/u);
  const [acceptance, ...extra] = byProtocol(
    result.frames,
    "rah-delivery-accepted/v1",
  );
  assert.deepEqual(extra, []);
  assert.deepEqual(acceptance, {
    protocol: "rah-delivery-accepted/v1",
    provider: "claude-stream-json/v1",
    signal: "replay-user-message",
    threadId: "claude-session-1",
    turnId: input.uuid,
    inputSha256: sha256(WAKE),
  });
});

test("acceptance: a resumed session's earlier message with the same text is never this turn's acceptance", async () => {
  const result = await runTurn({
    wake: WAKE,
    resume: "claude-session-old",
    env: { FAKE_TOOL: "none", FAKE_HISTORY_REPLAY: "1" },
  });
  assert.equal(result.code, 0, result.stderr);
  const input = result.records.find((r) => r.kind === "input")!;
  const accepted = byProtocol(result.frames, "rah-delivery-accepted/v1");
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]!.turnId, input.uuid);
  assert.notEqual(accepted[0]!.turnId, "11111111-1111-4111-8111-111111111111");
});

for (const variant of ["mismatch", "absent"] as const)
  test(`acceptance: an echo with ${variant === "mismatch" ? "another" : "no"} uuid registers no delivery acceptance`, async () => {
    const result = await runTurn({
      wake: WAKE,
      env: { FAKE_TOOL: "none", FAKE_REPLAY_UUID: variant },
    });
    assert.deepEqual(byProtocol(result.frames, "rah-delivery-accepted/v1"), []);
    if (variant === "mismatch") {
      // The input was never proven accepted: the turn fails closed.
      assert.equal(result.code, 1);
      assert.match(result.stderr, /without replaying the submitted input/u);
    } else {
      // An older CLI that echoes no uuid keeps the text-only liveness check.
      assert.equal(result.code, 0, result.stderr);
    }
  });

test("acceptance: the fixed startup wake (no wake file) reports no delivery acceptance", async () => {
  const result = await runTurn({ env: { FAKE_TOOL: "none" } });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(byProtocol(result.frames, "rah-delivery-accepted/v1"), []);
  const input = result.records.find((r) => r.kind === "input")!;
  assert.match(String(input.text), /message-check --startup/u);
});

test("final reply: the turn ends at the tool boundary with the native interrupt and no follow-up generation", async () => {
  const result = await runTurn({
    wake: WAKE,
    signal: { runAttemptId: "run-1", turnId: "accepted" },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.records.some((r) => r.kind === "follow-up-generation"),
    false,
    "the post-reply generation never ran",
  );
  const [interrupt, ...more] = interrupts(result.records);
  assert.deepEqual(more, []);
  assert.equal(
    (interrupt!.request as { subtype: string }).subtype,
    "interrupt",
  );
  const toolDone = result.records.findIndex((r) => r.kind === "tool-completed");
  assert.ok(
    result.records.indexOf(interrupt!) > toolDone,
    "the posting tool was never cut off",
  );
  assert.deepEqual(byProtocol(result.frames, "rah-final-interrupt/v1"), [
    {
      protocol: "rah-final-interrupt/v1",
      requested: true,
      accepted: true,
      terminal: true,
      sent: true,
      preemptedFollowUp: true,
    },
  ]);
  assert.equal(
    byProtocol(result.frames, "rah-provider-session/v1")[0]?.providerSessionId,
    "claude-session-1",
    "the session binding is still written",
  );
});

test("final reply: without the signal the turn is unchanged", async () => {
  const result = await runTurn({ wake: WAKE });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.records.some((r) => r.kind === "follow-up-generation"));
  assert.deepEqual(interrupts(result.records), []);
  assert.deepEqual(byProtocol(result.frames, "rah-final-interrupt/v1"), []);
});

for (const [label, signal] of [
  ["another turn id", { runAttemptId: "run-1", turnId: "turn-other" }],
  ["another RunAttempt", { runAttemptId: "run-other" }],
] as const)
  test(`final reply: a signal naming ${label} never interrupts`, async () => {
    const result = await runTurn({ wake: WAKE, signal });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(interrupts(result.records), []);
    assert.ok(result.records.some((r) => r.kind === "follow-up-generation"));
  });

test("final reply: a rejected interrupt keeps the unchanged turn and never fails the reply", async () => {
  const result = await runTurn({
    wake: WAKE,
    rejectInterrupt: true,
    signal: { runAttemptId: "run-1" },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(interrupts(result.records).length, 1);
  assert.ok(result.records.some((r) => r.kind === "follow-up-generation"));
  assert.deepEqual(byProtocol(result.frames, "rah-final-interrupt/v1"), [
    {
      protocol: "rah-final-interrupt/v1",
      requested: true,
      accepted: false,
      terminal: false,
      sent: false,
      preemptedFollowUp: "unknown",
    },
  ]);
  assert.equal(byProtocol(result.frames, "rah-provider-session/v1").length, 1);
});

test("final reply: a signal after the follow-up began still ends the turn and records it was not preempted", async () => {
  const result = await runTurn({
    wake: WAKE,
    signal: { runAttemptId: "run-1" },
    signalAfterFollowUp: true,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(interrupts(result.records).length, 1);
  assert.equal(
    result.records.some((r) => r.kind === "follow-up-generation"),
    false,
  );
  assert.deepEqual(byProtocol(result.frames, "rah-final-interrupt/v1"), [
    {
      protocol: "rah-final-interrupt/v1",
      requested: true,
      accepted: true,
      terminal: true,
      sent: true,
      preemptedFollowUp: false,
    },
  ]);
});

test("final reply (older CLI): a reason-less error_during_execution with the interrupt's success receipt is the final end", async () => {
  const result = await runTurn({
    wake: WAKE,
    signal: { runAttemptId: "run-1", turnId: "accepted" },
    env: { FAKE_NO_TERMINAL_REASON: "1" },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(byProtocol(result.frames, "rah-final-interrupt/v1"), [
    {
      protocol: "rah-final-interrupt/v1",
      requested: true,
      accepted: true,
      terminal: true,
      sent: true,
      preemptedFollowUp: true,
    },
  ]);
});

test("final reply (older CLI): a reason-less error_during_execution without a correlated receipt is not taken as the abort", async () => {
  const result = await runTurn({
    wake: WAKE,
    signal: { runAttemptId: "run-1", turnId: "accepted" },
    env: { FAKE_NO_TERMINAL_REASON: "1", FAKE_SILENT_INTERRUPT: "1" },
  });
  assert.notEqual(
    result.code,
    0,
    "an unproven abort ends the run as a failure, never a final success",
  );
  assert.match(result.stderr, /error_during_execution/u);
});

test("final reply (real 2.1.282 exit): the CLI exits 1 after the interrupted turn's is_error result; the run is still the final success", async () => {
  // Real smoke 2026-09-25 (Haiku, cold): the result was recognised as this
  // interrupt's end, yet the run failed on the CLI's exit code 1 and the
  // Activation was retried into duplicate replies.
  const result = await runTurn({
    wake: WAKE,
    signal: { runAttemptId: "run-1", turnId: "accepted" },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /error_during_execution/u);
  assert.equal(
    byProtocol(result.frames, "rah-provider-session/v1").length,
    1,
    "the session binding is written",
  );
  assert.equal(
    byProtocol(result.frames, "rah-final-interrupt/v1")[0]?.terminal,
    true,
  );
});

test("final reply: a provider failure (terminal_reason model_error) while the interrupt is in flight still fails the run", async () => {
  const result = await runTurn({
    wake: WAKE,
    signal: { runAttemptId: "run-1", turnId: "accepted" },
    env: { FAKE_INTERRUPT_TERMINAL_REASON: "model_error" },
  });
  assert.notEqual(result.code, 0, "an unrelated error is never a final end");
  assert.match(result.stderr, /error_during_execution/u);
});

test("background task (real 2.1.282 order, batch 3 P1-4): the uuid-less native turn after the wake's result is diagnostic, never a protocol error", async () => {
  const result = await runTurn({
    wake: WAKE,
    env: { FAKE_BACKGROUND_TASK: "success" },
  });
  assert.ok(
    result.records.some((r) => r.kind === "background-turn"),
    "the fake ran the background native turn",
  );
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /unexpected terminal results/u);
  assert.equal(
    byProtocol(result.frames, "rah-provider-session/v1")[0]?.providerSessionId,
    "claude-session-1",
  );
  assert.equal(byProtocol(result.frames, "rah-delivery-accepted/v1").length, 1);
  assert.ok(
    JSON.stringify(result.frames).includes("claude:result:unattributed"),
    "the extra result is kept as a diagnostic",
  );
});

test("background task (batch 3 P1-4): a failing uuid-less native turn and the CLI's exit 1 never fail the wake's run", async () => {
  const result = await runTurn({
    wake: WAKE,
    env: { FAKE_BACKGROUND_TASK: "error" },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /FAKE background turn failure/u);
});

test("background task: an older CLI without msg_lifecycle_v1 keeps the strict result count", async () => {
  const result = await runTurn({
    wake: WAKE,
    env: { FAKE_BACKGROUND_TASK: "success", FAKE_NO_LIFECYCLE: "1" },
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unexpected terminal results/u);
});

test("error text (batch 3 P2-5): a real error result's errors[] is the run's diagnostic", async () => {
  const result = await runTurn({
    wake: WAKE,
    signal: { runAttemptId: "run-1", turnId: "accepted" },
    env: {
      FAKE_INTERRUPT_TERMINAL_REASON: "model_error",
      FAKE_RESULT_ERRORS: JSON.stringify(["FAKE provider overloaded detail"]),
    },
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /FAKE provider overloaded detail/u);
});

test("Host termination (not a final reply) still ends the run as interrupted", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-claude-final-stop-"));
  const record = join(directory, "record.jsonl");
  const executable = join(directory, "fake-claude.mjs");
  writeFileSync(executable, readFileSync(FAKE), { mode: 0o700 });
  try {
    const child = spawn(
      process.execPath,
      [
        DRIVER,
        "--executable",
        executable,
        "--tool-access-mode",
        "full_access",
        "--prompt",
        "FAKE",
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          FAKE_RECORD: record,
          FAKE_RELEASE: "/nonexistent",
        },
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      },
    );
    child.stdout!.resume();
    let fd3 = "";
    child.stdio[3]!.on("data", (chunk: Buffer) => (fd3 += chunk.toString()));
    await until(
      () =>
        existsSync(record) &&
        readFileSync(record, "utf8").includes("tool-running"),
    );
    child.kill("SIGTERM");
    const code = await new Promise<number | null>((resolve) =>
      child.once("close", resolve),
    );
    assert.equal(code, 0);
    assert.doesNotMatch(fd3, /rah-final-interrupt\/v1/u);
    assert.match(fd3, /claude:result:interrupted/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
