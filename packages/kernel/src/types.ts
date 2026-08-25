import type {
  Activation,
  ActivationReason,
  AgentDefinition,
  AgentDefinitionRevision,
  ExecutionPolicyRevision,
  InboxState,
  InputRequest,
  ParticipantKind,
  PlacementDecision,
  RoomEvent,
  RuntimeRecoveryDescriptor,
  Task,
} from "@rah-os/protocol";

export type Principal = {
  principalId: string;
  handle: string;
  kind: ParticipantKind;
};

export type ProvisionedPrincipal = {
  principal: Principal;
  accessToken: string;
};

export type HostRecord = {
  hostId: string;
  instanceId: string;
  participantIds: string[];
  state: "online" | "draining" | "offline";
  lastSeenAt: string;
  buildVersion?: string;
  processId?: number;
  protocolVersion?: number;
};

export type ProvisionedHostCredential = {
  accessToken: string;
  credentialId: string;
  hostId: string;
  participantIds: string[];
};

export type RunAttempt = {
  runAttemptId: string;
  activationId: string;
  roomId: string;
  participantId: string;
  hostId: string;
  attemptNumber: number;
  state:
    | "starting"
    | "running"
    | "orphaned"
    | "exited"
    | "failed"
    | "cancelled"
    | "timed_out";
  startedAt: string;
  runtimeRunId?: string;
  exitCode?: number;
  exitSignal?: string;
  error?: string;
  finishedAt?: string;
  placement?: PlacementDecision;
};

export type ExecutionPolicyContent = Omit<
  ExecutionPolicyRevision,
  | "contentDigest"
  | "controlRoomId"
  | "createdAt"
  | "createdBy"
  | "executionPolicyId"
  | "executionPolicyRevisionId"
  | "revision"
>;

export type ExecutionPolicyMutationResult = {
  deduplicated: boolean;
  event: RoomEvent;
  policy: ExecutionPolicyRevision;
};

export type ExecutionPolicyRecord = {
  currentRevision: ExecutionPolicyRevision;
};

export type AgentDefinitionContent = Omit<
  AgentDefinitionRevision,
  | "agentDefinitionId"
  | "agentDefinitionRevisionId"
  | "contentDigest"
  | "createdAt"
  | "createdBy"
  | "revision"
>;

export type AgentDefinitionMutationResult = {
  deduplicated: boolean;
  definition: AgentDefinition;
  event: RoomEvent;
  revision: AgentDefinitionRevision;
};

export type AgentDefinitionRecord = {
  currentRevision: AgentDefinitionRevision;
  definition: AgentDefinition;
};

export type RuntimeProcessRecord = {
  runtimeProcessId: string;
  runAttemptId: string;
  activationId: string;
  roomId: string;
  participantId: string;
  launchHostId: string;
  runtimeRunId: string;
  recoveryDescriptor: RuntimeRecoveryDescriptor;
  state: "prepared" | "active" | "orphaned" | "terminated";
  registeredAt: string;
  updatedAt: string;
  recoveryAttemptCount: number;
  recoveryLeaseOwner?: string;
  recoveryLeaseOwnerInstanceId?: string;
  recoveryLeaseUntil?: string;
  recoveryLastError?: string;
  exitCode?: number;
  exitSignal?: string;
  terminatedAt?: string;
};

export type Room = {
  roomId: string;
  slug: string;
  name: string;
};

export type InboxItem = {
  inboxItemId: string;
  roomId: string;
  participantId: string;
  eventId: string;
  eventSeq: number;
  reason: ActivationReason;
  state: InboxState;
  createdAt: string;
  acknowledgedAt?: string;
};

export type OutboxEntry = {
  outboxId: string;
  roomId: string;
  roomSeq: number;
  topic: string;
  payload: Record<string, unknown>;
  createdAt: string;
  availableAtMs: number;
  attemptCount: number;
  publishedAt?: string;
  leaseOwner?: string;
  leaseUntil?: string;
  lastError?: string;
};

export type RoomSnapshot = {
  room: Room;
  members: Principal[];
};

export type SyncResult = {
  cursorBefore: number;
  cursorAfter: number;
  latestRoomSeq: number;
  snapshot: RoomSnapshot | null;
  events: RoomEvent[];
};

export type MessageMutationResult = {
  deduplicated: boolean;
  event: RoomEvent;
  activationIds: string[];
};

export type TaskMutationResult = {
  deduplicated: boolean;
  event: RoomEvent;
  task: Task;
};

export type InputRequestMutationResult = {
  deduplicated: boolean;
  event: RoomEvent;
  inputRequest: InputRequest;
  task: Task;
};

export type InputRequestResolveMutationResult = InputRequestMutationResult & {
  activationIds: string[];
};

export type TaskCreateMutationResult = TaskMutationResult & {
  activationIds: string[];
};

export type { Activation, ActivationReason, InputRequest, RoomEvent, Task };
