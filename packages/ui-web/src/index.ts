import type {
  AgentCatalogEntry,
  ClientHealthResponse,
  LocalRuntimeInventoryEntry,
  MembershipRole,
  Message,
  Principal,
  Room,
  Task,
  TaskReview,
  TaskSubmission,
  Workspace,
} from "@rah-os/protocol";
import {
  messageMentionCandidates,
  messageReferenceNameKey,
  projectTaskLifecycle,
  taskWorkflowStatus,
} from "@rah-os/protocol";

export type RoomMessageView = {
  mentions?: Message["mentions"];
  attachmentComment?: Message["attachmentComment"];
  attachments?: readonly import("@rah-os/protocol").Attachment[];
  actorId: string;
  author: string;
  body: string;
  createdAt: string;
  forwardedBundle?: import("@rah-os/protocol").ForwardedMessageBundle;
  messageId: string;
  roomId?: string;
  roomSeq: number;
};

export type TaskColumnId =
  "closed" | "done" | "in-progress" | "review" | "todo";

export type TaskStatusPresentation = {
  id: TaskColumnId;
  label: "已关闭" | "完成" | "进行中" | "待办" | "待确认";
  tone: "cyan" | "gray" | "green" | "orange" | "purple";
};

export const TASK_COLUMN_PRESENTATIONS: Readonly<
  Record<TaskColumnId, TaskStatusPresentation>
> = Object.freeze({
  todo: Object.freeze({ id: "todo", label: "待办", tone: "orange" }),
  "in-progress": Object.freeze({
    id: "in-progress",
    label: "进行中",
    tone: "cyan",
  }),
  review: Object.freeze({
    id: "review",
    label: "待确认",
    tone: "purple",
  }),
  done: Object.freeze({ id: "done", label: "完成", tone: "green" }),
  closed: Object.freeze({ id: "closed", label: "已关闭", tone: "gray" }),
});

/** Shared Raft five-state presentation for every Web Task surface. */
export function taskStatusPresentation(
  source: Task["state"] | Pick<Task, "state" | "workflowStatus">,
): TaskStatusPresentation {
  const status = taskWorkflowStatus(source);
  const id: TaskColumnId =
    status === "in_progress"
      ? "in-progress"
      : status === "in_review"
        ? "review"
        : status;
  return TASK_COLUMN_PRESENTATIONS[id];
}

/** Secondary execution detail; never becomes a sixth Kanban column. */
export function taskAttentionLabel(
  task: Pick<Task, "blockedReason" | "state">,
): string | undefined {
  const lifecycle = projectTaskLifecycle(task);
  if (lifecycle.executionPhase === "claimed") return "已认领";
  if (lifecycle.attention?.kind === "waiting_input") return "等待输入";
  if (lifecycle.attention?.kind === "blocked") {
    return `已阻塞：${lifecycle.attention.reason}`;
  }
  return undefined;
}

export type RoomTaskView = Task & {
  assigneeLabel?: string;
  collaboratorLabels: readonly string[];
  reviewerLabels: readonly string[];
};

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

export type MobileNavigationDestination =
  "home" | "members" | "settings" | "tasks";

export type WorkspaceAgentView = {
  instanceChannelId?: string;
  modelBindingId?: string;
  presence?: import("@rah-os/protocol").AgentPresence;
  agentId: string;
  agentDefinitionRevisionId?: string;
  avatarKey?: string;
  createdAt: string;
  createdBy: string;
  description?: string;
  displayName: string;
  executionPolicyRevisionId: string;
  handle: string;
  participantId: string;
  role: string;
  runtimeAvailable: boolean;
  connectionStatus?: "online" | "offline" | "draining" | "unknown";
  runtimeLabels: readonly string[];
  skillRefs: readonly AgentCatalogEntry["currentRevision"]["skillRefs"][number][];
  state: AgentCatalogEntry["definition"]["state"];
};

export type RoomAgentCandidate = WorkspaceAgentView & { joined: boolean };

export function activeMobileNavigation(input: {
  activeSurface:
    | "saved"
    | "agents"
    | "computers"
    | "room"
    | "settings"
    | "tasks"
    | "search"
    | "activity";
  homeOpen: boolean;
}): MobileNavigationDestination | undefined {
  if (input.homeOpen) return "home";
  if (input.activeSurface === "agents") return "members";
  if (input.activeSurface === "settings") return "settings";
  if (input.activeSurface === "computers") return "settings";
  if (input.activeSurface === "tasks") return "tasks";
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
  const params = new URLSearchParams(search);
  const roomId = (
    params.get("surface") === "search"
      ? (params.get("previewRoom") ?? params.get("room"))
      : params.get("room")
  )?.trim();
  return roomId === undefined || roomId.length === 0 ? undefined : roomId;
}

export function roomSelectionSearch(
  roomId: string,
  threadRootMessageId?: string,
): string {
  const search = new URLSearchParams();
  search.set("room", roomId);
  if (threadRootMessageId !== undefined) {
    search.set("thread", `${roomId}:${threadRootMessageId}`);
  }
  return `?${search.toString()}`;
}

export function threadRootSelectionFromSearch(
  search: string,
  roomId: string,
): string | undefined {
  const value = new URLSearchParams(search).get("thread")?.trim();
  if (value === undefined || value.length === 0) return undefined;
  const prefix = `${roomId}:`;
  if (!value.startsWith(prefix)) return undefined;
  const rootMessageId = value.slice(prefix.length).trim();
  return rootMessageId.length === 0 ? undefined : rootMessageId;
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
          ({ agentId }) => agentId === agent.definition.agentId,
        ),
      );
      return Object.freeze({
        ...(agent.modelBindingId
          ? { modelBindingId: agent.modelBindingId }
          : {}),
        ...(agent.instanceChannelId
          ? { instanceChannelId: agent.instanceChannelId }
          : {}),
        agentId: agent.definition.agentId,
        agentDefinitionRevisionId:
          agent.currentRevision.agentDefinitionRevisionId,
        ...(agent.currentRevision.avatarKey === undefined
          ? {}
          : { avatarKey: agent.currentRevision.avatarKey }),
        ...(agent.currentRevision.description === undefined
          ? {}
          : { description: agent.currentRevision.description }),
        createdAt: agent.definition.createdAt,
        createdBy: agent.currentRevision.createdBy,
        displayName: agent.currentRevision.displayName ?? agent.handle,
        executionPolicyRevisionId:
          agent.currentRevision.executionPolicyRevisionId,
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
        skillRefs: Object.freeze([...agent.currentRevision.skillRefs]),
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
  const agentsByHandle = new Map<string, RoomAgentTarget[]>();
  for (const agent of input.agents) {
    const key = agent.handle;
    agentsByHandle.set(key, [...(agentsByHandle.get(key) ?? []), agent]);
  }
  const uniqueAgents = [...agentsByHandle.values()].flatMap((agents) =>
    agents.length === 1 ? agents : [],
  );
  const mentionedHandles = new Set(
    messageMentionCandidates(
      input.body,
      uniqueAgents.map(({ handle }) => handle),
    ).map(({ handle }) => handle),
  );
  return uniqueAgents
    .filter(({ handle }) => mentionedHandles.has(handle))
    .map(({ participantId }) => participantId)
    .sort();
}

export type TaskParticipantSelection = {
  assigneeId?: string;
  collaboratorIds: string[];
  reviewerIds: string[];
};

export function taskParticipantsForSelection(input: {
  availableAgents: readonly RoomAgentTarget[];
  assigneeId?: string;
  collaboratorIds: readonly string[];
  reviewerIds: readonly string[];
}): TaskParticipantSelection {
  const collaboratorIds = validateSelectedRoomAgents({
    availableAgents: input.availableAgents,
    selectedParticipantIds: input.collaboratorIds,
  });
  const reviewerIds = validateSelectedRoomAgents({
    availableAgents: input.availableAgents,
    selectedParticipantIds: input.reviewerIds,
  });
  if (
    input.assigneeId !== undefined &&
    !input.availableAgents.some(
      ({ participantId }) => participantId === input.assigneeId,
    )
  ) {
    throw new Error(`Agent ${input.assigneeId} is not a member of this Room`);
  }
  if (
    input.assigneeId === undefined &&
    (collaboratorIds.length > 0 || reviewerIds.length > 0)
  ) {
    throw new Error("协作者和审阅者需要一个明确的任务负责人");
  }
  if (
    input.assigneeId !== undefined &&
    (collaboratorIds.includes(input.assigneeId) ||
      reviewerIds.includes(input.assigneeId))
  ) {
    throw new Error("任务负责人不能同时出现在协作者或审阅者中");
  }
  return {
    ...(input.assigneeId === undefined ? {} : { assigneeId: input.assigneeId }),
    collaboratorIds,
    reviewerIds,
  };
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

export type TaskReviewStatus = {
  approvedReviewerIds: readonly string[];
  currentSubmission?: TaskSubmission;
  requiredReviewerIds: readonly string[];
  satisfied: boolean;
};

export function taskReviewStatus(input: {
  reviews: readonly TaskReview[];
  submissions: readonly TaskSubmission[];
  task: Task;
}): TaskReviewStatus {
  const requiredReviewerIds = [...input.task.reviewerIds].sort();
  const currentSubmission = input.submissions
    .filter(({ taskId }) => taskId === input.task.taskId)
    .sort((left, right) => right.submissionNumber - left.submissionNumber)[0];
  const approved = new Set(
    currentSubmission === undefined
      ? []
      : input.reviews
          .filter(
            (review) =>
              review.submissionId === currentSubmission.submissionId &&
              review.disposition === "approved",
          )
          .map(({ reviewerId }) => reviewerId),
  );
  const approvedReviewerIds = requiredReviewerIds.filter((reviewerId) =>
    approved.has(reviewerId),
  );
  return {
    approvedReviewerIds,
    ...(currentSubmission === undefined ? {} : { currentSubmission }),
    requiredReviewerIds,
    satisfied:
      requiredReviewerIds.length === 0 ||
      (currentSubmission !== undefined &&
        approvedReviewerIds.length === requiredReviewerIds.length),
  };
}

export function canHumanCompleteTask(input: {
  caughtUp: boolean;
  currentPrincipalId: string | undefined;
  reviews?: readonly TaskReview[];
  submissions?: readonly TaskSubmission[];
  task: Task;
  taskWrite: boolean;
}): boolean {
  const review = taskReviewStatus({
    reviews: input.reviews ?? [],
    submissions: input.submissions ?? [],
    task: input.task,
  });
  return (
    input.caughtUp &&
    input.taskWrite &&
    input.task.state === "submitted" &&
    input.currentPrincipalId !== undefined &&
    input.task.creatorId === input.currentPrincipalId &&
    review.satisfied
  );
}

export function canHumanCancelTask(input: {
  caughtUp: boolean;
  currentPrincipalId: string | undefined;
  task: Task;
  taskWrite: boolean;
}): boolean {
  return (
    input.caughtUp &&
    input.taskWrite &&
    input.currentPrincipalId !== undefined &&
    input.task.creatorId === input.currentPrincipalId &&
    input.task.state !== "completed" &&
    input.task.state !== "cancelled"
  );
}

export function canHumanReopenTask(input: {
  caughtUp: boolean;
  currentPrincipalId: string | undefined;
  task: Task;
  taskWrite: boolean;
}): boolean {
  return (
    input.caughtUp &&
    input.taskWrite &&
    input.currentPrincipalId !== undefined &&
    input.task.creatorId === input.currentPrincipalId &&
    input.task.state === "cancelled"
  );
}

export function canHumanSetTaskAssignee(input: {
  caughtUp: boolean;
  currentPrincipalId: string | undefined;
  task: Task;
  taskWrite: boolean;
}): boolean {
  return (
    input.caughtUp &&
    input.taskWrite &&
    input.task.state === "todo" &&
    input.task.claimedBy === undefined &&
    input.currentPrincipalId !== undefined &&
    input.task.creatorId === input.currentPrincipalId
  );
}

export function canHumanForceReassignTask(input: {
  caughtUp: boolean;
  currentPrincipalId: string | undefined;
  task: Task;
  taskReassignment: boolean;
  taskWrite: boolean;
}): boolean {
  return (
    input.caughtUp &&
    input.taskReassignment &&
    input.taskWrite &&
    input.currentPrincipalId !== undefined &&
    input.task.creatorId === input.currentPrincipalId &&
    (input.task.state === "claimed" || input.task.state === "in_progress") &&
    input.task.assigneeId !== undefined &&
    input.task.claimedBy === input.task.assigneeId
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
      room.kind !== "control" &&
      room.archivedAt === undefined &&
      activeWorkspaceIds.has(room.workspaceId),
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
    input.members.map((member) => [
      member.principalId,
      member.displayName || member.handle,
    ]),
  );
  const tasks = (status: ReturnType<typeof taskWorkflowStatus>) =>
    input.tasks
      .filter((task) => taskWorkflowStatus(task) === status)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((task) => {
        const assigneeLabel =
          task.assigneeId === undefined
            ? undefined
            : (handles.get(task.assigneeId) ?? task.assigneeId);
        return Object.freeze({
          ...task,
          ...(assigneeLabel === undefined ? {} : { assigneeLabel }),
          collaboratorLabels: Object.freeze(
            (task.collaboratorIds ?? []).map(
              (participantId) => handles.get(participantId) ?? participantId,
            ),
          ),
          reviewerLabels: Object.freeze(
            (task.reviewerIds ?? []).map(
              (participantId) => handles.get(participantId) ?? participantId,
            ),
          ),
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
            ...(message.mentions === undefined
              ? {}
              : { mentions: message.mentions }),
            ...(message.attachmentComment
              ? { attachmentComment: message.attachmentComment }
              : {}),
            ...(message.attachments?.length
              ? { attachments: message.attachments }
              : {}),
            createdAt: message.createdAt,
            ...(message.forwardedBundle === undefined
              ? {}
              : { forwardedBundle: message.forwardedBundle }),
            messageId: message.messageId,
            roomId: message.roomId,
            roomSeq: message.roomSeq,
          }),
        ),
    ),
    taskColumns: Object.freeze([
      Object.freeze({
        ...TASK_COLUMN_PRESENTATIONS.todo,
        tasks: Object.freeze(tasks("todo")),
      }),
      Object.freeze({
        ...TASK_COLUMN_PRESENTATIONS["in-progress"],
        tasks: Object.freeze(tasks("in_progress")),
      }),
      Object.freeze({
        ...TASK_COLUMN_PRESENTATIONS.review,
        tasks: Object.freeze(tasks("in_review")),
      }),
      Object.freeze({
        ...TASK_COLUMN_PRESENTATIONS.done,
        tasks: Object.freeze(tasks("done")),
      }),
      Object.freeze({
        ...TASK_COLUMN_PRESENTATIONS.closed,
        tasks: Object.freeze(tasks("closed")),
      }),
    ]),
  });
}
