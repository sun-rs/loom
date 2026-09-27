import test from "node:test";
import assert from "node:assert/strict";

import { assertApprovedGateModel } from "../cli-efficiency/approved-models.mjs";
import {
  E2E_MODELS,
  LIMITATIONS,
  STEPS,
  combine,
  judgeAck,
  judgeBudget,
  judgeDelivery,
  judgeMemoryRead,
  judgeMemoryWrite,
  judgePlacementModel,
  judgePrivateBox,
  judgeReadSwitch,
  judgeSession,
  parseArgs,
  prompts,
  resumeState,
  stopReason,
  renderPlan,
  renderReport,
  runStamp,
  sanitize,
  sanitizeText,
  stateChanges,
  summarizeUsage,
} from "./real-e2e-lib.mjs";

const HUMAN = "principal_human";
const CODEX = "principal_codex";
const CLAUDE = "principal_claude";
const CHANNEL = "room_channel";
const DIRECT = "room_direct";

const message = (messageId, actorId, roomId, roomSeq) => ({
  messageId,
  actorId,
  roomId,
  roomSeq,
});

test("the acceptance models are exactly approved rows", () => {
  for (const spec of Object.values(E2E_MODELS))
    assert.doesNotThrow(() =>
      assertApprovedGateModel({
        provider: spec.provider,
        model: spec.model,
        effort: spec.effort,
      }),
    );
  assert.equal(E2E_MODELS.codex.model, "gpt-6-luna");
  assert.equal(E2E_MODELS.codex.effort, "low");
  assert.equal(E2E_MODELS.claude.model, "haiku");
  assert.equal(E2E_MODELS.claude.effort, null);
});

test("parseArgs requires explicit modes and bounds the budget", () => {
  assert.deepEqual(parseArgs(["--dry"]), {
    paid: false,
    dry: true,
    step: 1,
    run: undefined,
    until: undefined,
    maxRuns: 40,
    help: false,
  });
  const bounded = parseArgs(["--paid", "--step", "7", "--until", "8"]);
  assert.equal(bounded.until, 8);
  assert.throws(
    () => parseArgs(["--paid", "--step", "8", "--until", "7"]),
    /--until/u,
  );
  const resumed = parseArgs([
    "--paid",
    "--step",
    "6",
    "--run",
    "20260927T101500Z",
  ]);
  assert.equal(resumed.step, 6);
  assert.equal(resumed.run, "20260927T101500Z");
  assert.throws(() => parseArgs(["--paid", "--dry"]), /exclusive/u);
  assert.throws(() => parseArgs(["--max-runs", "41"]), /1\.\.40/u);
  assert.throws(() => parseArgs(["--step", "0"]), /--step/u);
  assert.throws(() => parseArgs(["--step", String(STEPS.length + 1)]));
  assert.throws(() => parseArgs(["--run", "../x"]), /run stamp/u);
  assert.throws(() => parseArgs(["--step"]), /needs a value/u);
  assert.throws(() => parseArgs(["--bogus"]), /unknown/u);
});

test("runStamp is a sortable UTC stamp", () => {
  assert.equal(
    runStamp(new Date("2026-09-27T10:15:00.123Z")),
    "20260927T101500Z",
  );
});

test("prompts never @-mention an instance that is not a recipient", () => {
  const text = prompts({ codex: "cx-1", claude: "cl-2", memoryName: "pid" });
  assert.match(text.review, /@cx-1/u);
  assert.match(text.review, /@cl-2/u);
  assert.doesNotMatch(text.longTask, /@cl-2/u);
  assert.doesNotMatch(text.memoryWrite, /@cl-2/u);
  assert.doesNotMatch(text.memoryRead, /@cx-1/u);
  assert.doesNotMatch(text.memoryDenied, /@cx-1/u);
  assert.doesNotMatch(text.privateQuestion, /@/u);
  assert.match(text.memoryDenied, /pid/u);
});

test("judgeDelivery passes exactly one reply per expected target", () => {
  const result = judgeDelivery({
    expected: [
      { participantId: CODEX, roomId: CHANNEL },
      { participantId: CLAUDE, roomId: CHANNEL },
    ],
    messages: [
      message("m1", HUMAN, CHANNEL, 10),
      message("m2", CODEX, CHANNEL, 14),
      message("m3", CLAUDE, CHANNEL, 16),
    ],
    instanceIds: [CODEX, CLAUDE],
    afterSeq: { [CHANNEL]: 10 },
  });
  assert.equal(result.verdict, "pass");
  assert.deepEqual(
    result.perTarget.map(({ count }) => count),
    [1, 1],
  );
});

test("judgeDelivery fails a duplicate, a missing reply and a wrong room", () => {
  const duplicate = judgeDelivery({
    expected: [{ participantId: CODEX, roomId: CHANNEL, label: "codex" }],
    messages: [
      message("m2", CODEX, CHANNEL, 14),
      message("m3", CODEX, CHANNEL, 18),
    ],
    instanceIds: [CODEX, CLAUDE],
    afterSeq: { [CHANNEL]: 10 },
  });
  assert.equal(duplicate.verdict, "fail");
  assert.match(duplicate.problems[0], /2 条回复（重复）/u);

  const missing = judgeDelivery({
    expected: [{ participantId: CLAUDE, roomId: CHANNEL, label: "claude" }],
    messages: [message("m1", HUMAN, CHANNEL, 10)],
    instanceIds: [CODEX, CLAUDE],
    afterSeq: { [CHANNEL]: 10 },
  });
  assert.equal(missing.verdict, "fail");
  assert.match(missing.problems[0], /无回复/u);

  const wrongRoom = judgeDelivery({
    expected: [{ participantId: CODEX, roomId: DIRECT }],
    messages: [message("m5", CODEX, CHANNEL, 20)],
    instanceIds: [CODEX, CLAUDE],
    afterSeq: {},
  });
  assert.equal(wrongRoom.verdict, "fail");
  assert.equal(wrongRoom.unexpected.length, 1);
  assert.equal(wrongRoom.unexpected[0].roomId, CHANNEL);
});

test("judgeDelivery ignores replies before the step's Human message", () => {
  const result = judgeDelivery({
    expected: [{ participantId: CODEX, roomId: CHANNEL }],
    messages: [
      message("old", CODEX, CHANNEL, 9),
      message("new", CODEX, CHANNEL, 12),
    ],
    instanceIds: [CODEX],
    afterSeq: { [CHANNEL]: 10 },
  });
  assert.equal(result.verdict, "pass");
  assert.deepEqual(result.perTarget[0].messageIds, ["new"]);
});

test("judgeAck needs completed Activations and a cursor through toSeq", () => {
  const activations = [
    {
      activationId: "a1",
      roomId: CHANNEL,
      participantId: CODEX,
      state: "completed",
      toSeq: 10,
    },
    {
      activationId: "a2",
      roomId: CHANNEL,
      participantId: CLAUDE,
      state: "completed",
      toSeq: 10,
    },
  ];
  const cursors = [
    { roomId: CHANNEL, participantId: CODEX, consumerId: "x", lastSeq: 4 },
    { roomId: CHANNEL, participantId: CODEX, consumerId: "y", lastSeq: 12 },
    { roomId: CHANNEL, participantId: CLAUDE, consumerId: "z", lastSeq: 9 },
  ];
  const result = judgeAck({ activations, cursors });
  assert.equal(result.verdict, "fail");
  assert.deepEqual(
    result.rows.map(({ acked }) => acked),
    [true, false],
  );
  assert.match(result.problems[0], /a2: 游标 9 < toSeq 10/u);

  const open = judgeAck({
    activations: [{ ...activations[0], state: "leased" }],
    cursors,
  });
  assert.equal(open.verdict, "fail");
  assert.match(open.problems[0], /state=leased/u);

  const cancelled = judgeAck({
    activations: [activations[0], { ...activations[1], state: "cancelled" }],
    cursors,
  });
  assert.equal(cancelled.verdict, "pass");
  assert.equal(cancelled.cancelled, 1);

  assert.equal(judgeAck({ activations: [], cursors }).verdict, "fail");
});

test("judgeSession fails a generation change or a second native session", () => {
  const participants = [{ participantId: CODEX, label: "codex" }];
  const first = judgeSession({
    before: { [CODEX]: { generation: 0, providerSessionIds: [] } },
    after: {
      [CODEX]: { generation: 0, bound: true, providerSessionIds: ["s1"] },
    },
    participants,
  });
  assert.equal(first.verdict, "pass");

  const replaced = judgeSession({
    before: { [CODEX]: { generation: 0, providerSessionIds: ["s1"] } },
    after: { [CODEX]: { generation: 0, providerSessionIds: ["s1", "s2"] } },
    participants,
  });
  assert.equal(replaced.verdict, "fail");
  assert.match(replaced.problems[0], /2 个原生 session id/u);

  const swapped = judgeSession({
    before: { [CODEX]: { generation: 0, providerSessionIds: ["s1"] } },
    after: { [CODEX]: { generation: 0, providerSessionIds: ["s2"] } },
    participants,
  });
  assert.equal(swapped.verdict, "fail");

  const reset = judgeSession({
    before: { [CODEX]: { generation: 0, providerSessionIds: ["s1"] } },
    after: { [CODEX]: { generation: 1, providerSessionIds: ["s1"] } },
    participants,
  });
  assert.equal(reset.verdict, "fail");
  assert.match(reset.problems[0], /代数 0 -> 1/u);

  const vanished = judgeSession({
    before: { [CODEX]: { generation: 0, providerSessionIds: ["s1"] } },
    after: { [CODEX]: { generation: 0, providerSessionIds: [] } },
    participants,
  });
  assert.equal(vanished.verdict, "fail");
});

const privateBase = {
  channelRun: {
    startedAt: "2026-09-27T10:00:01.000Z",
    finishedAt: "2026-09-27T10:01:00.000Z",
  },
  privateRun: { startedAt: "2026-09-27T10:01:02.000Z" },
  privateMessageAt: "2026-09-27T10:00:05.000Z",
  members: [HUMAN, CODEX],
  humanId: HUMAN,
  instanceId: CODEX,
  otherInstanceId: CLAUDE,
  otherInboxCount: 0,
  otherMessageCount: 0,
};

test("judgePrivateBox passes a queued, isolated private turn", () => {
  const result = judgePrivateBox(privateBase);
  assert.equal(result.verdict, "pass");
  assert.equal(result.exercised, true);
});

test("judgePrivateBox fails a private turn that preempts the channel turn", () => {
  const result = judgePrivateBox({
    ...privateBase,
    privateRun: { startedAt: "2026-09-27T10:00:30.000Z" },
  });
  assert.equal(result.verdict, "fail");
  assert.match(result.problems[0], /频道轮结束前开始/u);
});

test("judgePrivateBox fails leaks to the other instance", () => {
  const member = judgePrivateBox({
    ...privateBase,
    members: [HUMAN, CODEX, CLAUDE],
  });
  assert.equal(member.verdict, "fail");
  const inbox = judgePrivateBox({ ...privateBase, otherInboxCount: 1 });
  assert.equal(inbox.verdict, "fail");
  const posted = judgePrivateBox({ ...privateBase, otherMessageCount: 1 });
  assert.equal(posted.verdict, "fail");
});

test("judgePrivateBox is inconclusive when the channel turn had already ended", () => {
  const result = judgePrivateBox({
    ...privateBase,
    privateMessageAt: "2026-09-27T10:01:01.000Z",
  });
  assert.equal(result.verdict, "inconclusive");
  assert.equal(result.exercised, false);
});

const entry = {
  entryId: "mem_1",
  scopeRoomId: CHANNEL,
  name: "pid-check",
  state: "active",
};
const create = {
  entryId: "mem_1",
  op: "create",
  actorKind: "instance",
  instanceId: CODEX,
  runAttemptId: "run_c1",
  viaRoomId: CHANNEL,
};

test("judgeMemoryWrite proves authorship from the create revision", () => {
  const ok = judgeMemoryWrite({
    entries: [entry],
    revisions: [create],
    writerInstanceId: CODEX,
    writerRunIds: ["run_c1"],
    channelId: CHANNEL,
  });
  assert.equal(ok.verdict, "pass");
  assert.equal(ok.name, "pid-check");

  const human = judgeMemoryWrite({
    entries: [entry],
    revisions: [{ ...create, actorKind: "human", instanceId: null }],
    writerInstanceId: CODEX,
    writerRunIds: ["run_c1"],
    channelId: CHANNEL,
  });
  assert.equal(human.verdict, "fail");

  const foreignRun = judgeMemoryWrite({
    entries: [entry],
    revisions: [create],
    writerInstanceId: CODEX,
    writerRunIds: ["run_other"],
    channelId: CHANNEL,
  });
  assert.equal(foreignRun.verdict, "fail");

  const none = judgeMemoryWrite({
    entries: [],
    revisions: [],
    writerInstanceId: CODEX,
    writerRunIds: [],
    channelId: CHANNEL,
  });
  assert.equal(none.verdict, "fail");
  assert.equal(none.name, null);

  const two = judgeMemoryWrite({
    entries: [entry, { ...entry, entryId: "mem_2" }],
    revisions: [create],
    writerInstanceId: CODEX,
    writerRunIds: ["run_c1"],
    channelId: CHANNEL,
  });
  assert.equal(two.verdict, "fail");
});

const codexTool = (command) => ({
  kind: "tool_start",
  toolName: "运行命令",
  toolInput: `/bin/zsh -lc '"$RAH_WORKER_CLI" worker ${command}'`,
});

test("judgeMemoryRead looks for a memory read command in the trajectory", () => {
  assert.equal(
    judgeMemoryRead({
      trajectory: [codexTool("memory search --query pid")],
    }).verdict,
    "pass",
  );
  assert.equal(
    judgeMemoryRead({
      trajectory: [
        {
          kind: "tool_start",
          toolName: "Bash",
          toolInput: { command: "$RAH_WORKER_CLI worker memory read --name x" },
        },
      ],
    }).verdict,
    "pass",
  );
  assert.equal(
    judgeMemoryRead({
      trajectory: [
        codexTool("memory write --name x --type project"),
        { kind: "text", text: "memory read" },
      ],
    }).verdict,
    "fail",
  );
});

const policy = (read) => ({
  channelId: CHANNEL,
  revision: 2,
  members: [
    { instanceId: CLAUDE, read, write: true },
    { instanceId: CODEX, read: true, write: true },
  ],
});

test("judgeReadSwitch passes a refused read attempt and a restore", () => {
  const result = judgeReadSwitch({
    offPolicy: policy(false),
    overrideRow: { readEnabled: 0 },
    restoredPolicy: policy(true),
    instanceId: CLAUDE,
    trajectory: [codexTool("memory read --name pid-check")],
    revisionsDuringStep: 0,
  });
  assert.equal(result.verdict, "pass");
});

test("judgeReadSwitch is inconclusive without a read attempt and fails a live switch", () => {
  const untried = judgeReadSwitch({
    offPolicy: policy(false),
    overrideRow: { readEnabled: 0 },
    restoredPolicy: policy(true),
    instanceId: CLAUDE,
    trajectory: [],
    revisionsDuringStep: 0,
  });
  assert.equal(untried.verdict, "inconclusive");

  const stillOn = judgeReadSwitch({
    offPolicy: policy(true),
    overrideRow: { readEnabled: null },
    restoredPolicy: policy(true),
    instanceId: CLAUDE,
    trajectory: [codexTool("memory read --name pid-check")],
    revisionsDuringStep: 0,
  });
  assert.equal(stillOn.verdict, "fail");

  const notRestored = judgeReadSwitch({
    offPolicy: policy(false),
    overrideRow: { readEnabled: 0 },
    restoredPolicy: policy(false),
    instanceId: CLAUDE,
    trajectory: [codexTool("memory read --name pid-check")],
    revisionsDuringStep: 0,
  });
  assert.equal(notRestored.verdict, "fail");

  const wrote = judgeReadSwitch({
    offPolicy: policy(false),
    overrideRow: { readEnabled: 0 },
    restoredPolicy: policy(true),
    instanceId: CLAUDE,
    trajectory: [codexTool("memory read --name pid-check")],
    revisionsDuringStep: 1,
  });
  assert.equal(wrote.verdict, "fail");
});

test("judgePlacementModel fails any substituted binding or effort", () => {
  const expectedByParticipant = {
    [CODEX]: { bindingId: "local:codex-cli/v1:gpt-6-luna", effort: "low" },
    [CLAUDE]: { bindingId: "local:claude-cli/v1:haiku", effort: null },
  };
  const ok = judgePlacementModel({
    runs: [
      {
        runAttemptId: "r1",
        participantId: CODEX,
        resolvedModel: {
          modelBindingId: "local:codex-cli/v1:gpt-6-luna",
          reasoning: "low",
        },
      },
      {
        runAttemptId: "r2",
        participantId: CLAUDE,
        resolvedModel: { modelBindingId: "local:claude-cli/v1:haiku" },
      },
    ],
    expectedByParticipant,
  });
  assert.equal(ok.verdict, "pass");
  const substituted = judgePlacementModel({
    runs: [
      {
        runAttemptId: "r3",
        participantId: CLAUDE,
        resolvedModel: {
          modelBindingId: "local:claude-cli/v1:sonnet",
          reasoning: "low",
        },
      },
      { runAttemptId: "r4", participantId: CODEX, resolvedModel: null },
    ],
    expectedByParticipant,
  });
  assert.equal(substituted.verdict, "fail");
  assert.equal(substituted.problems.length, 3);
});

test("judgeBudget stops above the cap", () => {
  assert.equal(judgeBudget({ runAttempts: 40, maxRuns: 40 }).verdict, "pass");
  assert.equal(judgeBudget({ runAttempts: 41, maxRuns: 40 }).verdict, "fail");
});

test("combine ranks fail over inconclusive over pass", () => {
  assert.equal(combine(["pass", "pass"]), "pass");
  assert.equal(combine(["pass", "inconclusive"]), "inconclusive");
  assert.equal(combine(["inconclusive", "fail"]), "fail");
});

test("summarizeUsage keeps unknown values unknown", () => {
  const rows = [
    {
      inputTokens: 100,
      cachedInputTokens: 10,
      outputTokens: 5,
      reasoningOutputTokens: null,
      contextUsedTokens: 105,
      contextWindow: 1000,
    },
    {
      inputTokens: 200,
      cachedInputTokens: 150,
      outputTokens: 7,
      reasoningOutputTokens: 0,
      contextUsedTokens: null,
      contextWindow: null,
    },
  ];
  assert.deepEqual(summarizeUsage(rows), {
    generations: 2,
    inputTokens: 300,
    cachedInputTokens: 160,
    outputTokens: 12,
    reasoningOutputTokens: null,
    contextUsedTokens: 105,
    contextWindow: 1000,
  });
  assert.equal(summarizeUsage([]).inputTokens, null);
  assert.equal(summarizeUsage([]).generations, 0);
});

test("stateChanges keeps only transitions per room and instance", () => {
  const agent = (state, runAttemptId) => ({
    roomId: CHANNEL,
    participantId: CODEX,
    state,
    queued: false,
    runAttemptId,
  });
  const changes = stateChanges([
    { at: "t1", agents: [agent("waking")] },
    { at: "t2", agents: [agent("waking")] },
    { at: "t3", agents: [agent("working", "r1")] },
    { at: "t4", agents: [agent("idle")] },
  ]);
  assert.deepEqual(
    changes.map(({ at, state }) => [at, state]),
    [
      ["t1", "waking"],
      ["t3", "working"],
      ["t4", "idle"],
    ],
  );
});

test("sanitize removes credentials and home-path encodings", () => {
  const home = "/Users/sun";
  const evidence = sanitize(
    {
      accessToken: "abc",
      humanToken: "def",
      authorization: "Bearer xyz",
      inputTokens: 42,
      cachedInputTokens: 7,
      dir: "/Users/sun/.loom/acceptance/e2e-project",
      privatePath: "/private/Users/sun/x",
      encoded: "projects/-Users-sun-Code-repos-rah-os/abc.jsonl",
      command:
        '"$RAH_WORKER_CLI" worker message-post --turn CRcR67k1sqpew --final',
      env: "RAH_WORKER_TOKEN=s3cr3t LOOM_API_KEY=k1 other=1",
      header: "authorization: Bearer abc.def-ghi",
      nested: [{ [`${home}/key`]: "value", sessionToken: null }],
      unrelated: "/Users/sunny/elsewhere",
    },
    { home },
  );
  assert.equal(evidence.accessToken, "[redacted]");
  assert.equal(evidence.humanToken, "[redacted]");
  assert.equal(evidence.authorization, "[redacted]");
  assert.equal(evidence.inputTokens, 42);
  assert.equal(evidence.cachedInputTokens, 7);
  assert.equal(evidence.dir, "~/.loom/acceptance/e2e-project");
  assert.equal(evidence.privatePath, "~/x");
  assert.equal(evidence.encoded, "projects/~enc-Code-repos-rah-os/abc.jsonl");
  assert.equal(
    evidence.command,
    '"$RAH_WORKER_CLI" worker message-post --turn [redacted] --final',
  );
  assert.equal(
    evidence.env,
    "RAH_WORKER_TOKEN=[redacted] LOOM_API_KEY=[redacted] other=1",
  );
  assert.equal(evidence.header, "authorization: Bearer [redacted]");
  assert.deepEqual(evidence.nested, [{ "~/key": "value", sessionToken: null }]);
  assert.equal(evidence.unrelated, "/Users/sunny/elsewhere");
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /\/Users\/sun[/"]/u);
  assert.doesNotMatch(serialized, /-Users-sun-/u);
  assert.doesNotMatch(serialized, /s3cr3t|xyz|CRcR67/u);
});

test("sanitizeText leaves text without secrets unchanged", () => {
  assert.equal(
    sanitizeText("审查结论：PID 校验缺少存活检查", { home: "/Users/sun" }),
    "审查结论：PID 校验缺少存活检查",
  );
});

test("renderPlan lists every step, rule and the budget", () => {
  const plan = renderPlan({ maxRuns: 40 });
  for (const step of STEPS) assert.ok(plan.includes(step.title), step.title);
  assert.match(plan, /RunAttempt ≤ 40/u);
  assert.match(plan, /gpt-6-luna/u);
  assert.match(plan, /haiku/u);
});

test("renderReport shows verdicts, replies for review and limitations", () => {
  const report = renderReport({
    stamp: "20260927T101500Z",
    origin: "http://127.0.0.1:4176",
    gitHead: "abc1234",
    models: { codex: "gpt-6-luna / low", claude: "haiku / 无 effort" },
    channel: { name: "e2e-accept-x", roomId: CHANNEL },
    project: { dir: "~/.loom/acceptance/e2e-project", head: "def" },
    totals: { runAttempts: 12, generations: 30, maxRuns: 40 },
    overall: "inconclusive",
    steps: [
      {
        n: 6,
        title: "c. 私聊排队与隔离",
        verdict: "inconclusive",
        durationMs: 61_000,
        generations: 4,
        runs: [
          {
            runAttemptId: "run_1",
            label: "codex",
            roomLabel: "频道",
            state: "exited",
            executionMode: "warm",
            startedAt: "t0",
            finishedAt: "t1",
            usage: {
              generations: 2,
              inputTokens: 10,
              cachedInputTokens: 5,
              outputTokens: 3,
            },
            compactionCount: null,
          },
        ],
        judgments: {
          私聊: {
            verdict: "inconclusive",
            problems: [],
            notes: ["排队场景未覆盖"],
          },
        },
        problems: [],
        humanMessages: [{ roomSeq: 20, roomLabel: "频道", body: "任务 | x" }],
        replies: [
          {
            roomSeq: 25,
            label: "codex",
            roomLabel: "频道",
            latencyMs: 12_300,
            body: "第一行\n第二行",
          },
        ],
      },
    ],
    limitations: LIMITATIONS,
  });
  assert.match(report, /总判定：未覆盖/u);
  assert.match(report, /RunAttempt 12（上限 40），模型生成 30/u);
  assert.match(
    report,
    /\| 6\. c\. 私聊排队与隔离 \| 未覆盖 \| 61\.0 s \| 1 \| 4 \|/u,
  );
  assert.match(report, /任务 \\\| x/u);
  assert.match(report, /> 第一行\n> 第二行/u);
  assert.match(report, /延迟 12\.3 s/u);
  assert.match(report, /排队场景未覆盖/u);
  assert.match(report, /## 已知限制/u);
});

test("resuming a run clears the earlier run's stop reason and keeps it as history", () => {
  const saved = {
    stamp: "20260927T094812Z",
    steps: { 4: { verdict: "fail" } },
    stoppedReason:
      "异常：TypeError: Cannot read properties of undefined (reading 'messageId')",
  };
  const resumed = resumeState(saved);
  assert.equal(resumed.stoppedReason, undefined);
  assert.deepEqual(resumed.steps, saved.steps);
  assert.deepEqual(resumed.previousStops, [saved.stoppedReason]);
  assert.equal(saved.stoppedReason !== undefined, true, "input not mutated");
  assert.equal(resumeState({ stamp: "x" }).previousStops, undefined);
});

test("the stop reason is this run's: an emergency stop recorded in this run wins, otherwise the error at hand", () => {
  const timeout = new Error("步骤 7 等待超时");
  assert.equal(
    stopReason({
      recordedThisRun: undefined,
      error: timeout,
      isStopError: true,
    }),
    "步骤 7 等待超时",
  );
  assert.equal(
    stopReason({
      recordedThisRun: "RunAttempt 41 超过上限 40",
      error: timeout,
      isStopError: true,
    }),
    "RunAttempt 41 超过上限 40",
  );
  assert.match(
    stopReason({
      recordedThisRun: undefined,
      error: new TypeError("boom"),
      isStopError: false,
    }),
    /^异常：TypeError: boom/u,
  );
});
