import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * S2-c3 per-turn OpenCode driver. Real driver process, FAKE `opencode serve`
 * (`fixtures/fake-opencode-server.mjs`, no model) whose wire shapes follow the
 * installed OpenCode 1.18.32 bundle.
 *
 * Rules: the standing prompt is an `instructions` file of the server's config
 * (`OPENCODE_CONFIG_CONTENT`), which OpenCode reads into the system of EVERY
 * model request — including the step after auto-compaction, whose synthetic
 * "Continue…" user message has no per-message `system`. No per-message
 * `system` is sent. The file path is content-addressed so the system prefix
 * (and provider prompt cache) stays identical across turns.
 *
 * Acceptance: the prompt carries a caller-chosen user `messageID`; the first
 * assistant message whose `parentID` is that id (created by the session loop
 * before its model request, so before any tool) is the acceptance. An old
 * idle or a foreign-parent assistant never counts or settles the turn.
 *
 * Final reply: the Host's `rah-final-reply/v1` frame ends the run with the
 * native `POST /session/:id/abort` after the posting tool finished; the
 * aborted final turn is this run's success.
 */
const FAKE = fileURLToPath(
  new URL("./fixtures/fake-opencode-server.mjs", import.meta.url),
);
const DRIVER = fileURLToPath(
  new URL("../src/opencode-server-driver.mjs", import.meta.url),
);
const WAKE =
  '#main seq 7 msg=0123abcd @human: build?\nReply: message-post --target "#main" --based-on-room-seq 7 --final · no reply needed: message-check';
const RULES = "FAKE standing prompt";
const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

type Scenario = {
  scenario: string;
  wake?: string;
  resume?: string;
  toolCommand?: string;
  prompt?: string;
  signal?: { runAttemptId: string; turnId?: string | "accepted" };
  /** The Host cancels the run (SIGTERM) once the turn's tool is running. */
  cancelWhileRunning?: boolean;
  env?: Record<string, string>;
};

async function runTurn(input: Scenario) {
  const directory = mkdtempSync(join(tmpdir(), "rah-opencode-driver-"));
  chmodSync(directory, 0o700);
  const record = join(directory, "record.jsonl");
  const release = join(directory, "release");
  const wakePath = join(directory, "wake.md");
  const executable = join(directory, "fake-opencode.mjs");
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
        input.prompt ?? RULES,
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
          ...(input.toolCommand === undefined
            ? {}
            : { FAKE_TOOL_COMMAND: input.toolCommand }),
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
  assert.fail("fake OpenCode did not reach the expected point");
}

const byProtocol = (frames: Record<string, unknown>[], protocol: string) =>
  frames.filter((frame) => frame.protocol === protocol);
const requests = (records: Record<string, unknown>[], suffix: string) =>
  records.filter(
    (r) =>
      r.event === "request" &&
      r.method === "POST" &&
      String(r.path).endsWith(suffix),
  );
const modelRequests = (records: Record<string, unknown>[]) =>
  records.filter((r) => r.event === "model-request") as {
    kind: string;
    system: string[];
  }[];
const spawnConfig = (records: Record<string, unknown>[]) =>
  (records.find((r) => r.event === "spawn")!.config ?? {}) as {
    instructions?: string[];
  };

test("rules: the standing prompt is a server instructions file present in every model request, including the autocontinue step after compaction; no per-message system", async () => {
  const result = await runTurn({ scenario: "compact+reply", wake: WAKE });
  assert.equal(result.code, 0, result.stderr);
  const prompt = result.records.find((r) => r.event === "prompt")!;
  assert.equal(prompt.system, undefined, "no per-message system");
  const [path, ...extra] = spawnConfig(result.records).instructions ?? [];
  assert.deepEqual(extra, []);
  assert.ok(path !== undefined && path.startsWith("/"), String(path));
  const steps = modelRequests(result.records);
  assert.deepEqual(
    steps.map((step) => step.kind),
    ["step", "compaction", "autocontinue"],
  );
  for (const step of steps.filter((s) => s.kind !== "compaction"))
    assert.ok(
      step.system.includes(`Instructions from: ${path}\n${RULES}`),
      JSON.stringify(step),
    );
  // Compaction is diagnostics only: no rules card, no Host compaction frame.
  assert.deepEqual(byProtocol(result.frames, "rah-provider-compaction/v1"), []);
  assert.ok(
    result.frames.some(
      (frame) =>
        (frame.entry as { kind?: string } | undefined)?.kind ===
        "compaction_finished",
    ),
  );
});

test("rules: the instructions path is content-addressed (stable prefix across turns), private, and follows a changed standing prompt", async () => {
  const first = await runTurn({ scenario: "reply", wake: WAKE });
  const second = await runTurn({ scenario: "reply", wake: WAKE });
  const changed = await runTurn({
    scenario: "reply",
    wake: WAKE,
    prompt: "FAKE standing prompt v2",
  });
  for (const result of [first, second, changed])
    assert.equal(result.code, 0, result.stderr);
  const [a] = spawnConfig(first.records).instructions!;
  const [b] = spawnConfig(second.records).instructions!;
  const [c] = spawnConfig(changed.records).instructions!;
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(readFileSync(a!, "utf8"), RULES);
  assert.equal(readFileSync(c!, "utf8"), "FAKE standing prompt v2");
  assert.equal(statSync(a!).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(a!)).mode & 0o777, 0o700);
});

test("rules: an inherited OPENCODE_CONFIG_CONTENT is merged, never replaced", async () => {
  const result = await runTurn({
    scenario: "reply",
    wake: WAKE,
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        instructions: ["/opt/team-rules.md"],
        share: "disabled",
      }),
    },
  });
  assert.equal(result.code, 0, result.stderr);
  const config = spawnConfig(result.records) as {
    instructions: string[];
    share?: string;
  };
  assert.equal(config.share, "disabled");
  assert.equal(config.instructions[0], "/opt/team-rules.md");
  assert.equal(config.instructions.length, 2);
});

test("acceptance: the first assistant whose parent is our chosen user messageID is reported with the wake SHA-256, before any tool runs", async () => {
  const result = await runTurn({ scenario: "reply", wake: WAKE });
  assert.equal(result.code, 0, result.stderr);
  const prompt = result.records.find((r) => r.event === "prompt")!;
  assert.equal(prompt.text, WAKE, "the Host wake file is the turn input");
  assert.match(String(prompt.messageID), /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/u);
  const [acceptance, ...extra] = byProtocol(
    result.frames,
    "rah-delivery-accepted/v1",
  );
  assert.deepEqual(extra, []);
  assert.deepEqual(acceptance, {
    protocol: "rah-delivery-accepted/v1",
    provider: "opencode-server/v1",
    signal: "opencode-assistant-parent",
    threadId: "ses_fakenew",
    turnId: prompt.messageID,
    inputSha256: sha256(WAKE),
  });
  const acceptanceIndex = result.frames.indexOf(acceptance!);
  const toolStart = result.frames.findIndex(
    (frame) =>
      (frame.entry as { kind?: string } | undefined)?.kind === "tool_start",
  );
  assert.ok(toolStart > acceptanceIndex, JSON.stringify(result.frames));
});

test("acceptance: a stale idle and a foreign-parent assistant never count and never settle the turn", async () => {
  const result = await runTurn({ scenario: "stale+reply", wake: WAKE });
  assert.equal(result.code, 0, result.stderr);
  const prompt = result.records.find((r) => r.event === "prompt")!;
  const accepted = byProtocol(result.frames, "rah-delivery-accepted/v1");
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]!.turnId, prompt.messageID);
  assert.ok(
    result.records.some((r) => r.event === "follow-up-generation"),
    "the turn ran to its own end",
  );
  assert.equal(byProtocol(result.frames, "rah-provider-session/v1").length, 1);
});

test("acceptance: a prompt that never produced an assistant is never accepted", async () => {
  const result = await runTurn({ scenario: "noassistant", wake: WAKE });
  assert.equal(result.code, 1);
  assert.deepEqual(byProtocol(result.frames, "rah-delivery-accepted/v1"), []);
  assert.deepEqual(byProtocol(result.frames, "rah-provider-session/v1"), []);
});

test("acceptance: the fixed startup wake (no wake file) reports none", async () => {
  const result = await runTurn({ scenario: "reply" });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(byProtocol(result.frames, "rah-delivery-accepted/v1"), []);
  const prompt = result.records.find((r) => r.event === "prompt")!;
  assert.match(String(prompt.text), /message-check --startup/u);
});

test("final reply: the run ends with POST /abort after the posting tool finished, with no follow-up generation", async () => {
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
  const aborts = result.records.filter((r) => r.event === "abort");
  assert.equal(aborts.length, 1);
  assert.equal(aborts[0]!.toolRunning, false, "the posting tool was not cut");
  assert.ok(
    result.records.indexOf(aborts[0]!) >
      result.records.findIndex((r) => r.event === "tool-completed"),
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
    "ses_fakenew",
    "the aborted final turn still binds the session",
  );
  assert.doesNotMatch(JSON.stringify(result.frames), /MessageAbortedError/u);
});

test("final reply: a Host signal that outruns the stream never cuts the posting tool (persisted run checked first)", async () => {
  const result = await runTurn({
    scenario: "hang+lagtool",
    wake: WAKE,
    signal: { runAttemptId: "run-1", turnId: "accepted" },
    env: { FAKE_LAG_MS: "400", FAKE_FOLLOW_UP_MS: "3000" },
  });
  assert.equal(result.code, 0, result.stderr);
  const aborts = result.records.filter((r) => r.event === "abort");
  assert.equal(aborts.length, 1);
  assert.equal(aborts[0]!.toolRunning, false, "the posting tool was not cut");
  assert.ok(
    result.records.some(
      (r) =>
        r.event === "request" &&
        r.method === "GET" &&
        r.path === "/session/ses_fakenew/message",
    ),
    "the persisted run was read before aborting",
  );
  assert.equal(
    result.records.some((r) => r.event === "follow-up-generation"),
    false,
  );
});

test("final reply: an unreadable persisted run while the stream lags never aborts the posting tool (fail closed)", async () => {
  const result = await runTurn({
    scenario: "hang+lagtool+listfail",
    wake: WAKE,
    signal: { runAttemptId: "run-1", turnId: "accepted" },
    env: { FAKE_LAG_MS: "400" },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(
    result.records.some(
      (r) =>
        r.event === "request" &&
        r.method === "GET" &&
        r.path === "/session/ses_fakenew/message",
    ),
    "the persisted run was queried",
  );
  assert.deepEqual(
    requests(result.records, "/abort"),
    [],
    "no abort without proof the posting tool ended",
  );
  assert.ok(
    result.records.some((r) => r.event === "follow-up-generation"),
    "the turn ends on its own",
  );
});

test("final reply: without the signal the turn is unchanged", async () => {
  const result = await runTurn({ scenario: "reply", wake: WAKE });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.records.some((r) => r.event === "follow-up-generation"));
  assert.deepEqual(requests(result.records, "/abort"), []);
  assert.deepEqual(byProtocol(result.frames, "rah-final-interrupt/v1"), []);
});

for (const [label, signal] of [
  ["another turn id", { runAttemptId: "run-1", turnId: "msg_other" }],
  ["another RunAttempt", { runAttemptId: "run-other" }],
] as const)
  test(`final reply: a signal naming ${label} never aborts`, async () => {
    const result = await runTurn({ scenario: "hang", wake: WAKE, signal });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(requests(result.records, "/abort"), []);
    assert.ok(result.records.some((r) => r.event === "follow-up-generation"));
  });

test("review batch 1 #4: a context overflow OpenCode recovers from by auto-compaction is a diagnostic, never a failed run", async () => {
  const result = await runTurn({ scenario: "overflow", wake: WAKE });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.records.some((r) => r.event === "context-overflow"));
  assert.ok(result.records.some((r) => r.event === "compacted"));
  assert.ok(
    result.records.some((r) => r.event === "follow-up-generation"),
    "the run went on after the compaction; the server was not stopped",
  );
  assert.equal(
    byProtocol(result.frames, "rah-provider-session/v1").length,
    1,
    "the run completed and bound its session",
  );
});

test("review batch 1 #5: a subagent's (child session) permission request is answered with the parent session's rule", async () => {
  const result = await runTurn({ scenario: "childperm", wake: WAKE });
  assert.equal(result.code, 0, result.stderr);
  const [asked] = result.records.filter((r) => r.event === "child-permission");
  assert.equal(asked?.reply, "always");
});

/**
 * Full review batch 3 (Codex re-review P2-1): a child session this driver
 * never saw announced (its `session.created` lost, or created before this
 * run) is verified through the installed 1.18.32 native API — `GET
 * /session/:id` `parentID`, `GET /session/:id/children` — before its request
 * is answered with the parent session's rule; never a global allow.
 */
test("batch 3: a child permission whose session.created was lost is answered after GET /session/:child proves the parent", async () => {
  const result = await runTurn({ scenario: "childnocreated", wake: WAKE });
  assert.equal(result.code, 0, result.stderr);
  const [asked] = result.records.filter((r) => r.event === "child-permission");
  assert.equal(asked?.reply, "always");
  assert.ok(
    result.records.some(
      (r) =>
        r.event === "request" &&
        r.method === "GET" &&
        r.path === `/session/${String(asked?.child)}`,
    ),
    "the lineage was verified natively",
  );
});

test("batch 3: a resumed session preloads its existing children, so an old child's request needs no announcement", async () => {
  const result = await runTurn({
    scenario: "oldchildperm",
    wake: WAKE,
    resume: "ses_fakeresumed",
    env: { FAKE_EXISTING_CHILD: "1" },
  });
  assert.equal(result.code, 0, result.stderr);
  const [asked] = result.records.filter((r) => r.event === "child-permission");
  assert.equal(asked?.reply, "always");
  const index = (predicate: (r: Record<string, unknown>) => boolean) =>
    result.records.findIndex(predicate);
  const preload = index(
    (r) =>
      r.event === "request" &&
      r.method === "GET" &&
      r.path === "/session/ses_fakeresumed/children",
  );
  assert.ok(preload >= 0, "children listed on resume");
  assert.ok(preload < index((r) => r.event === "prompt"), "before the prompt");
});

test("batch 3: a permission of a session outside this parent's tree is never answered", async () => {
  const result = await runTurn({
    scenario: "childnocreated",
    wake: WAKE,
    env: { FAKE_FOREIGN_PARENT: "1", FAKE_PERMISSION_WAIT_MS: "400" },
  });
  const [asked] = result.records.filter((r) => r.event === "child-permission");
  assert.equal(asked?.reply, null, "no reply to a foreign session");
  assert.equal(result.code, 1, "the fake failed the step for lack of a reply");
});

/**
 * Drivers P2-4: a subagent's (child session's) model steps are this run's
 * cost; their `step-finish` usage is recorded, never silently dropped.
 */
test("batch 3: a child session's step-finish usage is recorded for the run", async () => {
  const result = await runTurn({ scenario: "childperm", wake: WAKE });
  assert.equal(result.code, 0, result.stderr);
  const [usage] = result.records.filter((r) => r.event === "child-usage");
  assert.ok(usage);
  const recorded = byProtocol(result.frames, "rah-provider-usage/v1");
  assert.deepEqual(
    recorded.map((frame) => [
      frame.responseId,
      frame.inputTokens,
      frame.outputTokens,
    ]),
    [[usage.partId, 50, 5]],
  );
});

/**
 * Codex re-review P2-2: the negative pair of the recoverable overflow. With
 * auto-compaction off the assistant keeps the ContextOverflowError: the run
 * fails, and the session the loop already accepted stays bound.
 */
test("batch 3: a context overflow OpenCode did not recover from fails the run and keeps the accepted session bound", async () => {
  const result = await runTurn({ scenario: "overflowfatal", wake: WAKE });
  assert.ok(result.records.some((r) => r.event === "overflow-unrecovered"));
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /too long for the context window/u);
  const accepted = byProtocol(result.frames, "rah-delivery-accepted/v1");
  assert.equal(accepted.length, 1);
  assert.deepEqual(
    byProtocol(result.frames, "rah-provider-session/v1").map(
      (frame) => frame.providerSessionId,
    ),
    [accepted[0]!.threadId],
  );
  assert.equal(
    result.records.some((r) => r.event === "follow-up-generation"),
    false,
  );
});

/**
 * Full review batch 2 (drivers P2-1, contract §3): once the session loop took
 * this turn's input (the first assistant parented on our message), the session
 * is bound even when the run then ends without success, so the next Activation
 * resumes it instead of silently starting a new session. A prompt that never
 * produced an assistant still binds nothing.
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

test("errors: a failed assistant fails the run instead of reading as success", async () => {
  const result = await runTurn({ scenario: "error", wake: WAKE });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /FAKE provider failure/u);
  // The failure came after the session loop took the input: still bound.
  const accepted = byProtocol(result.frames, "rah-delivery-accepted/v1");
  assert.deepEqual(
    byProtocol(result.frames, "rah-provider-session/v1").map(
      (frame) => frame.providerSessionId,
    ),
    accepted.map((frame) => frame.threadId),
  );
  assert.equal(accepted.length, 1);
});
