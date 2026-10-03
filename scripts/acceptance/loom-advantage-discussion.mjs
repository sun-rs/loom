#!/usr/bin/env node
/** P96: one authorized unattended discussion; no rescue and no automatic rerun. */
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  globSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { measure } from "../cli-efficiency/common.mjs";

import { assertApprovedGateModel } from "../cli-efficiency/approved-models.mjs";
import { judgePlacementModel } from "./real-e2e-lib.mjs";

const ORIGIN = "http://127.0.0.1:4176";
const HOME = homedir();
const PROJECT = process.cwd();
const REVIEW = join(HOME, ".loom", "reviews");
const RUNS_DIR = join(PROJECT, "docs/evo/evidence");
const EVIDENCE = join(RUNS_DIR, "2026-10-03-loom-advantage-discussion.json");
const ROOM_DB = join(HOME, ".loom", "evo", "state", "room.db");
const POLL_MS = 2_000;
const QUIET_MS = 90_000;
const TIMEOUT_MS = 25 * 60_000;
const MAX_RUNS = 15;

export const MODELS = Object.freeze(
  Object.fromEntries(
    [
      ["solA", "gpt-6-sol", "disc-sol-a"],
      ["solB", "gpt-6-sol", "disc-sol-b"],
      ["astra", "gpt-6-astra", "disc-astra"],
    ].map(([key, model, handle]) => [
      key,
      {
        key,
        provider: "codex",
        offerPrefix: "local-workbench-offer-codex",
        model,
        effort: "low",
        handle,
        displayName: handle,
      },
    ]),
  ),
);
const ROLE_INSTRUCTIONS =
  "只读讨论，用中文给出可核实的依据，区分确认与推测。不修改任何文件。";
export function openingMessage(handles) {
  return [
    handles.map((h) => `@${h}`).join(" ") +
      " 请讨论：Loom 的优势究竟是什么？与 Raft、Multica 等跨 provider 多 Agent 项目，以及 herdr 互传、herdr + 简易 box 相比，增量价值是什么、代价是什么？",
    `材料：${PROJECT}/AGENTS.md、docs/evo/target-contract.zh-CN.md、docs/evo/status.zh-CN.md、docs/evo/herdr-loom-value-2026-09-30.zh-CN.md、docs/evo/token-root-cause-raft-dm-2026-09-30.zh-CN.md、docs/audits/ 下 Raft/Multica 复用台账；${REVIEW} 下负责人用 herdr 中枢驱动 Codex 的任务书和修订稿，可作为实际协作成本的一手材料。`,
    "每次发言只 @ 下一位应回应者；要所有人回答用 @all；达成结论时给出结论且不再 @ 任何人。Human 只发本次开场，之后旁观。只读，不修改任何文件；每次发言不超过300字，用中文。给文件与行号依据，区分确认与推测。",
  ].join("\n");
}

export function parseArgs(argv) {
  const options = { paid: false, dry: false, maxRuns: 12 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--paid") options.paid = true;
    else if (argument === "--dry") options.dry = true;
    else if (argument === "--max-runs") options.maxRuns = Number(argv[++index]);
    else throw new Error(`unknown argument ${argument}`);
  }
  if (options.paid === options.dry)
    throw new Error("exactly one of --paid or --dry is required");
  if (
    !Number.isInteger(options.maxRuns) ||
    options.maxRuns < 3 ||
    options.maxRuns > MAX_RUNS
  )
    throw new Error(`--max-runs must be 3..${MAX_RUNS}`);
  return options;
}

const log = (...parts) =>
  console.log(new Date().toISOString(), ...parts.map(String));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function query(sql, params = {}) {
  const database = new DatabaseSync(ROOM_DB, { readOnly: true });
  try {
    return database.prepare(sql).all(params);
  } finally {
    database.close();
  }
}

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

async function mutate(roomId, send) {
  return await sdk.runRoomMutationAtLatest({
    session: new sdk.RoomSession({
      client,
      consumerId: `e2e-discuss-${randomUUID()}`,
      roomId,
    }),
    mutate: send,
  });
}

function modelIntentFor(bindingId, effort) {
  return {
    exactBindingIds: [bindingId],
    fallback: "disabled",
    ...(effort === null ? {} : { reasoning: effort }),
  };
}

async function setup(stamp) {
  const [me, workspaces] = await Promise.all([
    client.request("principal.me", {}),
    client.request("workspace.list", {}),
  ]);
  const workspace = workspaces.workspaces.find(
    (item) => item.state === "active" && item.controlRoomId,
  );
  if (workspace === undefined) throw new Error("没有活动工作区");
  const controlRoomId = workspace.controlRoomId;
  const inventory = await client.request("host.runtime.list", {});
  // Verify the entire matrix before creating any instance (which can prewarm).
  for (const spec of Object.values(MODELS)) {
    assertApprovedGateModel(spec);
    const offer = inventory.runtimes.find(
      (r) => r.available && r.runtimeOfferId?.startsWith(spec.offerPrefix),
    );
    const binding = offer?.modelBindingDescriptors.find(
      (b) => b.modelBindingId.split(":").at(-1) === spec.model,
    );
    if (!binding?.supportedReasoning?.includes(spec.effort))
      throw Error(`Catalog refuses ${spec.model}/${spec.effort}`);
  }
  log(
    "目录核对",
    JSON.stringify(
      inventory.runtimes
        .filter(
          (r) =>
            r.available &&
            r.runtimeOfferId?.startsWith("local-workbench-offer-codex"),
        )
        .flatMap((r) =>
          r.modelBindingDescriptors.map((b) => ({
            id: b.modelBindingId,
            effort: b.supportedReasoning,
          })),
        ),
    ),
  );

  const name = `e2e-discuss-${stamp.toLowerCase()}`;
  const created = await mutate(controlRoomId, (basedOnControlRoomSeq) =>
    client.request("room.create", {
      additionalDirectories: [PROJECT, REVIEW],
      basedOnControlRoomSeq,
      idempotencyKey: `e2e-discuss-room-${stamp}`,
      kind: "channel",
      name,
      slug: name,
      workspaceId: workspace.workspaceId,
    }),
  );
  const roomId = created.room.roomId;
  log("频道", name, roomId);

  const instances = {};
  for (const spec of Object.values(MODELS)) {
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
      throw new Error(`${spec.provider}: 没有可用 offer`);
    const binding = offer.modelBindingDescriptors.find(
      (item) => item.modelBindingId.split(":").at(-1) === spec.model,
    );
    if (binding === undefined)
      throw new Error(`${spec.provider}: 目录未发布 ${spec.model}`);
    const published = binding.supportedReasoning ?? [];
    if (
      spec.effort === null
        ? published.length > 0
        : !published.includes(spec.effort)
    )
      throw new Error(
        `${spec.provider}: ${spec.model} 发布的推理 [${published.join(",")}] 与批准的 ${String(spec.effort)} 不符`,
      );
    const modelIntent = modelIntentFor(binding.modelBindingId, spec.effort);
    let role;
    {
      const response = await mutate(controlRoomId, (basedOnRoomSeq) =>
        client.request("role.create", {
          basedOnRoomSeq,
          configuration: {
            displayName: spec.displayName,
            handle: `${spec.handle}-${stamp.toLowerCase()}`,
            instructions: ROLE_INSTRUCTIONS,
            modelIntent,
            role: "只读代码审查",
            runtimeOfferId: offer.runtimeOfferId,
          },
          controlRoomId,
          idempotencyKey: `e2e-discuss-role-${spec.key}-${stamp}`,
        }),
      );
      role = response.role;
      log("创建 Role", spec.handle);
    }
    const instance = await mutate(roomId, (basedOnRoomSeq) =>
      client.request("role.instantiate", {
        basedOnRoomSeq,
        channelId: roomId,
        idempotencyKey: `e2e-discuss-inst-${spec.key}-${stamp}`,
        roleId: role.roleId,
      }),
    );
    instances[spec.key] = {
      instanceId: instance.instance.instanceId,
      handle: instance.agent.handle,
      bindingId: binding.modelBindingId,
      effort: spec.effort,
    };
    log("实例", spec.provider, instance.agent.handle);
  }
  return { roomId, instances, humanId: me.principal.principalId };
}

function channelRuns(roomId) {
  return query(
    `SELECT r.run_attempt_id AS runAttemptId, r.participant_id AS participantId,
            r.state, r.started_at AS startedAt, r.finished_at AS finishedAt,
            json_extract(pl.decision_json, '$.resolvedModel') AS resolvedModel
       FROM run_attempts r LEFT JOIN placements pl ON pl.placement_id=r.placement_id
      WHERE r.room_id = :roomId ORDER BY r.started_at`,
    { roomId },
  ).map((run) => ({
    ...run,
    resolvedModel:
      run.resolvedModel === null ? null : JSON.parse(run.resolvedModel),
  }));
}

function channelBusy(roomId) {
  const pending = query(
    `SELECT count(*) AS n FROM activations
      WHERE room_id = :roomId AND state IN ('queued','leased')`,
    { roomId },
  )[0].n;
  const running = query(
    `SELECT count(*) AS n FROM run_attempts
      WHERE room_id = :roomId AND finished_at IS NULL`,
    { roomId },
  )[0].n;
  return pending + running > 0;
}

async function emergencyStop(roomId, reason) {
  log("急停：", reason);
  try {
    await mutate(roomId, (basedOnRoomSeq) =>
      client.request("room.sos.stop", {
        basedOnRoomSeq,
        idempotencyKey: `e2e-discuss-sos-${randomUUID()}`,
        roomId,
      }),
    );
  } catch (error) {
    log("急停请求失败", error.message);
  }
}

function transcript(roomId, labels) {
  return query(
    `SELECT e.room_seq AS seq, e.actor_id AS actorId, e.created_at AS at,
            m.body, m.mentions_json AS mentions, m.thread_id AS threadId,
            json_extract(e.payload_json, '$.recipientIds') AS recipients
       FROM room_events e JOIN messages m ON m.message_id = e.aggregate_id
      WHERE e.room_id = :roomId AND e.type = 'message.posted'
      ORDER BY e.room_seq`,
    { roomId },
  ).map((row) => ({
    seq: row.seq,
    at: row.at,
    author: labels[row.actorId] ?? row.actorId,
    wakes: JSON.parse(row.recipients ?? "[]").map((id) => labels[id] ?? id),
    threadId: row.threadId,
    body: row.body,
  }));
}

function wakeChain(roomId, labels) {
  return query(
    `SELECT room_seq AS seq, author_id AS authorId, participant_id AS participantId,
            streak, chain_limit AS chainLimit, admitted
       FROM instance_wake_chain WHERE room_id = :roomId ORDER BY room_seq, participant_id`,
    { roomId },
  ).map((row) => ({
    seq: row.seq,
    from: labels[row.authorId] ?? row.authorId,
    to: labels[row.participantId] ?? row.participantId,
    streak: row.streak,
    chainLimit: row.chainLimit,
    admitted: row.admitted === 1,
  }));
}

function inspectRun(run, instances) {
  const instance = Object.values(instances).find(
    (i) => i.instanceId === run.participantId,
  );
  const bindings = globSync(
    join(HOME, ".loom/evo/state/supervisors/provider-sessions/*.json"),
  ).map((p) => JSON.parse(readFileSync(p, "utf8")));
  const sessionId = bindings.find(
    (b) => b.participantId === run.participantId,
  )?.providerSessionId;
  const usage = query(
    "SELECT * FROM run_attempt_usage WHERE run_attempt_id=:id ORDER BY observed_at",
    { id: run.runAttemptId },
  );
  const totals = {
    generations: usage.length,
    input: usage.reduce((s, r) => s + r.input_tokens, 0),
    cached: usage.reduce((s, r) => s + r.cached_input_tokens, 0),
  };
  totals.uncached = totals.input - totals.cached;
  let native = null,
    nativeError = null;
  try {
    native = measure(sessionId, run, undefined, {
      provider: "codex",
      model: instance.bindingId.split(":").at(-1),
      effort: instance.effort,
    });
  } catch (error) {
    nativeError = error.message;
  }
  return {
    ...run,
    sessionId,
    seconds: run.finishedAt
      ? (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000
      : null,
    totals: usage.length ? totals : null,
    native,
    nativeError,
    nativeMatches:
      native !== null &&
      native.input === totals.input &&
      native.cached === totals.cached &&
      native.generations === totals.generations,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const handles = Object.values(MODELS).map((spec) => spec.handle);
  if (options.dry) {
    console.log("三实例无人值守讨论验收（计划，--dry 不访问网络、不调用模型）");
    for (const spec of Object.values(MODELS)) {
      assertApprovedGateModel({
        provider: spec.provider,
        model: spec.model,
        effort: spec.effort,
      });
      console.log(`- ${spec.provider}: ${spec.model} / ${String(spec.effort)}`);
    }
    console.log(
      `上限：RunAttempt ≤ ${options.maxRuns}；静默 ${QUIET_MS / 1000} s 结束；总时长 ${TIMEOUT_MS / 60_000} min`,
    );
    console.log(`开场（实例 handle 以实际为准）：\n${openingMessage(handles)}`);
    return;
  }
  if (!existsSync(PROJECT)) throw new Error(`缺少验收项目 ${PROJECT}`);
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d+Z$/u, "Z");
  client = await makeClient();
  if (existsSync(EVIDENCE))
    throw Error("P96 evidence exists; refuse another paid batch");
  const { roomId, instances, humanId } = await setup(stamp);
  writeFileSync(
    EVIDENCE,
    JSON.stringify(
      { stamp, roomId, instances, status: "setup; no opening yet" },
      null,
      2,
    ),
  );
  const labels = Object.fromEntries(
    Object.entries(instances).map(([provider, item]) => [
      item.instanceId,
      provider,
    ]),
  );
  labels[humanId] = "Human";
  const expectedByParticipant = Object.fromEntries(
    Object.values(instances).map((item) => [
      item.instanceId,
      { bindingId: item.bindingId, effort: item.effort },
    ]),
  );
  const startedAt = new Date().toISOString();
  const opening = openingMessage(
    ["solA", "solB", "astra"].map((key) => instances[key].handle),
  );
  await mutate(roomId, (basedOnRoomSeq) =>
    client.request("message.post", {
      basedOnRoomSeq,
      body: opening,
      idempotencyKey: `e2e-discuss-open-${stamp}`,
      roomId,
    }),
  );
  log("Human 开场已发出");
  const deadline = Date.now() + TIMEOUT_MS;
  let quietSince;
  let stopReason = "quiet";
  for (;;) {
    await sleep(POLL_MS);
    const runs = channelRuns(roomId);
    const model = judgePlacementModel({ runs, expectedByParticipant });
    if (model.verdict !== "pass") {
      stopReason = `模型不符：${model.problems.join("；")}`;
      await emergencyStop(roomId, stopReason);
      break;
    }
    if (runs.length >= options.maxRuns) {
      stopReason = `RunAttempt ${runs.length} 达到上限 ${options.maxRuns}`;
      await emergencyStop(roomId, stopReason);
      break;
    }
    if (channelBusy(roomId)) quietSince = undefined;
    else {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= QUIET_MS) break;
    }
    if (Date.now() > deadline) {
      stopReason = "timeout";
      await emergencyStop(roomId, stopReason);
      break;
    }
  }
  if (stopReason !== "quiet") {
    const settleDeadline = Date.now() + 60_000;
    while (
      channelRuns(roomId).some((r) => r.finishedAt === null) &&
      Date.now() < settleDeadline
    )
      await sleep(1000);
  }
  const runs = channelRuns(roomId);
  const messages = transcript(roomId, labels);
  const chain = wakeChain(roomId, labels);
  const instanceMessages = messages.filter((item) => item.author in instances);
  const last = instanceMessages.at(-1);
  const evidence = {
    batch: "P96",
    maxRuns: options.maxRuns,
    instances,
    stamp,
    roomId,
    startedAt,
    finishedAt: new Date().toISOString(),
    stopReason,
    models: Object.fromEntries(
      Object.entries(instances).map(([provider, item]) => [
        provider,
        { bindingId: item.bindingId, effort: item.effort },
      ]),
    ),
    runs: runs.map((run) => inspectRun(run, instances)),
    activations: query("SELECT * FROM activations WHERE room_id=:roomId", {
      roomId,
    }),
    selfInbox: query(
      "SELECT count(*) n FROM inbox_items i JOIN room_events e ON e.event_id=i.event_id WHERE e.room_id=:roomId AND e.actor_id=i.participant_id",
      { roomId },
    )[0].n,
    heldDrafts: query(
      "SELECT * FROM held_message_drafts WHERE room_id=:roomId",
      { roomId },
    ),
    usageGaps: query(
      "SELECT g.* FROM run_attempt_usage_gaps g JOIN run_attempts r USING(run_attempt_id) WHERE r.room_id=:roomId",
      { roomId },
    ),
    runsPerInstance: Object.fromEntries(
      Object.keys(instances).map((provider) => [
        provider,
        runs.filter((run) => labels[run.participantId] === provider).length,
      ]),
    ),
    instanceMessages: instanceMessages.length,
    handoffs: instanceMessages.filter((item) => item.wakes.length > 0).length,
    silentReplies: instanceMessages.filter((item) => item.wakes.length === 0)
      .length,
    chainLimitTrips: chain.filter((row) => !row.admitted).length,
    endedWithoutHandoff: last !== undefined && last.wakes.length === 0,
    wakeChain: chain,
    transcript: messages,
  };
  const dir = RUNS_DIR;
  mkdirSync(dir, { recursive: true });
  writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
  const lines = [
    `# 三实例无人值守讨论验收（${stamp}）`,
    "",
    `- 频道：${roomId}；结束原因：${stopReason}；RunAttempt ${runs.length}（上限 ${options.maxRuns}）`,
    `- 每实例运行：${JSON.stringify(evidence.runsPerInstance)}`,
    `- 实例发言 ${evidence.instanceMessages} 条：带交接 @ ${evidence.handoffs}，无 @ ${evidence.silentReplies}；链上限拦截 ${evidence.chainLimitTrips} 次；最后一条实例发言${evidence.endedWithoutHandoff ? "未再 @ 任何人（仅为停止交接，不证明共识）" : "仍有交接或无实例发言"}`,
    "- 判定只依据 room.db；讨论质量待人工核对。",
    "",
    "## 发言",
    "",
    ...messages.map(
      (item) =>
        `- #${item.seq} ${item.author} → 唤醒 [${item.wakes.join(", ")}]：${String(item.body).replace(/\s+/gu, " ")}`,
    ),
  ];
  writeFileSync(EVIDENCE.replace(".json", ".md"), `${lines.join("\n")}\n`);
  log("证据：", EVIDENCE);
  log("报告：", EVIDENCE.replace(".json", ".md"));
  log(
    `结束：${stopReason}；RunAttempt ${runs.length}；实例发言 ${evidence.instanceMessages}；交接 ${evidence.handoffs}；链上限拦截 ${evidence.chainLimitTrips}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack ?? String(error));
    process.exitCode = 1;
  });
}
