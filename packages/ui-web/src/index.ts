import type {
  AgentCatalogEntry,
  ClientHealthResponse,
  LocalRuntimeInventoryEntry,
  MembershipRole,
  Message,
  Principal,
  Room,
  Task,
  Workspace,
} from "@rah-os/protocol";

export type RoomMessageView = {
  actorId: string;
  author: string;
  body: string;
  createdAt: string;
  messageId: string;
  roomSeq: number;
};

export type TaskColumnId =
  "closed" | "done" | "in-progress" | "review" | "todo";

export type RoomTaskView = Task & { assigneeLabel?: string };

export type TaskColumnView = {
  id: TaskColumnId;
  label: string;
  tasks: readonly RoomTaskView[];
  tone: "cyan" | "gray" | "green" | "orange" | "purple";
};

export type RoomViewModel = {
  messages: readonly RoomMessageView[];
  taskColumns: readonly TaskColumnView[];
};

export type RoomAgentTarget = {
  handle: string;
  participantId: string;
};

export type MobileNavigationDestination = "agents" | "chat" | "rooms" | "tasks";

export type WorkspaceAgentView = {
  agentDefinitionId: string;
  avatarKey?: string;
  description?: string;
  displayName: string;
  handle: string;
  participantId: string;
  role: string;
  runtimeAvailable: boolean;
  runtimeLabels: readonly string[];
  state: AgentCatalogEntry["definition"]["state"];
};

export type RoomAgentCandidate = WorkspaceAgentView & { joined: boolean };

export function activeMobileNavigation(input: {
  activeSurface: "agents" | "computers" | "room";
  activeTab: "chat" | "files" | "tasks";
  roomsOpen: boolean;
}): MobileNavigationDestination | undefined {
  if (input.roomsOpen) return "rooms";
  if (input.activeSurface === "agents") return "agents";
  if (input.activeSurface === "computers") return undefined;
  if (input.activeTab === "chat") return "chat";
  if (input.activeTab === "tasks") return "tasks";
  return undefined;
}

export function roomSlugFromName(name: string): string {
  return name
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function roomSelectionFromSearch(search: string): string | undefined {
  const roomId = new URLSearchParams(search).get("room")?.trim();
  return roomId === undefined || roomId.length === 0 ? undefined : roomId;
}

export function roomSelectionSearch(roomId: string): string {
  const search = new URLSearchParams();
  search.set("room", roomId);
  return `?${search.toString()}`;
}

export function opaqueIdFromBytes(bytes: Uint8Array): string {
  if (bytes.byteLength !== 16) {
    throw new Error("Opaque browser ids require exactly 16 random bytes");
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function workspaceAgentDirectory(input: {
  agents: readonly AgentCatalogEntry[];
  runtimes: readonly LocalRuntimeInventoryEntry[];
}): WorkspaceAgentView[] {
  return input.agents
    .map((agent) => {
      const boundRuntimes = input.runtimes.filter((runtime) =>
        runtime.agentBindings.some(
          ({ agentDefinitionId }) =>
            agentDefinitionId === agent.definition.agentDefinitionId,
        ),
      );
      return Object.freeze({
        agentDefinitionId: agent.definition.agentDefinitionId,
        ...(agent.currentRevision.avatarKey === undefined
          ? {}
          : { avatarKey: agent.currentRevision.avatarKey }),
        ...(agent.currentRevision.description === undefined
          ? {}
          : { description: agent.currentRevision.description }),
        displayName: agent.currentRevision.displayName ?? agent.handle,
        handle: agent.handle,
        participantId: agent.definition.participantId,
        role: agent.currentRevision.role,
        runtimeAvailable: boundRuntimes.some(
          ({ available, configured }) => available && configured,
        ),
        runtimeLabels: Object.freeze(
          [
            ...new Set(boundRuntimes.map(({ displayName }) => displayName)),
          ].sort(),
        ),
        state: agent.definition.state,
      });
    })
    .sort(
      (left, right) =>
        left.handle.localeCompare(right.handle) ||
        left.participantId.localeCompare(right.participantId),
    );
}

export function roomAgentCandidates(input: {
  directory: readonly WorkspaceAgentView[];
  memberIds: readonly string[];
}): RoomAgentCandidate[] {
  const members = new Set(input.memberIds);
  return input.directory.map((agent) =>
    Object.freeze({ ...agent, joined: members.has(agent.participantId) }),
  );
}

export function roomAgentTargets(
  members: readonly Principal[],
): RoomAgentTarget[] {
  return members
    .filter((member) => member.kind === "agent")
    .map((member) => ({
      handle: member.handle,
      participantId: member.principalId,
    }))
    .sort(
      (left, right) =>
        left.handle.localeCompare(right.handle) ||
        left.participantId.localeCompare(right.participantId),
    );
}

export function roomMessageAttentionRecipients(input: {
  availableAgents: readonly RoomAgentTarget[];
  mentionedParticipantIds: readonly string[];
}): Array<{ participantId: string; reason: "mention" }> {
  return validateSelectedRoomAgents({
    availableAgents: input.availableAgents,
    selectedParticipantIds: input.mentionedParticipantIds,
  }).map((participantId) => ({ participantId, reason: "mention" }));
}

export function mentionedRoomAgentIds(input: {
  agents: readonly RoomAgentTarget[];
  body: string;
}): string[] {
  return input.agents
    .filter(({ handle }) => {
      const escapedHandle = handle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      return new RegExp(
        `(^|[^A-Za-z0-9_.-])@${escapedHandle}(?![A-Za-z0-9_.-])`,
        "iu",
      ).test(input.body);
    })
    .map(({ participantId }) => participantId)
    .sort();
}

export function taskAssigneeForSelectedAgents(input: {
  availableAgents: readonly RoomAgentTarget[];
  selectedParticipantIds: readonly string[];
}): string | undefined {
  const selected = validateSelectedRoomAgents(input);
  if (input.availableAgents.length === 0 && selected.length === 0) {
    return undefined;
  }
  if (selected.length === 1) return selected[0];
  if (selected.length === input.availableAgents.length) return undefined;
  throw new Error(
    "Task v1 仅支持指定一个 Agent，或开放给当前 Room 的全部 Agents",
  );
}

function validateSelectedRoomAgents(input: {
  availableAgents: readonly RoomAgentTarget[];
  selectedParticipantIds: readonly string[];
}): string[] {
  const available = new Set(
    input.availableAgents.map(({ participantId }) => participantId),
  );
  const selected = [...new Set(input.selectedParticipantIds)].sort();
  for (const participantId of selected) {
    if (!available.has(participantId)) {
      throw new Error(`Agent ${participantId} is not a member of this Room`);
    }
  }
  return selected;
}

export function canHumanCompleteTask(input: {
  caughtUp: boolean;
  currentPrincipalId: string | undefined;
  task: Task;
  taskWrite: boolean;
}): boolean {
  return (
    input.caughtUp &&
    input.taskWrite &&
    input.task.state === "submitted" &&
    input.currentPrincipalId !== undefined &&
    input.task.creatorId === input.currentPrincipalId
  );
}

function isManagerRole(role: MembershipRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function canManageRoomMembers(input: {
  caughtUp: boolean;
  memberWrite: boolean;
  role: MembershipRole | undefined;
}): boolean {
  return input.caughtUp && input.memberWrite && isManagerRole(input.role);
}

export function canOnboardWorkspaceAgent(input: {
  agentOnboard: boolean;
  caughtUp: boolean;
  memberWrite: boolean;
  role: MembershipRole | undefined;
}): boolean {
  return (
    input.agentOnboard &&
    canManageRoomMembers({
      caughtUp: input.caughtUp,
      memberWrite: input.memberWrite,
      role: input.role,
    })
  );
}

export function canCreateWorkspaceRoom(input: {
  role: MembershipRole | undefined;
  roomWrite: boolean;
}): boolean {
  return input.roomWrite && isManagerRole(input.role);
}

export function selectProductRooms(input: {
  rooms: readonly Room[];
  workspaces: readonly Workspace[];
}): Room[] {
  const activeWorkspaceIds = new Set(
    input.workspaces
      .filter((workspace) => workspace.state === "active")
      .map((workspace) => workspace.workspaceId),
  );
  return input.rooms.filter(
    (room) =>
      room.kind !== "control" && activeWorkspaceIds.has(room.workspaceId),
  );
}

export function foundationCapabilityIssue(
  health: ClientHealthResponse,
): string | undefined {
  if (health.state !== "online") {
    return `daemon 当前状态为 ${health.state}`;
  }
  const required = [
    ["workspaceRead", health.capabilities.workspaceRead],
    ["roomRead", health.capabilities.roomRead],
    ["roomSync", health.capabilities.roomSync],
    ["cursorAcknowledge", health.capabilities.cursorAcknowledge],
  ] as const;
  const missing = required
    .filter(([, enabled]) => !enabled)
    .map(([capability]) => capability);
  return missing.length === 0
    ? undefined
    : `daemon 缺少基础 capability: ${missing.join(", ")}`;
}

export function roomPollDelay(input: {
  caughtUp: boolean;
  consecutiveFailures: number;
  visible: boolean;
}): number {
  if (!input.visible) return 15_000;
  if (input.consecutiveFailures > 0) {
    return Math.min(
      30_000,
      1_000 * 2 ** Math.min(input.consecutiveFailures - 1, 5),
    );
  }
  return input.caughtUp ? 5_000 : 250;
}

export function createRoomViewModel(input: {
  members: readonly Principal[];
  messages: readonly Message[];
  tasks: readonly Task[];
}): RoomViewModel {
  const handles = new Map(
    input.members.map((member) => [member.principalId, member.handle]),
  );
  const tasks = (states: readonly Task["state"][]) =>
    input.tasks
      .filter((task) => states.includes(task.state))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((task) => {
        const assigneeLabel =
          task.assigneeId === undefined
            ? undefined
            : (handles.get(task.assigneeId) ?? task.assigneeId);
        return Object.freeze({
          ...task,
          ...(assigneeLabel === undefined ? {} : { assigneeLabel }),
        });
      });

  return Object.freeze({
    messages: Object.freeze(
      [...input.messages]
        .sort((left, right) => left.roomSeq - right.roomSeq)
        .map((message) =>
          Object.freeze({
            actorId: message.actorId,
            author: handles.get(message.actorId) ?? message.actorId,
            body: message.body,
            createdAt: message.createdAt,
            messageId: message.messageId,
            roomSeq: message.roomSeq,
          }),
        ),
    ),
    taskColumns: Object.freeze([
      Object.freeze({
        id: "todo" as const,
        label: "待办",
        tasks: Object.freeze(tasks(["todo"])),
        tone: "orange" as const,
      }),
      Object.freeze({
        id: "in-progress" as const,
        label: "进行中",
        tasks: Object.freeze(
          tasks(["claimed", "in_progress", "waiting_input", "blocked"]),
        ),
        tone: "cyan" as const,
      }),
      Object.freeze({
        id: "review" as const,
        label: "待确认",
        tasks: Object.freeze(tasks(["submitted"])),
        tone: "purple" as const,
      }),
      Object.freeze({
        id: "done" as const,
        label: "完成",
        tasks: Object.freeze(tasks(["completed"])),
        tone: "green" as const,
      }),
      Object.freeze({
        id: "closed" as const,
        label: "已关闭",
        tasks: Object.freeze(tasks(["cancelled"])),
        tone: "gray" as const,
      }),
    ]),
  });
}
