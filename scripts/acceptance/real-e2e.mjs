#!/usr/bin/env node
// Opt-in formal-service end-to-end acceptance (owner-authorized, paid).
//
//   node scripts/acceptance/real-e2e.mjs --dry            # print the plan only
//   node scripts/acceptance/real-e2e.mjs --paid           # run every step
//   node scripts/acceptance/real-e2e.mjs --paid --step 6  # resume the latest run
//   node scripts/acceptance/real-e2e.mjs --paid --step 6 --run 20260927T101500Z
//
// It talks to the formal evo service (http://127.0.0.1:4176) through the
// gateway in trusted-proxy mode (placeholder bearer, the gateway injects the
// server-held Human token; this script never reads a token file). Writes use
// client-core RoomSession + runRoomMutationAtLatest with one persisted
// idempotency key per intent, so a resumed step never duplicates a mutation.
// Verdicts read only room.db (node:sqlite, read-only) and Human API
// responses; answer quality is left to the human reviewer. Step 9 restarts
// the launchd service (owner-authorized) after checking there is no active
// work and backing up the ledger.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { assertApprovedGateModel } from "../cli-efficiency/approved-models.mjs";
import {
  E2E_MODELS,
  LIMITATIONS,
  ROLE_INSTRUCTIONS,
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
  renderPlan,
  renderReport,
  resumeState,
  runStamp,
  sanitize,
  stateChanges,
  stopReason,
  summarizeUsage,
} from "./real-e2e-lib.mjs";

const REPO_ROOT = realpathSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", ".."),
);
const HOME = homedir();
const ORIGIN = "http://127.0.0.1:4176";
const LAUNCHD_LABEL = "com.loom.evo";
const ACCEPT = join(HOME, ".loom", "acceptance");
const PROJECT = join(ACCEPT, "e2e-project");
const STATE_DIR = join(ACCEPT, "state");
const RUNS_DIR = join(ACCEPT, "runs");
const BACKUPS_DIR = join(ACCEPT, "backups");
const EVO_STATE = join(HOME, ".loom", "evo", "state");
const ROOM_DB = join(EVO_STATE, "room.db");
const REGISTRY_DB = join(EVO_STATE, "runtime-registry.db");
const PROVIDER_SESSIONS = join(EVO_STATE, "supervisors", "provider-sessions");
const PROJECT_FILES = [
  "scripts/workbench-launch-receipt.mjs",
  "scripts/workbench-launch-receipt.test.mjs",
  "scripts/workbench-launch-mode.mjs",
];
const POLL_MS = 2_000;
const SETTLE_MS = 20_000;
const PHASE_TIMEOUT_MS = 15 * 60_000;
const RUN_START_TIMEOUT_MS = 120_000;
const RESTART_TIMEOUT_MS = 180_000;

class StopError extends Error {}

const log = (...parts) => console.log(new Date().toISOString(), ...parts);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// State (ids and idempotency keys only; never a credential).

let state;
let statePath;
let options;

function saveState() {
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function loadState() {
  mkdirSync(STATE_DIR, { recursive: true });
  if (options.step === 1 && options.run === undefined) {
    const stamp = runStamp(new Date());
    statePath = join(STATE_DIR, `${stamp}.json`);
    state = {
      stamp,
      startedAt: new Date().toISOString(),
      keys: {},
      posts: {},
      steps: {},
    };
    saveState();
    return;
  }
  const stamp =
    options.run ??
    readdirSync(STATE_DIR)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .at(-1)
      ?.replace(/\.json$/u, "");
  if (stamp === undefined) throw new StopError("没有可继续的验收状态");
  statePath = join(STATE_DIR, `${stamp}.json`);
  if (!existsSync(statePath)) throw new StopError(`状态文件不存在：${stamp}`);
  state = resumeState(JSON.parse(readFileSync(statePath, "utf8")));
  saveState();
  log("继续验收", stamp, "从步骤", options.step);
}

function intentKey(name) {
  state.keys[name] ??= `e2e-${name}-${randomUUID()}`;
  saveState();
  return state.keys[name];
}

// ---------------------------------------------------------------------------
// Transport: the typed SDK through the gateway, as the console does.

let sdk;
let client;

async function makeClient() {
  sdk ??= {
    ...(await import("@rah-os/client-sdk")),
    ...(await import("@rah-os/client-core")),
  };
  const root = await fetch(`${ORIGIN}/`);
  const cookie = root.headers.get("set-cookie")?.split(";", 1)[0];
  const extra = cookie ? { cookie, origin: ORIGIN } : { origin: ORIGIN };
  return new sdk.HttpRahClient({
    accessToken: () => "trusted-proxy-auth",
    baseUrl: ORIGIN,
    fetch: async (url, init) =>
      await fetch(url, { ...init, headers: { ...init?.headers, ...extra } }),
  });
}

function session(roomId) {
  return new sdk.RoomSession({
    client,
    consumerId: `e2e-accept-${randomUUID()}`,
    roomId,
  });
}

async function mutate(roomId, send) {
  return await sdk.runRoomMutationAtLatest({
    session: session(roomId),
    mutate: send,
  });
}

// ---------------------------------------------------------------------------
// Ledger (read-only).

function query(sql, params = {}) {
  const database = new DatabaseSync(ROOM_DB, { readOnly: true });
  try {
    return database.prepare(sql).all(params);
  } finally {
    database.close();
  }
}

const instanceIds = () => [
  state.instances.codex.instanceId,
  state.instances.claude.instanceId,
];

function inList(prefix, values) {
  const params = {};
  const names = values.map((value, index) => {
    params[`${prefix}${index}`] = value;
    return `:${prefix}${index}`;
  });
  return { sql: names.length === 0 ? "NULL" : names.join(","), params };
}

function stepRooms() {
  return [state.channel.roomId, state.direct?.roomId].filter(Boolean);
}

function messagesSince(rooms, since) {
  const r = inList("r", rooms);
  return query(
    `SELECT m.message_id AS messageId, m.room_id AS roomId, m.actor_id AS actorId,
            m.thread_id AS threadId, m.body AS body, m.created_at AS createdAt,
            e.room_seq AS roomSeq
       FROM messages m JOIN room_events e
         ON e.room_id=m.room_id AND e.aggregate_id=m.message_id AND e.type='message.posted'
      WHERE m.room_id IN (${r.sql}) AND m.created_at >= :since
      ORDER BY e.room_seq`,
    { ...r.params, since },
  );
}

function activationsSince(rooms, since) {
  const r = inList("r", rooms);
  const p = inList("p", instanceIds());
  return query(
    `SELECT activation_id AS activationId, room_id AS roomId, participant_id AS participantId,
            from_seq AS fromSeq, to_seq AS toSeq, reason, state, attempt_count AS attemptCount,
            last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt
       FROM activations
      WHERE room_id IN (${r.sql}) AND participant_id IN (${p.sql}) AND created_at >= :since
      ORDER BY created_at`,
    { ...r.params, ...p.params, since },
  );
}

function runsSince(since) {
  const p = inList("p", instanceIds());
  return query(
    `SELECT r.run_attempt_id AS runAttemptId, r.activation_id AS activationId,
            r.room_id AS roomId, r.participant_id AS participantId, r.state,
            r.attempt_number AS attemptNumber, r.exit_code AS exitCode,
            r.exit_signal AS exitSignal, r.error, r.started_at AS startedAt,
            r.finished_at AS finishedAt, r.execution_mode AS executionMode,
            r.session_resume_ms AS sessionResumeMs, r.instance_runtime_id AS instanceRuntimeId,
            json_extract(pl.decision_json, '$.resolvedModel') AS resolvedModel
       FROM run_attempts r LEFT JOIN placements pl ON pl.placement_id=r.placement_id
      WHERE r.participant_id IN (${p.sql}) AND r.started_at >= :since
      ORDER BY r.started_at`,
    { ...p.params, since },
  ).map((run) => ({
    ...run,
    resolvedModel:
      run.resolvedModel === null ? null : JSON.parse(run.resolvedModel),
  }));
}

function totalRunAttempts() {
  const p = inList("p", instanceIds());
  return query(
    `SELECT count(*) AS n FROM run_attempts WHERE participant_id IN (${p.sql})`,
    p.params,
  )[0].n;
}

function usageRows(runAttemptId) {
  return query(
    `SELECT input_tokens AS inputTokens, cached_input_tokens AS cachedInputTokens,
            output_tokens AS outputTokens, reasoning_output_tokens AS reasoningOutputTokens,
            context_window AS contextWindow, context_used_tokens AS contextUsedTokens,
            provider, observed_at AS observedAt
       FROM run_attempt_usage WHERE run_attempt_id=:id ORDER BY observed_at`,
    { id: runAttemptId },
  );
}

function trajectory(runIds) {
  const r = inList("r", runIds);
  return query(
    `SELECT entry_json AS entry FROM run_trajectory_entries
      WHERE run_attempt_id IN (${r.sql}) ORDER BY server_sequence`,
    r.params,
  ).map(({ entry }) => JSON.parse(entry));
}

function cursors(rooms) {
  const r = inList("r", rooms);
  const p = inList("p", instanceIds());
  return query(
    `SELECT room_id AS roomId, participant_id AS participantId, consumer_id AS consumerId,
            last_seq AS lastSeq FROM subscription_cursors
      WHERE room_id IN (${r.sql}) AND participant_id IN (${p.sql})`,
    { ...r.params, ...p.params },
  );
}

function sessionSnapshot() {
  const files = existsSync(PROVIDER_SESSIONS)
    ? readdirSync(PROVIDER_SESSIONS)
        .filter((name) => name.endsWith(".json"))
        .flatMap((name) => {
          try {
            return [
              JSON.parse(readFileSync(join(PROVIDER_SESSIONS, name), "utf8")),
            ];
          } catch {
            return [];
          }
        })
    : [];
  const snapshot = {};
  for (const participantId of instanceIds()) {
    const kernel = query(
      `SELECT generation, bound, bound_run_attempt_id AS boundRunAttemptId
         FROM role_instance_sessions WHERE instance_id=:id`,
      { id: participantId },
    )[0];
    const runtimes = query(
      `SELECT instance_runtime_id AS instanceRuntimeId, driver, state,
              native_session_id AS nativeSessionId, terminated_reason AS terminatedReason,
              started_at AS startedAt
         FROM instance_runtimes WHERE participant_id=:id ORDER BY started_at`,
      { id: participantId },
    );
    const bindings = files
      .filter((file) => file.participantId === participantId)
      .map(({ provider, providerSessionId, recordedAt }) => ({
        provider,
        providerSessionId,
        recordedAt,
      }));
    snapshot[participantId] = {
      generation: kernel?.generation ?? null,
      bound: kernel?.bound === 1,
      boundRunAttemptId: kernel?.boundRunAttemptId ?? null,
      bindings,
      runtimes,
      providerSessionIds: [
        ...new Set(
          [
            ...bindings.map(({ providerSessionId }) => providerSessionId),
            ...runtimes.map(({ nativeSessionId }) => nativeSessionId),
          ].filter(Boolean),
        ),
      ],
    };
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// Labels, budget and model fences.

function label(participantId) {
  if (participantId === state.instances?.codex?.instanceId) return "codex";
  if (participantId === state.instances?.claude?.instanceId) return "claude";
  if (participantId === state.identity?.principalId) return "Human";
  return participantId;
}

function roomLabel(roomId) {
  if (roomId === state.channel?.roomId) return "频道";
  if (roomId === state.direct?.roomId) return "codex 私聊";
  return roomId;
}

function expectedModels() {
  return Object.fromEntries(
    Object.values(state.instances).map((instance) => [
      instance.instanceId,
      { bindingId: instance.bindingId, effort: instance.effort },
    ]),
  );
}

async function emergencyStop(reason) {
  log("急停：", reason);
  state.stoppedReason = reason;
  saveState();
  for (const roomId of stepRooms()) {
    try {
      const key = intentKey(`sos-stop-${roomId}`);
      await mutate(roomId, (basedOnRoomSeq) =>
        client.request("room.sos.stop", {
          basedOnRoomSeq,
          idempotencyKey: key,
          roomId,
        }),
      );
    } catch (error) {
      log("急停请求失败", roomId, error.message);
    }
  }
}

async function enforceFences() {
  const runs = totalRunAttempts();
  if (runs > options.maxRuns) {
    await emergencyStop(`RunAttempt ${runs} 超过上限 ${options.maxRuns}`);
    throw new StopError(state.stoppedReason);
  }
  const model = judgePlacementModel({
    runs: runsSince(state.startedAt),
    expectedByParticipant: expectedModels(),
  });
  if (model.verdict !== "pass") {
    await emergencyStop(`模型不符：${model.problems.join("；")}`);
    throw new StopError(state.stoppedReason);
  }
}

function assertBudgetFor(minimumRuns) {
  const runs = totalRunAttempts();
  if (runs + minimumRuns > options.maxRuns)
    throw new StopError(
      `预算不足：已有 ${runs} 个 RunAttempt，本步至少需要 ${minimumRuns}，上限 ${options.maxRuns}`,
    );
}

// ---------------------------------------------------------------------------
// Human writes.

async function postHuman(name, roomId, body, recipients) {
  const existing = state.posts[name];
  if (existing?.messageId !== undefined) return existing;
  const key = intentKey(`post-${name}`);
  state.posts[name] = { roomId, body, attemptedAt: new Date().toISOString() };
  saveState();
  const response = await mutate(roomId, (basedOnRoomSeq) =>
    client.request("message.post", {
      basedOnRoomSeq,
      body,
      idempotencyKey: key,
      recipients: recipients.map((participantId) => ({
        participantId,
        reason: "mention",
      })),
      roomId,
    }),
  );
  const messageId = response.event.aggregateId;
  const row = query(
    `SELECT e.room_seq AS roomSeq, m.created_at AS createdAt FROM messages m
       JOIN room_events e ON e.room_id=m.room_id AND e.aggregate_id=m.message_id
        AND e.type='message.posted'
      WHERE m.message_id=:id`,
    { id: messageId },
  )[0];
  Object.assign(state.posts[name], {
    messageId,
    roomSeq: row?.roomSeq ?? null,
    createdAt: row?.createdAt ?? new Date().toISOString(),
    deduplicated: response.deduplicated,
  });
  saveState();
  log("Human 发帖", name, roomLabel(roomId), `#${row?.roomSeq}`);
  return state.posts[name];
}

// ---------------------------------------------------------------------------
// Waiting for a step to settle.

async function activitySample(rooms) {
  const watched = new Set(instanceIds());
  const agents = [];
  for (const roomId of rooms) {
    try {
      const response = await client.request("room.agent.activity.list", {
        roomId,
      });
      for (const agent of response.agents)
        if (watched.has(agent.participantId)) agents.push({ ...agent, roomId });
    } catch (error) {
      agents.push({
        roomId,
        participantId: "(poll)",
        state: `error: ${error.message}`,
      });
    }
  }
  return { at: new Date().toISOString(), agents };
}

async function awaitQuiet({ rooms, expected, since, afterSeq, samples }) {
  const deadline = Date.now() + PHASE_TIMEOUT_MS;
  let settledSince;
  let signature = "";
  while (Date.now() < deadline) {
    samples.push(await activitySample(rooms));
    await enforceFences();
    const messages = messagesSince(rooms, since);
    const activations = activationsSince(rooms, since);
    const runs = runsSince(since);
    const replied = expected.every(({ participantId, roomId }) =>
      messages.some(
        (message) =>
          message.actorId === participantId &&
          message.roomId === roomId &&
          message.roomSeq > (afterSeq[roomId] ?? 0),
      ),
    );
    const busy =
      activations.some(({ state: s }) => s === "queued" || s === "leased") ||
      runs.some(({ state: s }) => s === "starting" || s === "running");
    const next = JSON.stringify([
      messages.length,
      activations.map(({ activationId, state: s }) => [activationId, s]),
      runs.map(({ runAttemptId, state: s }) => [runAttemptId, s]),
    ]);
    if (next !== signature) {
      signature = next;
      settledSince = undefined;
    }
    if (replied && !busy) {
      settledSince ??= Date.now();
      if (Date.now() - settledSince >= SETTLE_MS) return { timedOut: false };
    }
    await sleep(POLL_MS);
  }
  return { timedOut: true };
}

async function awaitChannelRunStart(participantId, roomId, since) {
  const deadline = Date.now() + RUN_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const run = runsSince(since).find(
      (item) =>
        item.participantId === participantId &&
        item.roomId === roomId &&
        (item.state === "starting" || item.state === "running"),
    );
    if (run !== undefined) return run;
    await sleep(500);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Step evidence.

async function runDetail(run) {
  const usage = summarizeUsage(usageRows(run.runAttemptId));
  const agentId = Object.values(state.instances).find(
    ({ instanceId }) => instanceId === run.participantId,
  )?.agentId;
  let api = null;
  try {
    const response = await client.request("agent.run.usage.get", {
      agentId,
      runAttemptId: run.runAttemptId,
    });
    api = {
      completeness: response.completeness,
      compactionCount: response.compactionCount ?? null,
      execution: response.execution ?? null,
      finalInterrupt: response.finalInterrupt ?? null,
      gaps: response.gaps,
      totals: response.totals,
    };
  } catch (error) {
    api = { error: error.message };
  }
  return {
    ...run,
    label: label(run.participantId),
    roomLabel: roomLabel(run.roomId),
    usage,
    compactionCount: api?.compactionCount ?? null,
    api,
  };
}

async function collectStep({
  step,
  since,
  postNames,
  expected,
  samples,
  sessionBefore,
  timedOut,
  extraJudgments = {},
  extra,
}) {
  const rooms = stepRooms();
  const until = new Date().toISOString();
  const humanMessages = postNames
    .map((name) => state.posts[name])
    .filter(Boolean)
    .map((post) => ({ ...post, roomLabel: roomLabel(post.roomId) }));
  const afterSeq = {};
  for (const post of humanMessages)
    afterSeq[post.roomId] = Math.min(
      afterSeq[post.roomId] ?? Infinity,
      post.roomSeq,
    );
  const messages = messagesSince(rooms, since);
  const watched = new Set(instanceIds());
  const replies = messages
    .filter((message) => watched.has(message.actorId))
    .map((message) => {
      const trigger = humanMessages
        .filter(
          (post) =>
            post.roomId === message.roomId && post.roomSeq < message.roomSeq,
        )
        .at(-1);
      return {
        ...message,
        label: label(message.actorId),
        roomLabel: roomLabel(message.roomId),
        latencyMs:
          trigger === undefined
            ? null
            : Date.parse(message.createdAt) - Date.parse(trigger.createdAt),
      };
    });
  const activations = activationsSince(rooms, since);
  const runs = [];
  for (const run of runsSince(since)) runs.push(await runDetail(run));
  const sessionAfter = sessionSnapshot();
  const r = inList("r", rooms);
  const resets = query(
    `SELECT count(*) AS n FROM room_events
      WHERE room_id IN (${r.sql}) AND type='instance.session_reset' AND created_at >= :since`,
    { ...r.params, since },
  )[0].n;
  const sessionJudgment = judgeSession({
    before: sessionBefore,
    after: sessionAfter,
    participants: instanceIds().map((participantId) => ({
      participantId,
      label: label(participantId),
    })),
  });
  if (resets > 0) {
    sessionJudgment.problems.push(`出现 ${resets} 次 session reset 事件`);
    sessionJudgment.verdict = "fail";
  }
  const judgments = {
    交付: judgeDelivery({
      expected: expected.map((item) => ({
        ...item,
        label: `${label(item.participantId)}@${roomLabel(item.roomId)}`,
      })),
      messages,
      instanceIds: instanceIds(),
      afterSeq,
    }),
    ACK: judgeAck({ activations, cursors: cursors(rooms) }),
    session: sessionJudgment,
    模型: judgePlacementModel({
      runs,
      expectedByParticipant: expectedModels(),
    }),
    预算: judgeBudget({
      runAttempts: totalRunAttempts(),
      maxRuns: options.maxRuns,
    }),
    ...extraJudgments,
  };
  if (timedOut)
    judgments.超时 = {
      verdict: "fail",
      problems: [`等待超过 ${PHASE_TIMEOUT_MS / 60_000} 分钟`],
    };
  const evidence = {
    n: step.n,
    key: step.key,
    title: step.title,
    since,
    until,
    durationMs: Date.parse(until) - Date.parse(since),
    humanMessages,
    replies,
    activations,
    runs,
    generations: runs.reduce((total, run) => total + run.usage.generations, 0),
    stateSequence: stateChanges(samples).map((change) => ({
      ...change,
      label: label(change.participantId),
      roomLabel: roomLabel(change.roomId),
    })),
    sessionBefore,
    sessionAfter,
    judgments,
    verdict: combine(Object.values(judgments).map(({ verdict }) => verdict)),
    problems: Object.entries(judgments).flatMap(([name, judgment]) =>
      (judgment.problems ?? []).map((problem) => `${name}: ${problem}`),
    ),
    ...(extra === undefined ? {} : { extra }),
  };
  state.steps[step.key] = evidence;
  saveState();
  log(`步骤 ${step.n} 判定`, evidence.verdict, evidence.problems.join("；"));
  if (timedOut) throw new StopError(`步骤 ${step.n} 等待超时`);
  return evidence;
}

// ---------------------------------------------------------------------------
// Steps.

function git(args, cwd = PROJECT) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function stepProject() {
  if (!existsSync(PROJECT)) {
    mkdirSync(join(PROJECT, "scripts"), { recursive: true });
    for (const file of PROJECT_FILES)
      copyFileSync(join(REPO_ROOT, file), join(PROJECT, file));
    git(["init", "-q", "-b", "main"]);
    git(["add", "--", ...PROJECT_FILES]);
    git([
      "-c",
      "user.name=Loom Acceptance",
      "-c",
      "user.email=acceptance@loom.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "-m",
      "acceptance fixture: launch receipt module and tests",
    ]);
    log("已创建验收项目", PROJECT);
  }
  for (const file of PROJECT_FILES)
    if (!existsSync(join(PROJECT, file)))
      throw new StopError(`验收项目缺少 ${file}`);
  const tracked = git(["ls-files"]).split("\n").filter(Boolean);
  const unexpected = tracked.filter((file) => !PROJECT_FILES.includes(file));
  if (unexpected.length > 0)
    throw new StopError(
      `验收项目含预期外的文件：${unexpected.join(", ")}（请人工确认无凭据后再继续）`,
    );
  state.project = {
    dir: realpathSync(PROJECT),
    head: git(["rev-parse", "HEAD"]),
  };
  saveState();
}

async function stepChannel() {
  if (state.channel?.roomId === undefined) {
    const [me, workspaces] = await Promise.all([
      client.request("principal.me", {}),
      client.request("workspace.list", {}),
    ]);
    const workspace = workspaces.workspaces.find(
      (item) => item.state === "active" && item.controlRoomId,
    );
    if (workspace === undefined) throw new StopError("没有活动工作区");
    state.identity = {
      principalId: me.principal.principalId,
      workspaceId: workspace.workspaceId,
      controlRoomId: workspace.controlRoomId,
    };
    const name = `e2e-accept-${state.stamp.toLowerCase()}`;
    const key = intentKey("room-create");
    const response = await mutate(
      state.identity.controlRoomId,
      (basedOnControlRoomSeq) =>
        client.request("room.create", {
          additionalDirectories: [state.project.dir],
          basedOnControlRoomSeq,
          idempotencyKey: key,
          kind: "channel",
          name,
          slug: name,
          workspaceId: state.identity.workspaceId,
        }),
    );
    state.channel = {
      roomId: response.room.roomId,
      name,
      created: response.room.channelWorkspace ?? null,
    };
    saveState();
    log("频道", name, state.channel.roomId);
  }
  const deadline = Date.now() + 30_000;
  for (;;) {
    const rooms = await client.request("room.list", {});
    const room = rooms.rooms.find(
      (item) => item.roomId === state.channel.roomId,
    );
    state.channel.workspace = room?.channelWorkspace ?? null;
    saveState();
    const primary = room?.channelWorkspace?.primary?.state;
    if (primary === "ready") break;
    if (Date.now() > deadline)
      throw new StopError(`频道主目录未就绪：${String(primary)}`);
    await sleep(POLL_MS);
  }
  const attached = state.channel.workspace?.additionalDirectories ?? [];
  if (!JSON.stringify(attached).includes(state.project.dir))
    throw new StopError("频道附加目录不含验收项目");
}

function modelIntentFor(bindingId, effort) {
  return {
    exactBindingIds: [bindingId],
    fallback: "disabled",
    ...(effort === null ? {} : { reasoning: effort }),
  };
}

async function stepRoles() {
  state.instances ??= {};
  const inventory = await client.request("host.runtime.list", {});
  const roles = await client.request("role.list", {
    controlRoomId: state.identity.controlRoomId,
  });
  for (const spec of Object.values(E2E_MODELS)) {
    if (state.instances[spec.provider]?.instanceId !== undefined) continue;
    assertApprovedGateModel({
      provider: spec.provider,
      model: spec.model,
      effort: spec.effort,
    });
    const offer = inventory.runtimes.find(
      (runtime) =>
        runtime.available &&
        runtime.runtimeOfferId?.startsWith(spec.offerPrefix),
    );
    if (offer === undefined)
      throw new StopError(`${spec.provider}: Host 没有可用 offer`);
    const binding = offer.modelBindingDescriptors.find(
      (item) => item.modelBindingId.split(":").at(-1) === spec.model,
    );
    if (binding === undefined)
      throw new StopError(`${spec.provider}: 目录未发布 ${spec.model}`);
    const published = binding.supportedReasoning ?? [];
    if (
      spec.effort === null
        ? published.length > 0
        : !published.includes(spec.effort)
    )
      throw new StopError(
        `${spec.provider}: ${spec.model} 发布的推理 [${published.join(",")}] 与批准的 ${String(spec.effort)} 不符`,
      );
    const modelIntent = modelIntentFor(binding.modelBindingId, spec.effort);
    let role = roles.roles.find(
      (item) => item.configuration.handle === spec.handle,
    );
    if (role !== undefined) {
      if (
        role.configuration.runtimeOfferId !== offer.runtimeOfferId ||
        !isDeepStrictEqual(role.configuration.modelIntent, modelIntent)
      )
        throw new StopError(
          `已有 Role ${spec.handle} 的 offer/modelIntent 与预期不符，拒绝复用（请人工修订或改名）`,
        );
      log("复用 Role", spec.handle, role.roleId);
    } else {
      const key = intentKey(`role-create-${spec.provider}`);
      const configuration = {
        displayName: spec.displayName,
        handle: spec.handle,
        instructions: ROLE_INSTRUCTIONS,
        modelIntent,
        role: "只读代码审查",
        runtimeOfferId: offer.runtimeOfferId,
      };
      const response = await mutate(
        state.identity.controlRoomId,
        (basedOnRoomSeq) =>
          client.request("role.create", {
            basedOnRoomSeq,
            configuration,
            controlRoomId: state.identity.controlRoomId,
            idempotencyKey: key,
          }),
      );
      role = response.role;
      if (!isDeepStrictEqual(role.configuration.modelIntent, modelIntent))
        throw new StopError(`${spec.provider}: 服务端回显 modelIntent 不一致`);
      log("创建 Role", spec.handle, role.roleId);
    }
    const key = intentKey(`instantiate-${spec.provider}`);
    const response = await mutate(state.channel.roomId, (basedOnRoomSeq) =>
      client.request("role.instantiate", {
        basedOnRoomSeq,
        channelId: state.channel.roomId,
        idempotencyKey: key,
        roleId: role.roleId,
      }),
    );
    state.instances[spec.provider] = {
      instanceId: response.instance.instanceId,
      agentId: response.instance.agentId,
      handle: response.agent.handle,
      roleId: role.roleId,
      roleRevisionId: response.instance.roleRevisionId,
      runtimeOfferId: offer.runtimeOfferId,
      runtimeVersion: offer.version ?? null,
      bindingId: binding.modelBindingId,
      effort: spec.effort,
      modelIntent: role.configuration.modelIntent,
    };
    saveState();
    log("实例", spec.provider, response.agent.handle);
  }
}

function texts() {
  return prompts({
    codex: state.instances.codex.handle,
    claude: state.instances.claude.handle,
    memoryName: state.memoryName,
  });
}

async function conversation(step, { phases, expected, minimumRuns, extra }) {
  assertBudgetFor(minimumRuns);
  const since =
    state.posts[phases[0].name]?.attemptedAt ?? new Date().toISOString();
  const sessionBefore = sessionSnapshot();
  const samples = [];
  let timedOut = false;
  for (const phase of phases) {
    const post = await postHuman(
      phase.name,
      phase.roomId,
      phase.body,
      phase.recipients,
    );
    const result = await awaitQuiet({
      rooms: stepRooms(),
      expected: phase.expected,
      since,
      afterSeq: { [post.roomId]: post.roomSeq },
      samples,
    });
    if (result.timedOut) {
      timedOut = true;
      break;
    }
  }
  return await collectStep({
    step,
    since,
    postNames: phases.map(({ name }) => name),
    expected,
    samples,
    sessionBefore,
    timedOut,
    extra,
  });
}

const target = (provider, roomId) => ({
  participantId: state.instances[provider].instanceId,
  roomId: roomId ?? state.channel.roomId,
});

async function stepReview(step) {
  const both = [target("codex"), target("claude")];
  await conversation(step, {
    minimumRuns: 2,
    expected: both,
    phases: [
      {
        name: "review",
        roomId: state.channel.roomId,
        body: texts().review,
        recipients: instanceIds(),
        expected: both,
      },
    ],
  });
}

async function stepFollowup(step) {
  const both = [target("codex"), target("claude")];
  await conversation(step, {
    minimumRuns: 2,
    expected: both,
    phases: [
      {
        name: "followup",
        roomId: state.channel.roomId,
        body: texts().followup,
        recipients: instanceIds(),
        expected: both,
      },
    ],
  });
}

async function openPrivateBox() {
  if (state.direct?.roomId !== undefined) return;
  const key = intentKey("direct-open");
  const response = await mutate(
    state.identity.controlRoomId,
    (basedOnControlRoomSeq) =>
      client.request("room.direct.open", {
        basedOnControlRoomSeq,
        idempotencyKey: key,
        peerPrincipalId: state.instances.codex.instanceId,
        workspaceId: state.identity.workspaceId,
      }),
  );
  state.direct = { roomId: response.room.roomId };
  saveState();
  log("私聊已打开", state.direct.roomId);
}

async function stepPrivate(step) {
  assertBudgetFor(2);
  // The box is opened first so the private question can follow the channel
  // run start with no extra control-room round trip in between.
  await openPrivateBox();
  const codex = state.instances.codex.instanceId;
  const claude = state.instances.claude.instanceId;
  const since = state.posts.longTask?.attemptedAt ?? new Date().toISOString();
  const sessionBefore = sessionSnapshot();
  const samples = [];
  const longTask = await postHuman(
    "longTask",
    state.channel.roomId,
    texts().longTask,
    [codex],
  );
  if (state.posts.privateQuestion?.messageId === undefined) {
    const run = await awaitChannelRunStart(codex, state.channel.roomId, since);
    if (run === undefined) log("未观察到 codex 频道轮开始，仍发送私聊问题");
    else log("codex 频道轮已开始", run.runAttemptId);
  }
  const question = await postHuman(
    "privateQuestion",
    state.direct.roomId,
    texts().privateQuestion,
    [],
  );
  const expected = [target("codex"), target("codex", state.direct.roomId)];
  const result = await awaitQuiet({
    rooms: stepRooms(),
    expected,
    since,
    afterSeq: {
      [state.channel.roomId]: longTask.roomSeq,
      [state.direct.roomId]: question.roomSeq,
    },
    samples,
  });
  const runs = runsSince(since);
  const channelRuns = runs.filter(
    (run) => run.participantId === codex && run.roomId === state.channel.roomId,
  );
  const channelRun =
    channelRuns.find((run) => run.startedAt <= question.createdAt) ??
    channelRuns[0];
  const privateRun = runs.find(
    (run) => run.participantId === codex && run.roomId === state.direct.roomId,
  );
  const directRoom = { id: state.direct.roomId };
  const members = query(
    "SELECT principal_id AS id FROM memberships WHERE room_id=:id",
    directRoom,
  ).map(({ id }) => id);
  const otherInbox = query(
    "SELECT count(*) AS n FROM inbox_items WHERE room_id=:id AND participant_id=:p",
    { ...directRoom, p: claude },
  )[0].n;
  const otherMessages = query(
    "SELECT count(*) AS n FROM messages WHERE room_id=:id AND actor_id=:p",
    { ...directRoom, p: claude },
  )[0].n;
  const privateBox = judgePrivateBox({
    channelRun,
    privateRun,
    privateMessageAt: question.createdAt,
    members,
    humanId: state.identity.principalId,
    instanceId: codex,
    otherInstanceId: claude,
    otherInboxCount: otherInbox,
    otherMessageCount: otherMessages,
  });
  await collectStep({
    step,
    since,
    postNames: ["longTask", "privateQuestion"],
    expected,
    samples,
    sessionBefore,
    timedOut: result.timedOut,
    extraJudgments: { 私聊: privateBox },
    extra: {
      channelRunAttemptId: channelRun?.runAttemptId ?? null,
      privateRunAttemptId: privateRun?.runAttemptId ?? null,
      privateMessageAt: question.createdAt,
      directMembers: members.map(label),
    },
  });
}

async function stepMemory(step) {
  assertBudgetFor(2);
  const codex = state.instances.codex.instanceId;
  const claude = state.instances.claude.instanceId;
  const since =
    state.posts.memoryWrite?.attemptedAt ?? new Date().toISOString();
  const sessionBefore = sessionSnapshot();
  const samples = [];
  const write = await postHuman(
    "memoryWrite",
    state.channel.roomId,
    texts().memoryWrite,
    [codex],
  );
  let result = await awaitQuiet({
    rooms: stepRooms(),
    expected: [target("codex")],
    since,
    afterSeq: { [state.channel.roomId]: write.roomSeq },
    samples,
  });
  const entries = query(
    `SELECT entry_id AS entryId, scope_room_id AS scopeRoomId, name, type, description,
            body, state, revision, created_at AS createdAt
       FROM memory_entries WHERE scope_room_id=:room AND created_at >= :since`,
    { room: state.channel.roomId, since },
  );
  const e = inList(
    "e",
    entries.map(({ entryId }) => entryId),
  );
  const revisions = query(
    `SELECT entry_id AS entryId, revision, op, actor_kind AS actorKind,
            actor_principal_id AS actorPrincipalId, instance_id AS instanceId,
            role_id AS roleId, model_binding_id AS modelBindingId,
            model_reasoning AS modelReasoning, session_generation AS sessionGeneration,
            run_attempt_id AS runAttemptId, via_room_id AS viaRoomId,
            based_on_room_seq AS basedOnRoomSeq, created_at AS createdAt
       FROM memory_revisions WHERE entry_id IN (${e.sql}) ORDER BY created_at`,
    e.params,
  );
  const writerRunIds = runsSince(since)
    .filter((run) => run.participantId === codex)
    .map(({ runAttemptId }) => runAttemptId);
  const memoryWrite = judgeMemoryWrite({
    entries,
    revisions,
    writerInstanceId: codex,
    writerRunIds,
    channelId: state.channel.roomId,
  });
  state.memoryName = memoryWrite.name ?? undefined;
  saveState();
  let memoryRead = {
    verdict: "fail",
    problems: ["未执行（写入阶段超时）"],
  };
  const readSince =
    state.posts.memoryRead?.attemptedAt ?? new Date().toISOString();
  if (!result.timedOut) {
    const read = await postHuman(
      "memoryRead",
      state.channel.roomId,
      texts().memoryRead,
      [claude],
    );
    result = await awaitQuiet({
      rooms: stepRooms(),
      expected: [target("claude")],
      since,
      afterSeq: { [state.channel.roomId]: read.roomSeq },
      samples,
    });
    const claudeRuns = runsSince(readSince)
      .filter((run) => run.participantId === claude)
      .map(({ runAttemptId }) => runAttemptId);
    memoryRead = judgeMemoryRead({ trajectory: trajectory(claudeRuns) });
  }
  await collectStep({
    step,
    since,
    postNames: ["memoryWrite", "memoryRead"],
    expected: [target("codex"), target("claude")],
    samples,
    sessionBefore,
    timedOut: result.timedOut,
    extraJudgments: { 记忆写入: memoryWrite, 记忆读回: memoryRead },
    extra: {
      entries: entries.map(({ body, ...entry }) => ({
        ...entry,
        body: body?.slice(0, 2_000) ?? null,
      })),
      revisions,
    },
  });
}

function unwrapPolicy(response) {
  return response.policy ?? response;
}

async function setReadOverride(read, keyName) {
  const claude = state.instances.claude.instanceId;
  const current = unwrapPolicy(
    await client.request("memory.policy.read", {
      channelId: state.channel.roomId,
    }),
  );
  const key = intentKey(keyName);
  const response = await client.request("memory.policy.update", {
    channelId: state.channel.roomId,
    expectedRevision: current.revision,
    idempotencyKey: key,
    overrides: [{ instanceId: claude, read, write: null }],
  });
  return response.policy;
}

async function stepReadSwitch(step) {
  assertBudgetFor(1);
  const claude = state.instances.claude.instanceId;
  const since =
    state.posts.memoryDenied?.attemptedAt ?? new Date().toISOString();
  const sessionBefore = sessionSnapshot();
  const samples = [];
  let offPolicy;
  let restoredPolicy;
  let overrideRow;
  let result = { timedOut: false };
  try {
    offPolicy = await setReadOverride(false, "policy-read-off");
    overrideRow = query(
      `SELECT read_enabled AS readEnabled, write_enabled AS writeEnabled
         FROM memory_access_overrides WHERE room_id=:room AND instance_id=:id`,
      { room: state.channel.roomId, id: claude },
    )[0];
    log("claude 读开关已关闭，开关修订", offPolicy.revision);
    const denied = await postHuman(
      "memoryDenied",
      state.channel.roomId,
      texts().memoryDenied,
      [claude],
    );
    result = await awaitQuiet({
      rooms: stepRooms(),
      expected: [target("claude")],
      since,
      afterSeq: { [state.channel.roomId]: denied.roomSeq },
      samples,
    });
  } finally {
    restoredPolicy = await setReadOverride(null, "policy-read-restore");
    log("claude 读开关已恢复为继承，开关修订", restoredPolicy.revision);
  }
  const claudeRuns = runsSince(since)
    .filter((run) => run.participantId === claude)
    .map(({ runAttemptId }) => runAttemptId);
  const revisionsDuringStep = query(
    `SELECT count(*) AS n FROM memory_revisions v JOIN memory_entries m ON m.entry_id=v.entry_id
      WHERE m.scope_room_id=:room AND v.created_at >= :since`,
    { room: state.channel.roomId, since },
  )[0].n;
  const readSwitch = judgeReadSwitch({
    offPolicy,
    overrideRow,
    restoredPolicy,
    instanceId: claude,
    trajectory: trajectory(claudeRuns),
    revisionsDuringStep,
  });
  const marks = query(
    `SELECT session_generation AS sessionGeneration, served_read_enabled AS servedReadEnabled,
            index_state AS indexState, index_seq AS indexSeq, delta_seq AS deltaSeq,
            updated_at AS updatedAt
       FROM memory_index_marks WHERE instance_id=:id`,
    { id: claude },
  );
  await collectStep({
    step,
    since,
    postNames: ["memoryDenied"],
    expected: [target("claude")],
    samples,
    sessionBefore,
    timedOut: result.timedOut,
    extraJudgments: { 读开关: readSwitch },
    extra: {
      offPolicyRevision: offPolicy?.revision ?? null,
      restoredPolicyRevision: restoredPolicy?.revision ?? null,
      overrideRow: overrideRow ?? null,
      memoryIndexMarks: marks,
    },
  });
}

function launchdPid() {
  const uid = userInfo().uid;
  try {
    const text = execFileSync(
      "launchctl",
      ["print", `gui/${uid}/${LAUNCHD_LABEL}`],
      { encoding: "utf8" },
    );
    const match = /^\s*pid = (\d+)/mu.exec(text);
    return match === null ? null : Number(match[1]);
  } catch {
    return null;
  }
}

function activeWork() {
  return {
    activations: query(
      "SELECT count(*) AS n FROM activations WHERE state IN ('queued','leased')",
    )[0].n,
    runs: query(
      "SELECT count(*) AS n FROM run_attempts WHERE state IN ('starting','running')",
    )[0].n,
    orphaned: query(
      "SELECT count(*) AS n FROM run_attempts WHERE state='orphaned'",
    )[0].n,
  };
}

function backupLedger() {
  const directory = join(BACKUPS_DIR, state.stamp);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  for (const [source, name] of [
    [ROOM_DB, "room.db"],
    [REGISTRY_DB, "runtime-registry.db"],
  ]) {
    const destination = join(directory, name);
    if (existsSync(destination)) continue;
    execFileSync("sqlite3", ["-readonly", source, `.backup '${destination}'`]);
    chmodSync(destination, 0o600);
  }
  return directory;
}

async function restartService() {
  const work = activeWork();
  if (work.activations > 0 || work.runs > 0)
    throw new StopError(
      `重启前仍有活动工作（排队/租约 Activation ${work.activations}，运行中 RunAttempt ${work.runs}），不强杀，停止`,
    );
  // The service runs from this worktree, so a restart deploys whatever is
  // checked out: refuse when tracked files carry uncommitted changes.
  const dirty = git(
    ["status", "--porcelain", "--untracked-files=no"],
    REPO_ROOT,
  )
    .split("\n")
    .filter(Boolean);
  if (dirty.length > 0)
    throw new StopError(
      `仓库有未提交的已跟踪改动，重启会把它们部署到正式服务：${dirty.join("; ")}`,
    );
  const deployedHead = git(["rev-parse", "HEAD"], REPO_ROOT);
  const backupDir = backupLedger();
  const pidBefore = launchdPid();
  if (pidBefore === null)
    throw new StopError(`launchd ${LAUNCHD_LABEL} 未运行`);
  const started = Date.now();
  log("重启服务", LAUNCHD_LABEL, "旧 pid", pidBefore);
  execFileSync("launchctl", [
    "kickstart",
    "-k",
    `gui/${userInfo().uid}/${LAUNCHD_LABEL}`,
  ]);
  const deadline = started + RESTART_TIMEOUT_MS;
  let pidAfter = null;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    pidAfter = launchdPid();
    if (pidAfter === null || pidAfter === pidBefore) continue;
    try {
      client = await makeClient();
      await client.request("principal.me", {});
      const inventory = await client.request("host.runtime.list", {});
      // A CLI self-update imports a new profile revision on restart, so the
      // offer id captured at Role creation may be superseded; readiness is an
      // available offer for the same CLI profile.
      const profileOf = (offerId) => offerId.split(":")[0];
      const ready = Object.values(state.instances).every(({ runtimeOfferId }) =>
        inventory.runtimes.some(
          (runtime) =>
            runtime.available &&
            profileOf(runtime.runtimeOfferId) === profileOf(runtimeOfferId),
        ),
      );
      if (ready)
        return {
          pidBefore,
          pidAfter,
          restartMs: Date.now() - started,
          backupDir,
          deployedHead,
          activeWorkBefore: work,
        };
    } catch {
      // Not serving yet.
    }
  }
  throw new StopError(
    `服务 ${RESTART_TIMEOUT_MS / 1000} s 内未恢复（pid ${String(pidAfter)}）`,
  );
}

async function stepRestart(step) {
  assertBudgetFor(2);
  if (state.restart === undefined) {
    const sessionBeforeRestart = sessionSnapshot();
    const restart = await restartService();
    state.restart = { ...restart, sessionBeforeRestart };
    saveState();
    log("服务已恢复，新 pid", restart.pidAfter, `${restart.restartMs} ms`);
  }
  const both = [target("codex"), target("claude")];
  const since =
    state.posts.afterRestart?.attemptedAt ?? new Date().toISOString();
  const samples = [];
  const post = await postHuman(
    "afterRestart",
    state.channel.roomId,
    texts().afterRestart,
    instanceIds(),
  );
  const result = await awaitQuiet({
    rooms: stepRooms(),
    expected: both,
    since,
    afterSeq: { [state.channel.roomId]: post.roomSeq },
    samples,
  });
  const { sessionBeforeRestart, ...restart } = state.restart;
  await collectStep({
    step,
    since,
    postNames: ["afterRestart"],
    expected: both,
    samples,
    sessionBefore: sessionBeforeRestart,
    timedOut: result.timedOut,
    extraJudgments: {
      重启: {
        verdict:
          restart.pidAfter !== restart.pidBefore && restart.pidAfter !== null
            ? "pass"
            : "fail",
        problems: restart.pidAfter !== restart.pidBefore ? [] : ["pid 未变化"],
      },
    },
    extra: restart,
  });
}

async function stepConsole(step) {
  const since = new Date().toISOString();
  const problems = [];
  const probe = execFileSync(
    "curl",
    [
      "-s",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code} %{content_type}",
      `${ORIGIN}/_rah/console/`,
    ],
    { encoding: "utf8" },
  ).trim();
  const [status, contentType = ""] = probe.split(" ");
  if (status !== "200" || !contentType.startsWith("text/html"))
    problems.push(`控制台返回 ${probe}`);
  const model = await import("../../apps/console/src/model.ts");
  const rooms = (await client.request("room.list", {})).rooms;
  const statuses = await model.loadInstanceStatuses(client, {
    controlRoomId: state.identity.controlRoomId,
    roomId: state.channel.roomId,
    rooms,
  });
  const cards = [];
  for (const [provider, instance] of Object.entries(state.instances)) {
    const card = statuses.find(
      ({ instanceId }) => instanceId === instance.instanceId,
    );
    if (card === undefined) {
      problems.push(`${provider}: 控制台无实例卡片`);
      continue;
    }
    if (!card.member) problems.push(`${provider}: 卡片显示已移出频道`);
    if (typeof card.compactionLabel !== "string")
      problems.push(`${provider}: 无压缩次数标签`);
    const latest = runsSince(state.startedAt)
      .filter(
        (run) =>
          run.participantId === instance.instanceId &&
          run.roomId === state.channel.roomId,
      )
      .at(-1);
    let usage = null;
    if (latest !== undefined) {
      try {
        usage = model.runUsageDetail(
          await client.request("agent.run.usage.get", {
            agentId: instance.agentId,
            runAttemptId: latest.runAttemptId,
          }),
        );
      } catch (error) {
        problems.push(`${provider}: RunAttempt 用量读取失败 ${error.message}`);
      }
    }
    cards.push({
      provider,
      handle: card.handle,
      stateLabel: card.stateLabel,
      queuedLabel: card.queuedLabel,
      compactionLabel: card.compactionLabel,
      privateBoxLabel: card.privateBoxLabel,
      lastError: card.lastError,
      recentRuns: card.runs,
      latestRunAttemptId: latest?.runAttemptId ?? null,
      latestRunUsage: usage,
    });
  }
  const labels = new Map(
    Object.entries(state.instances).map(([provider, { instanceId }]) => [
      instanceId,
      provider,
    ]),
  );
  const usage = await model.loadUsage(client, {
    channelId: state.channel.roomId,
    labels,
    now: new Date(),
    window: "24h",
  });
  for (const provider of Object.keys(state.instances))
    if (!usage.rows.some((row) => row.label === provider))
      problems.push(`${provider}: 频道用量汇总无该实例`);
  const judgment = {
    verdict: problems.length === 0 ? "pass" : "fail",
    problems,
  };
  state.steps[step.key] = {
    n: step.n,
    key: step.key,
    title: step.title,
    since,
    until: new Date().toISOString(),
    durationMs: Date.now() - Date.parse(since),
    runs: [],
    generations: 0,
    judgments: { 控制台: judgment },
    verdict: judgment.verdict,
    problems,
    extra: { consoleHttp: probe, cards, usage },
  };
  saveState();
  log(`步骤 ${step.n} 判定`, judgment.verdict, problems.join("；"));
}

function writeReport() {
  const steps = STEPS.map(({ key }) => state.steps[key]).filter(Boolean);
  let runs = [];
  let generations = 0;
  try {
    if (state.instances !== undefined) {
      runs = runsSince(state.startedAt);
      generations = runs.reduce(
        (total, run) => total + usageRows(run.runAttemptId).length,
        0,
      );
    }
  } catch (error) {
    log("统计调用规模失败", error.message);
  }
  let gitHead = null;
  try {
    gitHead = git(["rev-parse", "--short", "HEAD"], REPO_ROOT);
  } catch {
    // Unknown.
  }
  const overall = state.stoppedReason
    ? "fail"
    : combine(steps.map(({ verdict }) => verdict));
  const evidence = sanitize(
    {
      stamp: state.stamp,
      origin: ORIGIN,
      gitHead,
      startedAt: state.startedAt,
      finishedAt: new Date().toISOString(),
      models: state.instances
        ? {
            codex: `${state.instances.codex?.bindingId} / ${state.instances.codex?.effort}`,
            claude: `${state.instances.claude?.bindingId} / 无 effort`,
          }
        : null,
      project: state.project,
      channel: state.channel
        ? { roomId: state.channel.roomId, name: state.channel.name }
        : null,
      direct: state.direct ?? null,
      instances: state.instances ?? null,
      totals: {
        runAttempts: runs.length,
        generations,
        maxRuns: options.maxRuns,
        perInstance: Object.fromEntries(
          Object.entries(state.instances ?? {}).map(([provider, instance]) => [
            provider,
            runs.filter((run) => run.participantId === instance.instanceId)
              .length,
          ]),
        ),
      },
      overall,
      stoppedReason: state.stoppedReason ?? null,
      steps,
      limitations: LIMITATIONS,
    },
    { home: HOME },
  );
  const directory = join(RUNS_DIR, state.stamp);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  writeFileSync(join(directory, "report.md"), renderReport(evidence));
  log("证据：", join(directory, "evidence.json"));
  log("报告：", join(directory, "report.md"));
  log(
    `调用规模：RunAttempt ${runs.length}（上限 ${options.maxRuns}），模型生成 ${generations}；总判定 ${overall}`,
  );
}

const HANDLERS = {
  project: stepProject,
  channel: stepChannel,
  roles: stepRoles,
  review: stepReview,
  followup: stepFollowup,
  private: stepPrivate,
  memory: stepMemory,
  readSwitch: stepReadSwitch,
  restart: stepRestart,
  console: stepConsole,
  report: async () => undefined,
};

function usage() {
  return [
    "用法：node scripts/acceptance/real-e2e.mjs (--dry | --paid) [--step N] [--run STAMP] [--until N] [--max-runs N]",
    "  --dry        只打印步骤、提示词模板与判定规则；不访问网络、不调用模型",
    "  --paid       在正式服务上执行（负责人授权的付费运行）",
    "  --step N     从第 N 步继续（默认沿用最近一次状态，或用 --run 指定）",
    `  --max-runs N 总 RunAttempt 上限（1..40，默认 40）`,
  ].join("\n");
}

async function main() {
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n${usage()}`);
    process.exit(2);
  }
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.dry) {
    for (const spec of Object.values(E2E_MODELS))
      assertApprovedGateModel({
        provider: spec.provider,
        model: spec.model,
        effort: spec.effort,
      });
    console.log(renderPlan({ maxRuns: options.maxRuns }));
    console.log("\n提示词模板（<codex>/<claude> 为服务端生成的实例 handle）：");
    for (const [name, body] of Object.entries(
      prompts({ codex: "<codex>", claude: "<claude>", memoryName: "<记忆名>" }),
    ))
      console.log(`- ${name}: ${body}`);
    console.log(
      `\n路径：项目 ${PROJECT}；状态 ${STATE_DIR}；证据 ${RUNS_DIR}/<时间>/；重启前备份 ${BACKUPS_DIR}/<时间>/`,
    );
    return;
  }
  if (!options.paid) {
    console.error(`拒绝运行：需要 --paid（或 --dry 只看计划）。\n${usage()}`);
    process.exit(2);
  }
  loadState();
  try {
    client = await makeClient();
    for (const step of STEPS) {
      if (step.n < options.step) continue;
      if (options.until !== undefined && step.n > options.until) break;
      if (step.n > 3 && state.instances?.claude?.instanceId === undefined)
        throw new StopError("缺少前置状态（频道/实例），请从步骤 1 开始");
      log(`== 步骤 ${step.n}：${step.title}`);
      await HANDLERS[step.key](step);
    }
  } catch (error) {
    state.stoppedReason = stopReason({
      recordedThisRun: state.stoppedReason,
      error,
      isStopError: error instanceof StopError,
    });
    saveState();
    log("停止：", state.stoppedReason);
    process.exitCode = 1;
  } finally {
    writeReport();
  }
}

await main();
