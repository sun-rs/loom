/**
 * Pure console model (no DOM). Every value comes from the typed Human API;
 * this module only joins and labels it. Throwaway: deleted in phase 4.
 */
import { listMessagesBounded } from "@rah-os/client-core";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  AgentActivityRecord,
  Message,
  Room,
  RoomAgentActivity,
  RoomAgentActivityState,
  RoleListResponse,
  RuntimeSettings,
  UsageSummaryResponse,
} from "@rah-os/protocol";

/** Kernel's system principal (packages/kernel/src/system-principal.ts). */
export const SYSTEM_PRINCIPAL_ID = "principal_system";
export const MESSAGE_WINDOW = 50;
export const UNKNOWN = "未知";

type Signal = { signal?: AbortSignal };
const options = (signal: AbortSignal | undefined) =>
  signal === undefined ? undefined : { signal };

export type ConsoleIdentity = {
  controlRoomId: string;
  displayName: string;
  principalId: string;
  workspaceId: string;
  workspaceName: string;
};

export async function loadIdentity(
  client: RahClient,
  { signal }: Signal = {},
): Promise<ConsoleIdentity> {
  const [me, workspaces] = await Promise.all([
    client.request("principal.me", {}, options(signal)),
    client.request("workspace.list", {}, options(signal)),
  ]);
  const workspace = workspaces.workspaces.find(
    (candidate) =>
      candidate.state === "active" && candidate.controlRoomId !== undefined,
  );
  if (workspace === undefined || workspace.controlRoomId === undefined) {
    throw new Error("没有可用的工作区");
  }
  return {
    controlRoomId: workspace.controlRoomId,
    displayName: me.principal.displayName ?? me.principal.handle,
    principalId: me.principal.principalId,
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.name,
  };
}

export type ChannelSummary = {
  attachedDirectories: string[];
  /** Created before Channel homes: instances run in their private cwd. */
  legacyPrivateCwd: boolean;
  name: string;
  primaryDirectory: string | null;
  primaryLabel: string;
  roomId: string;
};

export function summarizeChannels(rooms: readonly Room[]): ChannelSummary[] {
  return rooms
    .filter((room) => room.kind === "channel" && room.archivedAt === undefined)
    .map((room) => {
      const workspace = room.channelWorkspace;
      const primary = workspace?.primary;
      return {
        attachedDirectories: [...(workspace?.additionalDirectories ?? [])],
        legacyPrivateCwd: workspace === undefined,
        name: room.name,
        primaryDirectory: workspace?.primaryDirectory ?? null,
        primaryLabel:
          workspace === undefined
            ? "实例使用私有 cwd"
            : primary === undefined
              ? UNKNOWN
              : primary.reason === undefined
                ? primary.state
                : `${primary.state}：${primary.reason}`,
        roomId: room.roomId,
      };
    });
}

export type ConsoleMessage = {
  actorId: string;
  body: string;
  createdAt: string;
  messageId: string;
  roomSeq: number;
  system: boolean;
};

export type MessageWindow = {
  cursorAfter: number;
  messages: readonly ConsoleMessage[];
};

function toConsoleMessage(message: Message): ConsoleMessage {
  return {
    actorId: message.actorId,
    body: message.body,
    createdAt: message.createdAt,
    messageId: message.messageId,
    roomSeq: message.roomSeq,
    system: message.actorId === SYSTEM_PRINCIPAL_ID,
  };
}

export async function loadLatestMessages(
  client: RahClient,
  roomId: string,
  { signal }: Signal = {},
): Promise<MessageWindow> {
  const page = await client.request(
    "message.list",
    { limit: MESSAGE_WINDOW, roomId },
    options(signal),
  );
  return {
    cursorAfter: page.cursorAfter,
    messages: page.messages.map(toConsoleMessage),
  };
}

/** Incremental poll after the window cursor; an empty poll returns `current`. */
export async function loadNewerMessages(
  client: RahClient,
  roomId: string,
  current: MessageWindow,
  { signal }: Signal = {},
): Promise<MessageWindow> {
  const newer = await listMessagesBounded(client, {
    afterSeq: current.cursorAfter,
    limit: MESSAGE_WINDOW,
    roomId,
    ...(signal === undefined ? {} : { signal }),
  });
  if (newer.messages.length === 0) return current;
  const known = new Set(current.messages.map(({ messageId }) => messageId));
  const merged = [
    ...current.messages,
    ...newer.messages
      .filter(({ messageId }) => !known.has(messageId))
      .map(toConsoleMessage),
  ].sort((a, b) => a.roomSeq - b.roomSeq);
  return {
    cursorAfter: Math.max(current.cursorAfter, newer.cursorAfter),
    messages: merged.slice(-MESSAGE_WINDOW),
  };
}

const WAKE_LIMIT_MARKER = "连续唤醒";

/**
 * The Channel wake-chain notice (evo §37 A) stays relevant until the Human
 * posts again. Only the loaded message window is inspected.
 */
export function wakeLimitNotice(
  messages: readonly Pick<Message, "actorId" | "body" | "roomSeq">[],
  humanPrincipalId: string,
): string | null {
  let notice: { body: string; roomSeq: number } | undefined;
  let lastHumanSeq = 0;
  for (const message of messages) {
    if (message.actorId === humanPrincipalId) {
      lastHumanSeq = Math.max(lastHumanSeq, message.roomSeq);
    } else if (
      message.actorId === SYSTEM_PRINCIPAL_ID &&
      message.body.includes(WAKE_LIMIT_MARKER) &&
      (notice === undefined || message.roomSeq > notice.roomSeq)
    ) {
      notice = { body: message.body, roomSeq: message.roomSeq };
    }
  }
  return notice !== undefined && notice.roomSeq > lastHumanSeq
    ? notice.body
    : null;
}

export function stateLabel(state: RoomAgentActivityState | undefined): string {
  switch (state) {
    case "idle":
      return "空闲";
    case "waking":
      // Durable Activation exists but a run is not proven started.
      return "排队或启动中";
    case "working":
      return "运行中";
    case "error":
      return "错误";
    default:
      return "无运行记录";
  }
}

const RUN_LIFECYCLE = new Set([
  "run.created",
  "run.started",
  "run.finished",
  "run.orphaned",
  "run.watchdog_warning",
]);

/** Newest-first activity: a warning counts only while no later run fact exists. */
export function watchdogWarningActive(
  records: readonly AgentActivityRecord[],
): string | null {
  const latest = records.find(
    (record) =>
      record.source === "room_event" && RUN_LIFECYCLE.has(record.eventType),
  );
  return latest?.source === "room_event" &&
    latest.eventType === "run.watchdog_warning"
    ? "无进展已达告警阈值"
    : null;
}

export type ProblemRecord = {
  createdAt: string;
  eventType: string;
  roomName: string;
  tone: "warning" | "error";
};

export function recentProblems(
  records: readonly AgentActivityRecord[],
  limit = 3,
): ProblemRecord[] {
  const problems: ProblemRecord[] = [];
  for (const record of records) {
    if (record.tone !== "warning" && record.tone !== "error") continue;
    problems.push({
      createdAt: record.createdAt,
      eventType:
        record.source === "room_event"
          ? record.eventType
          : `tool.${record.toolName}`,
      roomName: record.roomName,
      tone: record.tone,
    });
    if (problems.length === limit) break;
  }
  return problems;
}

export type InstanceStatus = {
  agentId: string;
  /** The instance principal's own handle (what a Channel @mention uses). */
  handle: string;
  instanceId: string;
  isCurrent: boolean;
  lastError: string | null;
  /** Still a Channel member (listed by the Room activity projection). */
  member: boolean;
  privateBoxLabel: string;
  /** Rooms (this Channel, the private box) holding queued Activations. */
  queuedCount: number;
  queuedLabel: string;
  recentProblems: ProblemRecord[];
  roleId: string;
  roleName: string;
  state: RoomAgentActivityState | undefined;
  stateLabel: string;
  updatedAt: string | null;
  watchdogWarning: string | null;
};

/**
 * `queued` is per Room (B3): 1 when that Room holds queued work. A server
 * that does not report it leaves the count unknown rather than 0.
 */
function queuedSummary(
  channel: RoomAgentActivity | undefined,
  privateBox: RoomAgentActivity | undefined,
): { count: number; label: string } {
  const flag = (entry: RoomAgentActivity | undefined) =>
    entry === undefined
      ? 0
      : entry.queued === undefined
        ? null
        : entry.queued
          ? 1
          : 0;
  const channelQueued = flag(channel);
  const privateQueued = flag(privateBox);
  if (channelQueued === null || privateQueued === null) {
    return { count: 0, label: `排队 ${UNKNOWN}` };
  }
  const count = channelQueued + privateQueued;
  return {
    count,
    label:
      count === 0
        ? "排队 0"
        : `排队 ${String(count)}（频道 ${String(channelQueued)}，私聊 ${String(privateQueued)}）`,
  };
}

export function assembleInstanceStatuses(input: {
  agentActivities: ReadonlyMap<string, readonly AgentActivityRecord[]>;
  agentHandles: ReadonlyMap<string, string>;
  privateActivities: ReadonlyMap<string, readonly RoomAgentActivity[]>;
  roleList: RoleListResponse;
  roomActivities: readonly RoomAgentActivity[];
  roomId: string;
  rooms: readonly Room[];
}): InstanceStatus[] {
  const roles = new Map(
    input.roleList.roles.map((role) => [role.roleId, role]),
  );
  const activity = new Map(
    input.roomActivities
      .filter(({ roomId }) => roomId === input.roomId)
      .map((entry) => [entry.participantId, entry]),
  );
  const privateBoxes = new Map(
    input.rooms.flatMap((room) =>
      room.instancePrivateBox === undefined
        ? []
        : [[room.instancePrivateBox.instanceId, room]],
    ),
  );
  return input.roleList.instances
    .filter(({ channelId }) => channelId === input.roomId)
    .map((instance) => {
      const role = roles.get(instance.roleId);
      const current = activity.get(instance.instanceId);
      const member = current !== undefined;
      const records = input.agentActivities.get(instance.agentId) ?? [];
      const boxRoom = privateBoxes.get(instance.instanceId);
      const box = boxRoom?.instancePrivateBox;
      const privateEntry = (
        input.privateActivities.get(instance.instanceId) ?? []
      ).find(
        (entry) =>
          entry.participantId === instance.instanceId &&
          entry.roomId === boxRoom?.roomId,
      );
      const queued = queuedSummary(current, privateEntry);
      return {
        agentId: instance.agentId,
        handle:
          input.agentHandles.get(instance.agentId) ??
          role?.configuration.handle ??
          instance.instanceId,
        instanceId: instance.instanceId,
        isCurrent: instance.isCurrent,
        lastError: current?.lastError ?? null,
        member,
        privateBoxLabel:
          box === undefined
            ? "私聊未打开"
            : box.active
              ? "私聊可用"
              : "私聊已停用",
        queuedCount: member ? queued.count : 0,
        queuedLabel: member ? queued.label : "—",
        recentProblems: recentProblems(records),
        roleId: instance.roleId,
        roleName: role?.configuration.displayName ?? instance.roleId,
        state: current?.state,
        stateLabel: member ? stateLabel(current?.state) : "已移出频道",
        updatedAt: current?.updatedAt ?? null,
        watchdogWarning: watchdogWarningActive(records),
      };
    });
}

export async function loadInstanceStatuses(
  client: RahClient,
  input: { controlRoomId: string; roomId: string; rooms: readonly Room[] },
  { signal }: Signal = {},
): Promise<InstanceStatus[]> {
  const roleList = await client.request(
    "role.list",
    { controlRoomId: input.controlRoomId },
    options(signal),
  );
  const roomActivities = await client.request(
    "room.agent.activity.list",
    { roomId: input.roomId },
    options(signal),
  );
  const instances = roleList.instances.filter(
    ({ channelId }) => channelId === input.roomId,
  );
  const agentHandles = new Map<string, string>();
  if (instances.length > 0) {
    const agents = await client.request(
      "agent.list",
      { controlRoomId: input.controlRoomId },
      options(signal),
    );
    for (const agent of agents.agents) {
      agentHandles.set(agent.definition.agentId, agent.handle);
    }
  }
  const agentActivities = new Map<string, readonly AgentActivityRecord[]>();
  const privateActivities = new Map<string, readonly RoomAgentActivity[]>();
  for (const instance of instances) {
    const page = await client.request(
      "agent.activity.list",
      { agentId: instance.agentId, limit: 20 },
      options(signal),
    );
    agentActivities.set(instance.agentId, page.activities);
    const box = input.rooms.find(
      (room) => room.instancePrivateBox?.instanceId === instance.instanceId,
    );
    if (box !== undefined) {
      const boxActivity = await client.request(
        "room.agent.activity.list",
        { roomId: box.roomId },
        options(signal),
      );
      privateActivities.set(instance.instanceId, boxActivity.agents);
    }
  }
  return assembleInstanceStatuses({
    agentActivities,
    agentHandles,
    privateActivities,
    roleList,
    roomActivities: roomActivities.agents,
    roomId: input.roomId,
    rooms: input.rooms,
  });
}

export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined
    ? UNKNOWN
    : value.toLocaleString("en-US");
}

export function formatUsd(value: number | null | undefined): string {
  return value === null || value === undefined
    ? UNKNOWN
    : `$${value.toFixed(4)}`;
}

type UsageFigure = UsageSummaryResponse["totals"];

export type UsageRow = {
  cachedInputTokens: string;
  cost: string;
  inputTokens: string;
  label: string;
  outputTokens: string;
  reasoningTokens: string;
  runs: string;
};

/**
 * Token sums cover only RunAttempts with recorded usage: no recorded run means
 * unknown (never 0); some unrecorded or partial runs mark the sum partial.
 */
export function usageRow(label: string, figure: UsageFigure): UsageRow {
  const { runs, tokens, cliEstimatedCost: cost } = figure;
  const recorded = runs.complete + runs.partial;
  const partial = runs.unavailable > 0 || runs.partial > 0;
  const tokenText = (value: number | null) => {
    if (runs.total === 0) return "—";
    if (recorded === 0 || value === null) return UNKNOWN;
    return partial ? `${formatCount(value)}（部分）` : formatCount(value);
  };
  const costPartial =
    cost.runsPartial > 0 ||
    cost.runsUnknown > 0 ||
    cost.runsUnreported > 0 ||
    runs.unavailable > 0;
  return {
    cachedInputTokens: tokenText(tokens.cachedInputTokens),
    cost:
      cost.totalUsd === null
        ? UNKNOWN
        : `${formatUsd(cost.totalUsd)}（${costPartial ? "部分，" : ""}CLI 自报）`,
    inputTokens: tokenText(tokens.inputTokens),
    label,
    outputTokens: tokenText(tokens.outputTokens),
    reasoningTokens: tokenText(tokens.reasoningOutputTokens),
    runs:
      runs.unavailable > 0
        ? `${formatCount(runs.total)}（无用量 ${formatCount(runs.unavailable)}）`
        : formatCount(runs.total),
  };
}

export type UsageWindow = "24h" | "7d";

export type UsageView = {
  rows: UsageRow[];
  totals: UsageRow;
  truncated: boolean;
};

export async function loadUsage(
  client: RahClient,
  input: {
    channelId?: string;
    labels?: ReadonlyMap<string, string>;
    now: Date;
    window: UsageWindow;
  },
  { signal }: Signal = {},
): Promise<UsageView> {
  const hours = input.window === "24h" ? 24 : 7 * 24;
  const summary = await client.request(
    "usage.summary",
    {
      ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
      from: new Date(input.now.getTime() - hours * 3_600_000).toISOString(),
      groupBy: "instance",
      to: input.now.toISOString(),
    },
    options(signal),
  );
  return {
    rows: summary.groups.map((group) => {
      const id = group.instanceId ?? group.channelId;
      return usageRow(input.labels?.get(id) ?? id, group);
    }),
    totals: usageRow("合计", summary.totals),
    truncated: summary.truncated,
  };
}

const minutes = (ms: number) => `${String(Math.round(ms / 60_000))} 分钟`;

export function settingsRows(
  settings: RuntimeSettings,
): Array<{ label: string; value: string }> {
  return [
    { label: "修订号", value: String(settings.revision) },
    { label: "本机同时运行上限", value: String(settings.maxConcurrentRuns) },
    { label: "同时启动上限", value: String(settings.maxConcurrentStarts) },
    {
      label: "启动最小间隔",
      value: `${String(settings.minStartIntervalMs)} ms`,
    },
    ...settings.runtimes.map((runtime) => ({
      label: `CLI ${runtime.runtimeProfileId} 同时运行上限`,
      value: `${String(runtime.maxConcurrentRuns)}（供给上限 ${String(runtime.offerMaxConcurrent)}）`,
    })),
    {
      label: "实例互相唤醒上限",
      value: String(settings.wakeGuard.instanceChainLimit),
    },
    {
      label: "无进展告警阈值",
      value: minutes(settings.watchdog.noProgressWarnMs),
    },
    {
      label: "排队时无进展终止阈值",
      value: minutes(settings.watchdog.queuedStallTerminateMs),
    },
    { label: "单次运行时长上限", value: minutes(settings.watchdog.maxRunMs) },
  ];
}
