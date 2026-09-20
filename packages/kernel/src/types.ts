import type { WorkerAddressing } from "@rah-os/protocol";
import type {
  Activation,
  ActivationReason,
  AgentCatalogEntry,
  AgentDefinition,
  AgentDefinitionRevision,
  ClientAgentManageRequest,
  ClientAgentManageResponse,
  AgentRuntimeContext,
  ExecutionPolicyRevision,
  InboxState,
  InputRequest,
  Message,
  ModelIntent,
  ParticipantKind,
  PlacementDecision,
  ContextManifest,
  Room,
  RoomMembership,
  RoomEvent,
  WorkerPresentedContext,
  RuntimeRecoveryDescriptor,
  Task,
  Thread,
  ToolAccessMode,
  WorkerMessageHeldResponse,
  Workspace,
} from "@rah-os/protocol";

export type Principal = {
  description?: string;
  avatarKey?: string;
  displayName?: string;
  principalId: string;
  handle: string;
  kind: ParticipantKind;
};

export type ProvisionedPrincipal = {
  principal: Principal;
  accessToken: string;
};

export type HostRecord = {
  createdAt?: string;
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
  contextManifest?: ContextManifest;
  placement?: PlacementDecision;
};

export type PlacementLaunchClaim = {
  activation: Activation;
  agentContext: AgentRuntimeContext;
  placement: PlacementDecision;
  runAttempt: RunAttempt;
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
  | "toolAccessMode"
> & { toolAccessMode?: ToolAccessMode };

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
  | "agentId"
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

export type WorkspaceAgentProvisionInput = {
  executionWorkspace?: AgentDefinitionRevision["executionWorkspace"];
  avatarKey?: string;
  basedOnRoomSeq: number;
  controlRoomId: string;
  description?: string;
  displayName: string;
  handle: string;
  idempotencyKey: string;
  instructions: string;
  modelIntent: ModelIntent;
  role: string;
  runtimeOfferId: string;
  sessionPolicy?: "prefer_resume" | undefined;
  toolAccessMode?: ToolAccessMode;
};

export type WorkspaceAgentManagementInput = ClientAgentManageRequest;
export type WorkspaceAgentManagementResult = ClientAgentManageResponse;

export type WorkspaceAgentHostBinding = {
  hostId: string;
  runtimeOfferId: string;
  runtimeProfileId: string;
  runtimeProfileRevisionId: string;
};

export type WorkspaceAgentProvisionResult = {
  agent: AgentCatalogEntry;
  deduplicated: boolean;
  event: RoomEvent;
  hostBinding: WorkspaceAgentHostBinding;
  policy: ExecutionPolicyRevision;
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
  eventFloorSeq?: number;
  latestRoomSeq: number;
  snapshot: RoomSnapshot | null;
  snapshotSeq?: number;
  events: RoomEvent[];
};

/**
 * A Worker delivery is the same window plus the read-only presented context
 * the Kernel already owns. The field is absent whenever no delivered event was
 * already shown to this participant.
 */
export type WorkerSyncResult = SyncResult & {
  addressing?: WorkerAddressing;
  presentedContext?: WorkerPresentedContext;
};

export type MessageMutationResult = {
  deduplicated: boolean;
  event: RoomEvent;
  activationIds: string[];
};

export type WorkerMessagePostResult =
  | (MessageMutationResult & { replacedDraft?: { body: string } })
  | WorkerMessageHeldResponse;

export type MessagePage = {
  cursorAfter: number;
  cursorBefore: number;
  hasMoreAfter: boolean;
  hasMoreBefore: boolean;
  messages: Message[];
};

export type RoomMembershipMutationResult = {
  deduplicated: boolean;
  event: RoomEvent;
  membership: RoomMembership;
};

export type RoomMembershipRemovalResult = {
  deduplicated: boolean;
  event: RoomEvent;
  removedPrincipalId: string;
};

export type WorkspaceMutationResult = {
  controlRoom: Room;
  deduplicated: boolean;
  event: RoomEvent;
  workspace: Workspace;
};

export type RoomMutationResult = {
  deduplicated: boolean;
  event: RoomEvent;
  room: Room;
};

export type ThreadMutationResult = {
  activationIds: string[];
  deduplicated: boolean;
  event: RoomEvent;
  thread: Thread;
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

export type {
  Activation,
  ActivationReason,
  InputRequest,
  Message,
  Room,
  RoomMembership,
  RoomEvent,
  Task,
  Thread,
  Workspace,
};
