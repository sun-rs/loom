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
 * S2-c2 per-turn Kimi ACP driver. Real driver process, FAKE `kimi acp`
 * server (`fixtures/fake-kimi-acp.mjs`, no model) whose wire shapes follow
 * the installed kimi-code 0.39.1 ACP server.
 *
 * Acceptance: kimi-code never echoes a live prompt, so the earliest proof
 * that the runtime took THIS prompt is the first turn-scoped model update
 * (thought/text chunk or tool call) while it is the only prompt in flight —
 * before any tool of the turn can post. Session notices (compaction chunks,
 * `usage_update`) never count. The digest covers the Host wake file.
 *
 * Compaction: every completed compaction chunk is reported to the Host once
 * with its ordinal in this run (`rah-provider-compaction/v1`).
 *
 * Final reply: the Host's `rah-final-reply/v1` stdin frame ends the prompt at
 * the tool boundary with the ACP `session/cancel` notification; the cancelled
 * prompt is this run's success.
 */
const FAKE = fileURLToPath(
  new URL("./fixtures/fake-kimi-acp.mjs", import.meta.url),
);
const DRIVER = fileURLToPath(
  new URL("../src/kimi-acp-driver.mjs", import.meta.url),
);
const WAKE =
  '#main seq 7 msg=0123abcd @human: build?\nReply: message-post --target "#main" --based-on-room-seq 7 --final · no reply needed: message-check';
const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

type Scenario = {
  scenario: string;
  wake?: string;
  resume?: string;
  toolCommand?: string;
  signal?: { runAttemptId: string; turnId?: string | "accepted" };
  /** The Host cancels the run (SIGTERM) once the turn's tool is running. */
  cancelWhileRunning?: boolean;
  env?: Record<string, string>;
};

async function runTurn(input: Scenario) {
  const directory = mkdtempSync(join(tmpdir(), "rah-kimi-driver-"));
  chmodSync(directory, 0o700);
  const record = join(directory, "record.jsonl");
  const release = join(directory, "release");
  const wakePath = join(directory, "wake.md");
  const executable = join(directory, "fake-kimi.mjs");
  writeFileSync(executable, readFileSync(FAKE), { mode: 0o700 });
  if (input.wake !== undefined)
    writeFileSync(wakePath, input.wake, { mode: 0o600 });
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
        ...(input.resume === undefined
          ? []
          : ["--resume-session", input.resume]),
        ...(input.wake === undefined ? [] : ["--wake-input-file", wakePath]),
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          FAKE_RECORD: record,
          FAKE_RELEASE: release,
          FAKE_SCENARIO: input.scenario,
          FAKE_TOOL_COMMAND:
            input.toolCommand ?? ": message-post --based-on-room-seq 7 --final",
          RAH_RUN_ATTEMPT_ID: "run-1",
          ...input.env,
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
    if (input.signal !== undefined) {
      await until(
        () =>
          records().some((r) => r.event === "tool-running") ||
          child.exitCode !== null,
      );
      const turnId =
        input.signal.turnId === "accepted"
          ? (frames().find((f) => f.protocol === "rah-delivery-accepted/v1")
              ?.turnId as string | undefined)
          : input.signal.turnId;
      child.stdin!.write(
        `${JSON.stringify({
          protocol: "rah-final-reply/v1",
          runAttemptId: input.signal.runAttemptId,
          ...(turnId === undefined ? {} : { turnId }),
        })}\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (input.cancelWhileRunning === true) {
      await until(
        () =>
          records().some((r) => r.event === "tool-running") ||
          child.exitCode !== null,
      );
      child.kill("SIGTERM");
    }
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
  assert.fail("fake Kimi did not reach the expected point");
}

const byProtocol = (frames: Record<string, unknown>[], protocol: string) =>
  frames.filter((frame) => frame.protocol === protocol);
const sentFrames = (records: Record<string, unknown>[], method: string) =>
  records.filter(
    (r) => (r.frame as { method?: string } | undefined)?.method === method,
  );

test("acceptance: the first turn-scoped model update of the only prompt in flight is reported with the wake SHA-256, before any tool runs", async () => {
  const result = await runTurn({ scenario: "compact1+reply", wake: WAKE });
  assert.equal(result.code, 0, result.stderr);
  const prompt = result.records.find((r) => r.event === "prompt")!;
  assert.ok(
    String(prompt.text).endsWith(WAKE),
    "the Host wake file is the turn input verbatim",
  );
  const [acceptance, ...extra] = byProtocol(
    result.frames,
    "rah-delivery-accepted/v1",
  );
  assert.deepEqual(extra, []);
  const promptRequest = sentFrames(result.records, "session/prompt")[0]!
    .frame as { id: number };
  assert.deepEqual(acceptance, {
    protocol: "rah-delivery-accepted/v1",
    provider: "kimi-acp/v1",
    signal: "acp-turn-update",
    threadId: "kimi-session-new",
    turnId: `session/prompt#${String(promptRequest.id)}`,
    inputSha256: sha256(WAKE),
  });
  // The compaction chunk came first and never counted; the acceptance frame
  // precedes the turn's tool start in the Host stream.
  const acceptanceIndex = result.frames.indexOf(acceptance!);
  const toolStart = result.frames.findIndex(
    (frame) =>
      (frame.entry as { kind?: string } | undefined)?.kind === "tool_start",
  );
  assert.ok(toolStart > acceptanceIndex, JSON.stringify(result.frames));
});

test("acceptance: a prompt that produced no model update is never accepted", async () => {
  const result = await runTurn({ scenario: "compact1+silent", wake: WAKE });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(byProtocol(result.frames, "rah-delivery-accepted/v1"), []);
});

test("acceptance: the fixed startup wake (no wake file) reports none", async () => {
  const result = await runTurn({ scenario: "reply" });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(byProtocol(result.frames, "rah-delivery-accepted/v1"), []);
  const prompt = result.records.find((r) => r.event === "prompt")!;
  assert.match(String(prompt.text), /message-check --startup/u);
});

test("compaction: each completed compaction is reported once with its ordinal and counts", async () => {
  const result = await runTurn({
    scenario: "compact2+reply",
    wake: WAKE,
    resume: "kimi-session-old",
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(byProtocol(result.frames, "rah-provider-compaction/v1"), [
    {
      protocol: "rah-provider-compaction/v1",
      provider: "kimi-acp/v1",
      providerSessionId: "kimi-session-old",
      ordinal: 1,
      compactedCount: 12,
      tokensBefore: 220000,
      tokensAfter: 1500,
    },
    {
      protocol: "rah-provider-compaction/v1",
      provider: "kimi-acp/v1",
      providerSessionId: "kimi-session-old",
      ordinal: 2,
      compactedCount: 13,
      tokensBefore: 220001,
      tokensAfter: 1500,
    },
  ]);
  // Diagnostics only: the chunks become compaction trajectory entries.
  assert.ok(
    result.frames.some(
      (frame) =>
        (frame.entry as { kind?: string } | undefined)?.kind ===
        "compaction_finished",
    ),
  );
});

test("final reply: the prompt ends at the tool boundary with session/cancel and no follow-up generation", async () => {
  const result = await runTurn({
    scenario: "hang",
    wake: WAKE,
    signal: { runAttemptId: "run-1", turnId: "accepted" },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.records.some((r) => r.event === "follow-up-generation"),
    false,
    "the post-reply generation never ran",
  );
  const cancels = sentFrames(result.records, "session/cancel");
  assert.equal(cancels.length, 1);
  assert.equal((cancels[0]!.frame as { id?: unknown }).id, undefined);
  const toolDone = result.records.findIndex(
    (r) => r.event === "tool-completed",
  );
  assert.ok(
    result.records.indexOf(cancels[0]!) > toolDone,
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
    "kimi-session-new",
    "the cancelled final prompt still binds the session",
  );
  assert.doesNotMatch(
    JSON.stringify(result.frames),
    /工作轮次结束：cancelled/u,
  );
});

test("final reply: without the signal the prompt is unchanged", async () => {
  const result = await runTurn({ scenario: "reply", wake: WAKE });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.records.some((r) => r.event === "follow-up-generation"));
  assert.deepEqual(sentFrames(result.records, "session/cancel"), []);
  assert.deepEqual(byProtocol(result.frames, "rah-final-interrupt/v1"), []);
});

for (const [label, signal] of [
  ["another turn id", { runAttemptId: "run-1", turnId: "turn-other" }],
  ["another RunAttempt", { runAttemptId: "run-other" }],
] as const)
  test(`final reply: a signal naming ${label} never cancels`, async () => {
    const result = await runTurn({ scenario: "hang", wake: WAKE, signal });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(sentFrames(result.records, "session/cancel"), []);
    assert.ok(result.records.some((r) => r.event === "follow-up-generation"));
  });

test("stopReason: a refusal fails the run instead of reading as success", async () => {
  const result = await runTurn({ scenario: "refusal", wake: WAKE });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /refusal/u);
  assert.deepEqual(byProtocol(result.frames, "rah-provider-session/v1"), []);
});

/**
 * Full review batch 2 (drivers P2-1, contract §3): once the runtime took this
 * turn's input, its native session is bound even when the run then ends
 * without success (cancel, crash, provider error), so the next Activation
 * resumes it instead of silently starting a new session. A run that never
 * reached acceptance (the refusal above) still binds nothing.
 */
test("session binding: a run cancelled after the input was accepted still reports its session", async () => {
  const result = await runTurn({
    scenario: "hang",
    wake: WAKE,
    cancelWhileRunning: true,
  });
  assert.equal(result.code, 0, result.stderr);
  const accepted = byProtocol(result.frames, "rah-delivery-accepted/v1");
  assert.equal(accepted.length, 1);
  const bound = byProtocol(result.frames, "rah-provider-session/v1");
  assert.deepEqual(
    bound.map((frame) => frame.providerSessionId),
    [accepted[0]!.threadId],
  );
  assert.ok(
    result.frames.indexOf(bound[0]!) < result.frames.indexOf(accepted[0]!),
    "bound before the acceptance is reported, so before any tool can post",
  );
});

test("usage stays unavailable: a session-ready run reports the provider gap, never zero usage", async () => {
  const result = await runTurn({ scenario: "reply", wake: WAKE });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(
    byProtocol(result.frames, "rah-provider-usage-gap/v1").map(
      (frame) => frame.reason,
    ),
    ["unsupported_provider"],
  );
  assert.deepEqual(byProtocol(result.frames, "rah-provider-usage/v1"), []);
});

test("batch 3 P1-6: the Kimi launch carries KIMI_DISABLE_CRON=1 (no persisted cron turn can fire)", async () => {
  const result = await runTurn({ scenario: "reply", wake: WAKE });
  assert.equal(result.code, 0, result.stderr);
  const spawn = result.records.find((r) => r.event === "spawn");
  assert.equal(spawn?.disableCron, "1");
});

test("batch 3 P1-6: a native CreateGoal permission is rejected even under full_access, and the turn still runs", async () => {
  const result = await runTurn({ scenario: "goal+reply", wake: WAKE });
  assert.equal(result.code, 0, result.stderr);
  const [goal, ...more] = result.records.filter(
    (r) => r.event === "goal-permission",
  );
  assert.deepEqual(more, []);
  assert.deepEqual(goal?.outcome, { optionId: "reject", outcome: "selected" });
  assert.ok(result.records.some((r) => r.event === "tool-completed"));
});

test("batch 3 P2-7: a resumed session's wake carries no per-turn standing-file line; a fresh session's first prompt does", async () => {
  const resumed = await runTurn({
    scenario: "reply",
    wake: WAKE,
    resume: "kimi-session-old",
  });
  assert.equal(resumed.code, 0, resumed.stderr);
  const resumedPrompt = resumed.records.find((r) => r.event === "prompt");
  assert.equal(resumedPrompt?.text, WAKE, "the resumed wake is the body only");
  assert.doesNotMatch(
    String(resumedPrompt?.text),
    /standing instructions file/iu,
  );
  const fresh = await runTurn({ scenario: "reply", wake: WAKE });
  assert.equal(fresh.code, 0, fresh.stderr);
  const freshPrompt = fresh.records.find((r) => r.event === "prompt");
  assert.match(String(freshPrompt?.text), /FAKE standing prompt/u);
  assert.match(String(freshPrompt?.text), /standing instructions file/iu);
});
