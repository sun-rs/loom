import assert from "node:assert/strict";
import test from "node:test";

import { FakeRahClient, type RahClientOperation } from "@rah-os/client-sdk";
import { RUN_ATTEMPT_CLI_COST_READ_LIMIT } from "@rah-os/protocol";
import type {
  AgentActivityRecord,
  Message,
  Room,
  RoomAgentActivity,
  UsageSummaryResponse,
} from "@rah-os/protocol";

import {
  MESSAGE_WINDOW,
  SESSION_RESET_CONSEQUENCE,
  SYSTEM_PRINCIPAL_ID,
  UNKNOWN,
  assembleInstanceStatuses,
  formatCount,
  formatUsd,
  loadIdentity,
  loadInstanceStatuses,
  loadLatestMessages,
  loadNewerMessages,
  loadUsage,
  recentProblems,
  runAttemptsInRoom,
  runUsageDetail,
  settingsRows,
  stateLabel,
  summarizeChannels,
  usageRow,
  wakeLimitNotice,
  watchdogWarningActive,
} from "../src/model.ts";
import { parseRoute } from "../src/route.ts";

// FIXTURE ONLY: every identifier and reply below is fake test data.
const NOW = "2026-09-26T12:00:00.000Z";
const HUMAN = "principal-human-fixture";
const DIGEST = `sha256:${"0".repeat(64)}`;

function room(overrides: Partial<Room> & { roomId: string }): Room {
  return {
    createdAt: NOW,
    kind: "channel",
    name: overrides.roomId,
    slug: overrides.roomId,
    workspaceId: "workspace-fixture",
    ...overrides,
  };
}

function message(
  roomSeq: number,
  actorId: string,
  body: string,
  roomId = "room-a",
): Message {
  return {
    actorId,
    body,
    createdAt: NOW,
    messageId: `message-${String(roomSeq)}`,
    roomId,
    roomSeq,
  };
}

function activity(
  activityId: string,
  eventType: string,
  tone: AgentActivityRecord["tone"],
  createdAt = NOW,
): AgentActivityRecord {
  return {
    activityId,
    aggregateId: "aggregate-fixture",
    aggregateType: "run_attempt",
    createdAt,
    eventType,
    participantId: "instance-1",
    relation: "runtime",
    roomId: "room-a",
    roomKind: "channel",
    roomName: "a",
    roomSeq: 1,
    roomSlug: "a",
    source: "room_event",
    tone,
  };
}

const roleConfiguration = {
  displayName: "Fixture Reviewer",
  handle: "reviewer",
  instructions: "FIXTURE ONLY",
  modelIntent: { fallback: "disabled" as const },
  role: "reviewer",
  runtimeOfferId: "offer-fixture",
};

test("channel list keeps only unarchived channels with their directories and marks legacy channels", () => {
  const summaries = summarizeChannels([
    room({
      channelWorkspace: {
        additionalDirectories: ["/Users/fixture/attached"],
        kind: "channel_home",
        primary: { state: "ready" },
        primaryDirectory: "/Users/fixture/.loom/channel-workspaces/room-a",
      },
      name: "alpha",
      roomId: "room-a",
    }),
    room({
      channelWorkspace: {
        additionalDirectories: [],
        kind: "channel_home",
        primary: { reason: "disk full", state: "failed" },
        primaryDirectory: "/Users/fixture/.loom/channel-workspaces/room-b",
      },
      roomId: "room-b",
    }),
    room({ roomId: "room-legacy" }),
    room({ archivedAt: NOW, roomId: "room-archived" }),
    room({ kind: "control", roomId: "room-control" }),
    room({
      instancePrivateBox: { active: true, instanceId: "instance-1" },
      kind: "direct",
      roomId: "room-private",
    }),
    room({
      channelWorkspace: { additionalDirectories: [], kind: "channel_home" },
      roomId: "room-unrecorded",
    }),
  ]);
  assert.deepEqual(
    summaries.map((summary) => summary.roomId),
    ["room-a", "room-b", "room-legacy", "room-unrecorded"],
  );
  assert.deepEqual(summaries[0], {
    attachedDirectories: ["/Users/fixture/attached"],
    legacyPrivateCwd: false,
    name: "alpha",
    primaryDirectory: "/Users/fixture/.loom/channel-workspaces/room-a",
    primaryLabel: "ready",
    roomId: "room-a",
  });
  assert.equal(summaries[1]?.primaryLabel, "failed：disk full");
  assert.equal(summaries[2]?.legacyPrivateCwd, true);
  assert.equal(summaries[2]?.primaryDirectory, null);
  assert.equal(summaries[2]?.primaryLabel, "实例使用私有 cwd");
  assert.equal(summaries[3]?.legacyPrivateCwd, false);
  assert.equal(summaries[3]?.primaryDirectory, null);
  assert.equal(summaries[3]?.primaryLabel, UNKNOWN);
});

test("identity comes from the authenticated principal and the active workspace", async () => {
  const calls: RahClientOperation[] = [];
  const client = new FakeRahClient(async (operation) => {
    calls.push(operation);
    if (operation === "principal.me") {
      return {
        principal: {
          displayName: "Fixture Human",
          handle: "fixture-human",
          kind: "human",
          principalId: HUMAN,
        },
      };
    }
    if (operation === "workspace.list") {
      return {
        workspaces: [
          {
            archivedAt: NOW,
            createdAt: NOW,
            name: "old",
            slug: "old",
            state: "archived",
            workspaceId: "workspace-old",
          },
          {
            controlRoomId: "room-control",
            createdAt: NOW,
            name: "Fixture Workspace",
            slug: "fixture",
            state: "active",
            workspaceId: "workspace-fixture",
          },
        ],
      };
    }
    throw new Error(`unexpected ${operation}`);
  });
  assert.deepEqual(await loadIdentity(client), {
    controlRoomId: "room-control",
    displayName: "Fixture Human",
    principalId: HUMAN,
    workspaceId: "workspace-fixture",
    workspaceName: "Fixture Workspace",
  });
  assert.deepEqual(calls.sort(), ["principal.me", "workspace.list"]);
});

test("messages load the latest window, then poll after the cursor and keep only the newest window", async () => {
  const requests: unknown[] = [];
  let stored = Array.from({ length: 60 }, (_, index) =>
    message(index + 1, HUMAN, `fixture ${String(index + 1)}`),
  );
  const client = new FakeRahClient(async (operation, input) => {
    assert.equal(operation, "message.list");
    requests.push(input);
    const request = input as { afterSeq?: number; limit: number };
    const page =
      request.afterSeq === undefined
        ? stored.slice(-request.limit)
        : stored
            .filter(({ roomSeq }) => roomSeq > request.afterSeq!)
            .slice(0, request.limit);
    return {
      cursorAfter: page.at(-1)?.roomSeq ?? request.afterSeq ?? 0,
      cursorBefore: page.at(0)?.roomSeq ?? request.afterSeq ?? 0,
      hasMoreAfter:
        page.length > 0 && page.at(-1)!.roomSeq < stored.at(-1)!.roomSeq,
      hasMoreBefore: page.length > 0 && page[0]!.roomSeq > 1,
      messages: page,
    };
  });
  const first = await loadLatestMessages(client, "room-a");
  assert.equal(first.messages.length, MESSAGE_WINDOW);
  assert.equal(first.messages[0]?.roomSeq, 11);
  assert.equal(first.cursorAfter, 60);
  assert.deepEqual(requests[0], { limit: MESSAGE_WINDOW, roomId: "room-a" });

  stored = [
    ...stored,
    message(61, SYSTEM_PRINCIPAL_ID, "fixture system notice"),
    message(62, "instance-1", "fixture instance reply"),
  ];
  const next = await loadNewerMessages(client, "room-a", first);
  assert.deepEqual(requests[1], {
    afterSeq: 60,
    limit: MESSAGE_WINDOW,
    roomId: "room-a",
  });
  assert.equal(next.cursorAfter, 62);
  assert.equal(next.messages.length, MESSAGE_WINDOW);
  assert.equal(next.messages[0]?.roomSeq, 13);
  assert.equal(next.messages.at(-1)?.roomSeq, 62);
  assert.equal(next.messages.at(-2)?.system, true);
  assert.equal(next.messages.at(-1)?.system, false);

  const unchanged = await loadNewerMessages(client, "room-a", next);
  assert.equal(unchanged, next, "an empty poll keeps the same window");
});

test("the wake-limit notice stays visible until the Human speaks again", () => {
  const notice =
    "【Loom 系统】自上一条 Human 消息以来，本频道实例之间已连续唤醒 10 次（上限 10）。";
  const beforeHuman = [
    message(1, HUMAN, "fixture start"),
    message(2, "instance-1", "fixture ping"),
    message(3, SYSTEM_PRINCIPAL_ID, notice),
    message(4, "instance-2", "fixture pong"),
  ];
  assert.equal(wakeLimitNotice(beforeHuman, HUMAN), notice);
  assert.equal(
    wakeLimitNotice(
      [...beforeHuman, message(5, HUMAN, "fixture resume")],
      HUMAN,
    ),
    null,
  );
  assert.equal(
    wakeLimitNotice(
      [message(1, SYSTEM_PRINCIPAL_ID, "【Loom 系统】其它通知")],
      HUMAN,
    ),
    null,
    "other system notices are not the wake-limit notice",
  );
});

test("instance status joins role.list, room activity, private boxes and recent failures", () => {
  const roomActivities: RoomAgentActivity[] = [
    {
      participantId: "instance-1",
      queued: true,
      roomId: "room-a",
      state: "waking",
      updatedAt: NOW,
    },
    {
      lastError: "fixture provider exited 1",
      participantId: "instance-2",
      queued: false,
      roomId: "room-a",
      state: "error",
      updatedAt: NOW,
    },
  ];
  const statuses = assembleInstanceStatuses({
    agentHandles: new Map([
      ["agent-1", "reviewer-fixture1"],
      ["agent-2", "reviewer-fixture2"],
    ]),
    privateActivities: new Map([
      [
        "instance-1",
        [
          {
            participantId: "instance-1",
            queued: true,
            roomId: "room-private-1",
            state: "waking",
            updatedAt: NOW,
          },
        ],
      ],
    ]),
    agentActivities: new Map([
      [
        "agent-1",
        [
          activity("act-5", "run.watchdog_warning", "warning"),
          activity("act-4", "run.started", "active"),
          activity("act-3", "activation.retry_blocked", "error"),
          activity("act-2", "task.blocked", "warning"),
          activity("act-1", "run.orphaned", "error"),
        ],
      ],
      [
        "agent-2",
        [
          activity("act-9", "run.finished", "error"),
          activity("act-8", "run.watchdog_warning", "warning"),
        ],
      ],
    ]),
    roleList: {
      instances: [
        {
          agentId: "agent-1",
          channelId: "room-a",
          instanceId: "instance-1",
          isCurrent: true,
          roleId: "role-1",
          roleRevisionId: "revision-1",
          sessionCompactionCount: null,
        },
        {
          agentId: "agent-2",
          channelId: "room-a",
          instanceId: "instance-2",
          isCurrent: false,
          roleId: "role-1",
          roleRevisionId: "revision-0",
          sessionCompactionCount: null,
        },
        {
          agentId: "agent-4",
          channelId: "room-a",
          instanceId: "instance-removed",
          isCurrent: true,
          roleId: "role-1",
          roleRevisionId: "revision-1",
          sessionCompactionCount: null,
        },
        {
          agentId: "agent-3",
          channelId: "room-other",
          instanceId: "instance-3",
          isCurrent: true,
          roleId: "role-1",
          roleRevisionId: "revision-1",
          sessionCompactionCount: null,
        },
      ],
      roles: [
        {
          configuration: roleConfiguration,
          controlRoomId: "room-control",
          createdAt: NOW,
          roleId: "role-1",
          roleRevisionId: "revision-1",
        },
      ],
    },
    roomActivities,
    roomId: "room-a",
    rooms: [
      room({
        instancePrivateBox: { active: true, instanceId: "instance-1" },
        kind: "direct",
        roomId: "room-private-1",
      }),
    ],
  });
  assert.deepEqual(
    statuses.map((status) => status.instanceId),
    ["instance-1", "instance-2", "instance-removed"],
  );
  const [first, second, removed] = statuses;
  assert.equal(first?.handle, "reviewer-fixture1", "the instance's own handle");
  assert.equal(first?.member, true);
  assert.equal(first?.queuedCount, 2, "channel plus private box");
  assert.equal(first?.queuedLabel, "排队 2（频道 1，私聊 1）");
  assert.equal(second?.queuedCount, 0);
  assert.equal(second?.queuedLabel, "排队 0");
  assert.equal(removed?.member, false, "absent from the Room activity list");
  assert.equal(removed?.stateLabel, "已移出频道");
  assert.equal(removed?.queuedLabel, "—");
  assert.equal(first?.roleName, "Fixture Reviewer");
  assert.equal(first?.isCurrent, true);
  assert.equal(first?.stateLabel, "排队或启动中");
  assert.equal(first?.privateBoxLabel, "私聊可用");
  assert.equal(first?.watchdogWarning, "无进展已达告警阈值");
  assert.deepEqual(
    first?.recentProblems.map(({ eventType }) => eventType),
    ["run.watchdog_warning", "activation.retry_blocked", "task.blocked"],
  );
  assert.equal(second?.isCurrent, false);
  assert.equal(second?.stateLabel, "错误");
  assert.equal(second?.lastError, "fixture provider exited 1");
  assert.equal(second?.privateBoxLabel, "私聊未打开");
  assert.equal(first?.privateBoxRoomId, "room-private-1");
  assert.equal(second?.privateBoxRoomId, null);
  assert.deepEqual(
    first?.runs.map(({ runAttemptId }) => runAttemptId),
    ["aggregate-fixture"],
    "the card lists this Channel's RunAttempts",
  );
  assert.equal(
    second?.watchdogWarning,
    null,
    "a finished run clears an earlier watchdog warning",
  );
});

test("state labels never overstate what the ledger proves", () => {
  assert.equal(stateLabel("idle"), "空闲");
  assert.equal(stateLabel("waking"), "排队或启动中");
  assert.equal(stateLabel("working"), "运行中");
  assert.equal(stateLabel("error"), "错误");
  assert.equal(stateLabel(undefined), "无运行记录");
  assert.equal(watchdogWarningActive([]), null);
  assert.deepEqual(
    recentProblems([activity("x", "run.started", "active")]),
    [],
  );
});

test("instance status loads through role.list, room.agent.activity.list and agent.activity.list", async () => {
  const calls: Array<[RahClientOperation, unknown]> = [];
  const client = new FakeRahClient(async (operation, input) => {
    calls.push([operation, input]);
    if (operation === "role.list") {
      return {
        instances: [
          {
            agentId: "agent-1",
            channelId: "room-a",
            instanceId: "instance-1",
            isCurrent: true,
            roleId: "role-1",
            roleRevisionId: "revision-1",
            sessionCompactionCount: null,
          },
        ],
        roles: [
          {
            configuration: roleConfiguration,
            controlRoomId: "room-control",
            createdAt: NOW,
            roleId: "role-1",
            roleRevisionId: "revision-1",
          },
        ],
      };
    }
    if (operation === "room.agent.activity.list") {
      return {
        agents: [
          {
            participantId: "instance-1",
            roomId: "room-a",
            state: "working",
            updatedAt: NOW,
          },
        ],
      };
    }
    if (operation === "agent.activity.list") return { activities: [] };
    if (operation === "agent.list") {
      return {
        agents: [
          {
            currentRevision: {
              agentDefinitionRevisionId: "agent-revision-1",
              agentId: "agent-1",
              contentDigest: DIGEST,
              createdAt: NOW,
              createdBy: HUMAN,
              executionPolicyRevisionId: "policy-1",
              instructionRefs: [],
              instructions: "FIXTURE ONLY",
              memoryPolicyRef: {
                artifactId: "memory-policy",
                contentDigest: DIGEST,
                versionId: "memory-policy-v1",
              },
              revision: 1,
              role: "reviewer",
              skillRefs: [],
            },
            definition: {
              agentId: "agent-1",
              controlRoomId: "room-control",
              createdAt: NOW,
              currentRevisionId: "agent-revision-1",
              participantId: "instance-1",
              state: "enabled",
              updatedAt: NOW,
            },
            handle: "reviewer-fixture1",
          },
        ],
      };
    }
    throw new Error(`unexpected ${operation}`);
  });
  const statuses = await loadInstanceStatuses(client, {
    controlRoomId: "room-control",
    roomId: "room-a",
    rooms: [
      room({
        instancePrivateBox: { active: true, instanceId: "instance-1" },
        kind: "direct",
        roomId: "room-private-1",
      }),
    ],
  });
  assert.equal(statuses[0]?.stateLabel, "运行中");
  assert.equal(statuses[0]?.handle, "reviewer-fixture1");
  assert.deepEqual(calls, [
    ["role.list", { controlRoomId: "room-control" }],
    ["room.agent.activity.list", { roomId: "room-a" }],
    ["agent.list", { controlRoomId: "room-control" }],
    ["agent.activity.list", { agentId: "agent-1", limit: 20 }],
    ["room.agent.activity.list", { roomId: "room-private-1" }],
  ]);
});

function usageFigure(
  overrides: Partial<UsageSummaryResponse["totals"]> = {},
): UsageSummaryResponse["totals"] {
  return {
    cliEstimatedCost: {
      basis: "cli_reported_estimate",
      runsAllRecordsKnown: 0,
      runsComplete: 0,
      runsPartial: 0,
      runsUnknown: 0,
      runsUnreported: 0,
      sources: [],
      totalUsd: null,
    },
    firstRunStartedAt: null,
    gaps: [],
    lastRunStartedAt: null,
    providers: [],
    runs: { complete: 0, partial: 0, total: 0, unavailable: 0 },
    tokens: {
      cachedInputTokens: 0,
      generations: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: null,
      reasoningReportedGenerations: 0,
    },
    ...overrides,
  };
}

test("usage formatting shows unknown instead of zero and never fills gaps", () => {
  assert.equal(formatCount(null), UNKNOWN);
  assert.equal(formatCount(undefined), UNKNOWN);
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(12_345), "12,345");
  assert.equal(formatUsd(null), UNKNOWN);
  assert.equal(formatUsd(0.1234), "$0.1234");

  const unavailable = usageRow(
    "instance-1",
    usageFigure({
      runs: { complete: 0, partial: 0, total: 2, unavailable: 2 },
    }),
  );
  assert.equal(unavailable.runs, "2（无用量 2）");
  assert.equal(unavailable.inputTokens, UNKNOWN, "no recorded run is not zero");
  assert.equal(unavailable.outputTokens, UNKNOWN);
  assert.equal(unavailable.reasoningTokens, UNKNOWN);
  assert.equal(unavailable.cost, UNKNOWN);

  const partial = usageRow(
    "instance-2",
    usageFigure({
      cliEstimatedCost: {
        ...usageFigure().cliEstimatedCost,
        runsPartial: 1,
        totalUsd: 0.5,
      },
      runs: { complete: 1, partial: 1, total: 3, unavailable: 1 },
      tokens: {
        cachedInputTokens: 100,
        generations: 2,
        inputTokens: 1_000,
        outputTokens: 50,
        reasoningOutputTokens: null,
        reasoningReportedGenerations: 0,
      },
    }),
  );
  assert.equal(partial.runs, "3（无用量 1）");
  assert.equal(partial.inputTokens, "1,000（部分）");
  assert.equal(partial.cachedInputTokens, "100（部分）");
  assert.equal(partial.reasoningTokens, UNKNOWN);
  assert.equal(partial.cost, "$0.5000（部分，CLI 自报）");

  const none = usageRow("empty", usageFigure());
  assert.equal(none.runs, "0");
  assert.equal(none.inputTokens, "—");
});

test("usage summary requests the chosen window for the channel by instance", async () => {
  const inputs: unknown[] = [];
  const client = new FakeRahClient(async (operation, input) => {
    assert.equal(operation, "usage.summary");
    inputs.push(input);
    return {
      from: (input as { from: string }).from,
      groupBy: "instance",
      groups: [],
      to: (input as { to: string }).to,
      totals: usageFigure(),
      truncated: false,
    };
  });
  const now = new Date(NOW);
  const day = await loadUsage(client, {
    channelId: "room-a",
    now,
    window: "24h",
  });
  assert.equal(day.rows.length, 0);
  assert.equal(day.totals.label, "合计");
  await loadUsage(client, { now, window: "7d" });
  assert.deepEqual(inputs, [
    {
      channelId: "room-a",
      from: "2026-09-25T12:00:00.000Z",
      groupBy: "instance",
      to: NOW,
    },
    {
      from: "2026-09-19T12:00:00.000Z",
      groupBy: "instance",
      to: NOW,
    },
  ]);
});

test("runtime settings are shown read-only with every group", () => {
  const rows = settingsRows({
    maxConcurrentRuns: 20,
    maxConcurrentStarts: 5,
    minStartIntervalMs: 500,
    revision: 3,
    runtimes: [
      {
        maxConcurrentRuns: 4,
        offerMaxConcurrent: 8,
        runtimeOfferId: "offer-fixture",
        runtimeProfileId: "profile-codex",
      },
    ],
    wakeGuard: { instanceChainLimit: 10 },
    watchdog: {
      maxRunMs: 4 * 60 * 60_000,
      noProgressWarnMs: 15 * 60_000,
      queuedStallTerminateMs: 15 * 60_000,
    },
    prewarm: { enabled: true, recentActiveHours: 24 },
  });
  assert.deepEqual(rows, [
    { label: "修订号", value: "3" },
    { label: "本机同时运行上限", value: "20" },
    { label: "同时启动上限", value: "5" },
    { label: "启动最小间隔", value: "500 ms" },
    { label: "CLI profile-codex 同时运行上限", value: "4（供给上限 8）" },
    { label: "实例互相唤醒上限", value: "10" },
    { label: "无进展告警阈值", value: "15 分钟" },
    { label: "排队时无进展终止阈值", value: "15 分钟" },
    { label: "单次运行时长上限", value: "240 分钟" },
    { label: "实例创建即预热常驻运行时", value: "开" },
    { label: "启动后预热最近活跃实例", value: "最近 24 小时" },
  ]);
});

test("hash routes decode ids and an invalid percent-encoding is an invalid route, not a crash", () => {
  assert.deepEqual(parseRoute(""), { kind: "channels" });
  assert.deepEqual(parseRoute("#/"), { kind: "channels" });
  assert.deepEqual(parseRoute("#/channels"), { kind: "channels" });
  assert.deepEqual(parseRoute("#/channel/room%2Fa"), {
    kind: "channel",
    roomId: "room/a",
  });
  assert.deepEqual(parseRoute("#/direct/room-dm"), {
    kind: "direct",
    roomId: "room-dm",
  });
  assert.deepEqual(parseRoute("#/roles"), { kind: "roles" });
  assert.deepEqual(parseRoute("#/usage"), { kind: "usage" });
  assert.deepEqual(parseRoute("#/settings"), { kind: "settings" });
  assert.deepEqual(parseRoute("#/channel/%E0%A4%A"), {
    kind: "invalid",
    hash: "/channel/%E0%A4%A",
  });
  assert.deepEqual(parseRoute("#/direct/%"), {
    kind: "invalid",
    hash: "/direct/%",
  });
});

function runActivity(
  activityId: string,
  eventType: string,
  runAttemptId: string,
  roomId: string,
  createdAt: string,
): AgentActivityRecord {
  return {
    ...activity(activityId, eventType, "neutral", createdAt),
    aggregateId: runAttemptId,
    aggregateType: "run_attempt",
    roomId,
    roomKind: roomId === "room-dm" ? "direct" : "channel",
  } as AgentActivityRecord;
}

test("RunAttempts for a view come only from run facts of that Room, newest first", () => {
  const runs = runAttemptsInRoom(
    [
      runActivity(
        "a1",
        "run.started",
        "run-1",
        "room-a",
        "2026-09-26T12:00:00.000Z",
      ),
      runActivity(
        "a2",
        "run.finished",
        "run-1",
        "room-a",
        "2026-09-26T12:01:00.000Z",
      ),
      runActivity(
        "a3",
        "run.started",
        "run-dm",
        "room-dm",
        "2026-09-26T12:02:00.000Z",
      ),
      runActivity(
        "a4",
        "run.started",
        "run-2",
        "room-a",
        "2026-09-26T12:03:00.000Z",
      ),
      {
        ...activity("a5", "message.posted", "neutral"),
        aggregateType: "message",
      } as AgentActivityRecord,
    ],
    "room-a",
  );
  assert.deepEqual(runs, [
    {
      lastEventType: "run.started",
      runAttemptId: "run-2",
      updatedAt: "2026-09-26T12:03:00.000Z",
    },
    {
      lastEventType: "run.finished",
      runAttemptId: "run-1",
      updatedAt: "2026-09-26T12:01:00.000Z",
    },
  ]);
  assert.deepEqual(
    runAttemptsInRoom(
      [runActivity("a3", "run.started", "run-dm", "room-dm", NOW)],
      "room-a",
    ),
    [],
    "a private-box run never shows in the Channel view",
  );
});

function generation(overrides: Record<string, unknown> = {}) {
  return {
    cachedInputTokens: 800,
    contextUsedTokens: null,
    contextWindow: null,
    inputTokens: 1_000,
    observedAt: NOW,
    outputTokens: 50,
    provider: "codex",
    reasoningOutputTokens: 10,
    recordedAt: NOW,
    responseId: "response-1",
    ...overrides,
  };
}

test("RunAttempt drill-down shows recorded facts and unknown (never 0) for what the CLI did not report", () => {
  const codex = runUsageDetail({
    cliCosts: [],
    completeness: "partial",
    execution: {
      instanceRuntimeId: "runtime-1",
      lateFrameCount: 0,
      mode: "warm",
      sessionResumeMs: null,
    },
    finalInterrupt: {
      accepted: true,
      committedRoomSeq: 12,
      preemptedFollowUp: "unknown",
      requested: true,
      sent: true,
      terminal: false,
    },
    gaps: [
      {
        firstObservedAt: NOW,
        lastObservedAt: NOW,
        occurrences: 2,
        provider: "codex",
        reason: "correction_frame",
      },
    ],
    generations: [
      generation({ contextUsedTokens: 30_000, contextWindow: 258_000 }),
    ],
    processCleanups: [
      {
        blocking: false,
        capExceeded: [],
        cleanupId: "cleanup-1",
        foundCount: 3,
        killedCount: 3,
        observedAt: NOW,
        portsObserved: true,
        recordedAt: NOW,
        releasedPorts: [],
        remainingCount: 0,
        remainingPorts: [],
        trigger: "run_end",
        unknownCount: 0,
      },
    ],
    runAttemptId: "run-1",
    sessionResumeMs: 420,
    totals: {
      cachedInputTokens: 800,
      generations: 1,
      inputTokens: 1_000,
      outputTokens: 50,
      reasoningOutputTokens: 10,
    },
    truncated: false,
  });
  const field = (label: string) =>
    codex.rows.find((row) => row.label === label)?.value;
  assert.equal(field("执行方式"), "热（复用常驻进程）");
  assert.equal(field("session 恢复耗时"), "420 ms");
  assert.equal(field("用量完整性"), "部分（有采集缺口）");
  assert.equal(field("输入 token"), "1,000（部分）");
  assert.equal(field("上下文占用"), "30,000 / 258,000");
  assert.match(field("final 收尾") ?? "", /已请求/u);
  assert.match(field("final 收尾") ?? "", /已终止：否/u);
  assert.match(field("final 收尾") ?? "", /抢占后续生成：未知/u);
  assert.equal(field("已记录费用小计（CLI 自报）"), "未知（CLI 未报告）");
  assert.deepEqual(codex.gaps, ["correction_frame × 2（codex）"]);
  assert.deepEqual(codex.processCleanups, ["run_end：发现 3，终止 3，剩余 0"]);
  assert.equal(codex.generations[0]?.context, "30,000 / 258,000");

  const claude = runUsageDetail({
    completeness: "unavailable",
    gaps: [],
    generations: [],
    processCleanups: [],
    runAttemptId: "run-2",
    totals: {
      cachedInputTokens: null,
      generations: null,
      inputTokens: null,
      outputTokens: null,
      reasoningOutputTokens: null,
    },
    truncated: false,
  });
  const claudeField = (label: string) =>
    claude.rows.find((row) => row.label === label)?.value;
  assert.equal(claudeField("执行方式"), "未知");
  assert.equal(claudeField("session 恢复耗时"), "未知");
  assert.equal(claudeField("final 收尾"), "未知");
  assert.equal(claudeField("输入 token"), "未知");
  assert.equal(claudeField("生成次数"), "未知");
  assert.equal(claudeField("上下文占用"), "未知");
  assert.equal(claudeField("已记录费用小计（CLI 自报）"), "未知");
  for (const row of claude.rows) {
    assert.doesNotMatch(row.value, /^0( |$)/u, `${row.label} is never 0`);
  }

  const withCost = runUsageDetail({
    cliCosts: [
      {
        costId: "cost-1",
        costUsd: null,
        observedAt: NOW,
        provider: "claude",
        recordedAt: NOW,
        reportedTotalUsd: 0.5,
        source: "claude_result_total_cost_usd",
      },
      {
        costId: "cost-2",
        costUsd: 0.0123,
        observedAt: NOW,
        provider: "claude",
        recordedAt: NOW,
        reportedTotalUsd: 0.5123,
        source: "claude_result_total_cost_usd",
      },
    ],
    completeness: "complete",
    execution: null,
    finalInterrupt: null,
    gaps: [],
    generations: [generation({ provider: "claude" })],
    processCleanups: [],
    runAttemptId: "run-3",
    sessionResumeMs: null,
    totals: {
      cachedInputTokens: 800,
      generations: 1,
      inputTokens: 1_000,
      outputTokens: 50,
      reasoningOutputTokens: 10,
    },
    truncated: false,
  });
  const costField = (label: string) =>
    withCost.rows.find((row) => row.label === label)?.value;
  assert.equal(costField("final 收尾"), "本轮没有 final 回复");
  assert.equal(costField("执行方式"), "未知（按轮进程或无记录）");
  assert.equal(costField("session 恢复耗时"), "未知（未恢复或未测量）");
  assert.equal(costField("上下文占用"), "未知");
  assert.equal(
    costField("已记录费用小计（CLI 自报）"),
    "≥ $0.0123（另有 1 条增量未知，未计入）",
  );
});

test("contract §5: compaction counts are shown as recorded, unknown (never 0) when the server has none", () => {
  const counted = runUsageDetail(usageResponse({ compactionCount: 2 }));
  const none = runUsageDetail(usageResponse({ compactionCount: 0 }));
  const unobserved = runUsageDetail(usageResponse({ compactionCount: null }));
  const older = runUsageDetail(usageResponse({}));
  const compactions = (detail: ReturnType<typeof runUsageDetail>) =>
    detail.rows.find((row) => row.label === "压缩次数（本轮）")?.value;
  assert.equal(compactions(counted), "2");
  assert.equal(compactions(none), "0");
  assert.equal(compactions(unobserved), "未知（本轮无运行轨迹）");
  assert.equal(compactions(older), "未知");

  const role = {
    agentId: "agent-1",
    channelId: "room-a",
    isCurrent: true,
    roleId: "role-1",
    roleRevisionId: "revision-1",
  };
  const statuses = assembleInstanceStatuses({
    agentActivities: new Map(),
    agentHandles: new Map(),
    privateActivities: new Map(),
    roleList: {
      instances: [
        { ...role, instanceId: "instance-1", sessionCompactionCount: 3 },
        { ...role, instanceId: "instance-2", sessionCompactionCount: 0 },
        { ...role, instanceId: "instance-3", sessionCompactionCount: null },
      ],
      roles: [],
    },
    roomActivities: [],
    roomId: "room-a",
    rooms: [],
  });
  assert.deepEqual(
    statuses.map(({ compactionLabel }) => compactionLabel),
    [
      "3（本 session，Loom 托管轮次内观测）",
      "0（本 session，Loom 托管轮次内观测）",
      "未知（本 session 尚无运行轨迹）",
    ],
  );
});

function opencodeCost(index: number, costUsd: number | null) {
  return {
    costId: `cost-${String(index)}`,
    costUsd,
    observedAt: NOW,
    provider: "opencode",
    recordedAt: NOW,
    reportedTotalUsd: null,
    source: "opencode_step_finish_cost",
  };
}

function usageResponse(overrides: Record<string, unknown>) {
  return {
    completeness: "complete",
    gaps: [],
    generations: [generation({ provider: "opencode" })],
    processCleanups: [],
    runAttemptId: "run-cost",
    totals: {
      cachedInputTokens: 800,
      generations: 1,
      inputTokens: 1_000,
      outputTokens: 50,
      reasoningOutputTokens: 10,
    },
    truncated: false,
    ...overrides,
  } as Parameters<typeof runUsageDetail>[0];
}

test("RunAttempt cost is the recorded subtotal: with a collection gap the whole-run completeness is marked unknown and no missing amount is estimated", () => {
  const detail = runUsageDetail(
    usageResponse({
      cliCosts: [opencodeCost(1, 0.1)],
      completeness: "partial",
      gaps: [
        {
          firstObservedAt: NOW,
          lastObservedAt: NOW,
          occurrences: 1,
          provider: "opencode",
          reason: "parse_error",
        },
      ],
    }),
  );
  const field = (label: string) =>
    detail.rows.find((row) => row.label === label)?.value;
  assert.equal(field("CLI 自报费用"), undefined, "no whole-run cost claim");
  assert.equal(
    field("已记录费用小计（CLI 自报）"),
    "$0.1000（整轮完整性未知）",
  );

  // A gap alone (even if completeness said complete) is not a complete run.
  const gapOnly = runUsageDetail(
    usageResponse({
      cliCosts: [opencodeCost(1, 0.1)],
      gaps: [
        {
          firstObservedAt: NOW,
          lastObservedAt: NOW,
          occurrences: 1,
          provider: "opencode",
          reason: "parse_error",
        },
      ],
    }),
  );
  assert.equal(
    gapOnly.rows.find((row) => row.label === "已记录费用小计（CLI 自报）")
      ?.value,
    "$0.1000（整轮完整性未知）",
  );

  const complete = runUsageDetail(
    usageResponse({ cliCosts: [opencodeCost(1, 0.1)] }),
  );
  assert.equal(
    complete.rows.find((row) => row.label === "已记录费用小计（CLI 自报）")
      ?.value,
    "$0.1000",
  );
});

test("RunAttempt lists cut at the read limit: context is the last listed generation, the cost subtotal only covers the listed records", () => {
  const truncated = runUsageDetail(
    usageResponse({
      cliCosts: Array.from(
        { length: RUN_ATTEMPT_CLI_COST_READ_LIMIT },
        (_, i) => opencodeCost(i, 0.001),
      ),
      generations: [
        generation({ contextUsedTokens: 30_000, contextWindow: 258_000 }),
      ],
      totals: {
        cachedInputTokens: 800_000,
        generations: 1_200,
        inputTokens: 1_200_000,
        outputTokens: 60_000,
        reasoningOutputTokens: 12_000,
      },
      truncated: true,
    }),
  );
  const field = (label: string) =>
    truncated.rows.find((row) => row.label === label)?.value;
  assert.equal(
    field("上下文占用"),
    "30,000 / 258,000（所列生成中的最后一次，不代表当前窗口）",
  );
  assert.equal(
    field("已记录费用小计（CLI 自报）"),
    `≥ $1.0000（费用记录达到读取上限 ${String(RUN_ATTEMPT_CLI_COST_READ_LIMIT)} 条，之后的未列出）`,
  );
  assert.equal(truncated.truncated, true);

  const untruncated = runUsageDetail(
    usageResponse({
      generations: [
        generation({ contextUsedTokens: 30_000, contextWindow: 258_000 }),
      ],
    }),
  );
  assert.equal(
    untruncated.rows.find((row) => row.label === "上下文占用")?.value,
    "30,000 / 258,000",
  );
});

// Full review 2 A-P2-4: Role instances keep no private memory since S6;
// the reset text matches the Channel memory semantics.
test("session reset consequence: Channel memory kept, index offered again", () => {
  assert.doesNotMatch(SESSION_RESET_CONSEQUENCE, /私有记忆/u);
  assert.match(SESSION_RESET_CONSEQUENCE, /Room 历史与频道记忆保留/u);
  assert.match(
    SESSION_RESET_CONSEQUENCE,
    /新 session 启动时按读开关重新提供频道记忆索引/u,
  );
});
