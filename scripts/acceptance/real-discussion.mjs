#!/usr/bin/env node
/**
 * Opt-in PAID acceptance: can three Role instances hold an unattended Channel
 * discussion under contract §3 (a Human opens once; instances hand off by
 * mentioning the next speaker, `@all` asks everyone; wakes bounded by the
 * Channel chain limit)? Owner-authorized per run batch only.
 *
 * - Creates a fresh Channel attached to ~/.loom/acceptance/e2e-project and
 *   three instances: the e2e Codex and Claude Roles (reused) and an e2e
 *   OpenCode Role (created once), each on an approved gate model with an
 *   exact binding and fallback disabled.
 * - Posts one Human opening, then only observes. Stops when the Channel has
 *   been quiet for QUIET_MS, at the run cap (emergency stop), or at the
 *   timeout. Verdicts come from room.db (read-only) only; answer quality is
 *   left for manual review.
 *
 * `--dry` prints the plan and touches nothing; `--paid` is required to run.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";

import { assertApprovedGateModel } from "../cli-efficiency/approved-models.mjs";
import { E2E_MODELS, judgePlacementModel } from "./real-e2e-lib.mjs";

const ORIGIN = "http://127.0.0.1:4176";
const HOME = homedir();
const PROJECT = join(HOME, ".loom", "acceptance", "e2e-project");
const RUNS_DIR = join(HOME, ".loom", "acceptance", "runs");
const ROOM_DB = join(HOME, ".loom", "evo", "state", "room.db");
const POLL_MS = 2_000;
const QUIET_MS = 60_000;
const TIMEOUT_MS = 20 * 60_000;
const MAX_RUNS = 15;

const MODELS = Object.freeze({
  ...E2E_MODELS,
  opencode: Object.freeze({
    provider: "opencode",
    offerPrefix: "local-workbench-offer-opencode",
    model: "deepseek/deepseek-flash",
    effort: "low",
    handle: "e2e-opencode",
    displayName: "E2E OpenCode 审查员",
  }),
});

const ROLE_INSTRUCTIONS =
  "你是 Loom 验收频道里的代码审查实例。只读审查本频道附加目录中的项目：不修改、不创建、不删除任何文件，不运行会改动文件或安装依赖的命令。回复用中文，简洁，结论附文件与行号依据。";

export function openingMessage(handles) {
  const [codex, claude, opencode] = handles;
  return [
    `@${codex} @${claude} @${opencode} 请三位讨论一个问题：scripts/workbench-launch-receipt.mjs 的 PID 校验只比较数字相等，是否应当改为同时验证进程身份（例如启动时间）？代价和收益各是什么？`,
    "讨论方式：每次发言只 @ 你希望接着回应的那一位；需要所有人都回答时用 @all；你认为已经达成一致时，给出一句结论，并且不再 @ 任何人。每次发言不超过 150 字，只读，不修改文件。",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { paid: false, dry: false, maxRuns: MAX_RUNS };
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
  const name = `e2e-discuss-${stamp.toLowerCase()}`;
  const created = await mutate(controlRoomId, (basedOnControlRoomSeq) =>
    client.request("room.create", {
      additionalDirectories: [PROJECT],
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
  const inventory = await client.request("host.runtime.list", {});
  const roles = await client.request("role.list", { controlRoomId });
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
    let role = roles.roles.find(
      (item) => item.configuration.handle === spec.handle,
    );
    if (role !== undefined) {
      // A CLI self-update supersedes the offer revision; the profile and the
      // exact model intent must still match.
      const profile = (id) => String(id).split(":")[0];
      if (
        profile(role.configuration.runtimeOfferId) !==
          profile(offer.runtimeOfferId) ||
        !isDeepStrictEqual(role.configuration.modelIntent, modelIntent)
      )
        throw new Error(`已有 Role ${spec.handle} 与批准配置不符，拒绝复用`);
    } else {
      const response = await mutate(controlRoomId, (basedOnRoomSeq) =>
        client.request("role.create", {
          basedOnRoomSeq,
          configuration: {
            displayName: spec.displayName,
            handle: spec.handle,
            instructions: ROLE_INSTRUCTIONS,
            modelIntent,
            role: "只读代码审查",
            runtimeOfferId: offer.runtimeOfferId,
          },
          controlRoomId,
          idempotencyKey: `e2e-discuss-role-${spec.provider}-${stamp}`,
        }),
      );
      role = response.role;
      log("创建 Role", spec.handle);
    }
    const instance = await mutate(roomId, (basedOnRoomSeq) =>
      client.request("role.instantiate", {
        basedOnRoomSeq,
        channelId: roomId,
        idempotencyKey: `e2e-discuss-inst-${spec.provider}-${stamp}`,
        roleId: role.roleId,
      }),
    );
    instances[spec.provider] = {
      instanceId: instance.instance.instanceId,
      handle: instance.agent.handle,
      bindingId: binding.modelBindingId,
      effort: spec.effort,
    };
    log("实例", spec.provider, instance.agent.handle);
  }
  return { roomId, instances };
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
    author: labels[row.actorId] ?? "system",
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
  const { roomId, instances } = await setup(stamp);
  const labels = Object.fromEntries(
    Object.entries(instances).map(([provider, item]) => [
      item.instanceId,
      provider,
    ]),
  );
  const expectedByParticipant = Object.fromEntries(
    Object.values(instances).map((item) => [
      item.instanceId,
      { bindingId: item.bindingId, effort: item.effort },
    ]),
  );
  const startedAt = new Date().toISOString();
  const opening = openingMessage(
    ["codex", "claude", "opencode"].map((key) => instances[key].handle),
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
    if (runs.length > options.maxRuns) {
      stopReason = `RunAttempt ${runs.length} 超过上限 ${options.maxRuns}`;
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
  const runs = channelRuns(roomId);
  const messages = transcript(roomId, labels);
  const chain = wakeChain(roomId, labels);
  const instanceMessages = messages.filter((item) => item.author in instances);
  const last = instanceMessages.at(-1);
  const evidence = {
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
    runs: runs.map((run) => ({
      instance: labels[run.participantId] ?? run.participantId,
      runAttemptId: run.runAttemptId,
      state: run.state,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    })),
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
  const dir = join(RUNS_DIR, `discuss-${stamp}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  const lines = [
    `# 三实例无人值守讨论验收（${stamp}）`,
    "",
    `- 频道：${roomId}；结束原因：${stopReason}；RunAttempt ${runs.length}（上限 ${options.maxRuns}）`,
    `- 每实例运行：${JSON.stringify(evidence.runsPerInstance)}`,
    `- 实例发言 ${evidence.instanceMessages} 条：带交接 @ ${evidence.handoffs}，无 @ ${evidence.silentReplies}；链上限拦截 ${evidence.chainLimitTrips} 次；最后一条实例发言${evidence.endedWithoutHandoff ? "未再 @ 任何人（收敛）" : "仍有交接或无实例发言"}`,
    "- 判定只依据 room.db；讨论质量待人工核对。",
    "",
    "## 发言",
    "",
    ...messages.map(
      (item) =>
        `- #${item.seq} ${item.author} → 唤醒 [${item.wakes.join(", ")}]：${String(item.body).replace(/\s+/gu, " ")}`,
    ),
  ];
  writeFileSync(join(dir, "report.md"), `${lines.join("\n")}\n`);
  log("证据：", join(dir, "evidence.json"));
  log("报告：", join(dir, "report.md"));
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
