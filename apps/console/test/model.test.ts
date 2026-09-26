import assert from "node:assert/strict";
import test from "node:test";

import { FakeRahClient, type RahClientOperation } from "@rah-os/client-sdk";
import type {
  AgentActivityRecord,
  Message,
  Room,
  RoomAgentActivity,
  UsageSummaryResponse,
} from "@rah-os/protocol";

import {
  MESSAGE_WINDOW,
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
  settingsRows,
  stateLabel,
  summarizeChannels,
  usageRow,
  wakeLimitNotice,
  watchdogWarningActive,
} from "../src/model.ts";

// FIXTURE ONLY: every identifier and reply below is fake test data.
const NOW = "2026-09-26T12:00:00.000Z";
const HUMAN = "principal-human-fixture";

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
      roomId: "room-a",
      state: "waking",
      updatedAt: NOW,
    },
    {
      lastError: "fixture provider exited 1",
      participantId: "instance-2",
      roomId: "room-a",
      state: "error",
      updatedAt: NOW,
    },
  ];
  const statuses = assembleInstanceStatuses({
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
        },
        {
          agentId: "agent-2",
          channelId: "room-a",
          instanceId: "instance-2",
          isCurrent: false,
          roleId: "role-1",
          roleRevisionId: "revision-0",
        },
        {
          agentId: "agent-3",
          channelId: "room-other",
          instanceId: "instance-3",
          isCurrent: true,
          roleId: "role-1",
          roleRevisionId: "revision-1",
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
    ["instance-1", "instance-2"],
  );
  const [first, second] = statuses;
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
    throw new Error(`unexpected ${operation}`);
  });
  const statuses = await loadInstanceStatuses(client, {
    controlRoomId: "room-control",
    roomId: "room-a",
    rooms: [],
  });
  assert.equal(statuses[0]?.stateLabel, "运行中");
  assert.deepEqual(calls, [
    ["role.list", { controlRoomId: "room-control" }],
    ["room.agent.activity.list", { roomId: "room-a" }],
    ["agent.activity.list", { agentId: "agent-1", limit: 20 }],
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
  ]);
});
