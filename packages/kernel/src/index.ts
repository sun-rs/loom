export {
  ActivationCancellationRequestedError,
  AgentExecutionPausedError,
  ConflictError,
  DeliveryProofError,
  ExecutionFencedError,
  ForbiddenError,
  IdempotencyConflictError,
  KernelError,
  LeaseConflictError,
  MessageForwardSourceError,
  NotFoundError,
  RuntimeTerminationProofError,
  StaleContextError,
  TaskSubmissionProofError,
  UnauthenticatedError,
} from "./errors.ts";
export { createHumanApplicationPort } from "./human-application-port.ts";
export type { HumanApplicationPort } from "./human-application-port.ts";
export { createComputerApplicationPort } from "./computer-application-port.ts";
export type { ComputerApplicationPort } from "./computer-application-port.ts";
export {
  AuthenticatedActorContext,
  AuthenticatedHostContext,
  AuthenticatedWorkerExecutionContext,
} from "./auth.ts";
export { KERNEL_SCHEMA_VERSION, RoomKernel } from "./room-kernel.ts";
export type {
  KernelInitializeOptions,
  KernelSchemaChange,
  KernelSchemaState,
} from "./kernel-schema-state.ts";
export { readAllChannelCandidates } from "./all-channel-membership.ts";
export type { AllChannelCandidateSnapshot } from "./all-channel-membership.ts";

export { TaskReviewService } from "./task-review-service.ts";
export { ReminderService } from "./reminder-service.ts";
export type { ReminderReconcileResult } from "./reminder-service.ts";
export type { RoomFileGcReconcileResult } from "./room-file-gc.ts";
export type {
  ProfileImageGcReconcileResult,
  ProfileImageInventoryEntry,
} from "./profile-image-lifecycle.ts";
export type { TaskReviewMutationResult } from "./task-review-service.ts";

export { computeRuntimeCertificationDigest } from "./runtime-certification.ts";
export { ComputerOperationStore } from "./computer-operation-store.ts";
export type {
  ComputerOperationAcknowledgeInput,
  ComputerOperationAction,
  ComputerOperationFailureCode,
  ComputerOperationPhase,
  ComputerOperationRecord,
  ComputerOperationState,
  ComputerOperationStoreOptions,
} from "./computer-operation-store.ts";
export { manageWorkspaceAgentTransaction } from "./workspace-agent-management.ts";
export type {
  InPlaceWorkspaceSharing,
  PlacementCapacityPolicy,
  RoomKernelOptions,
} from "./room-kernel.ts";
export { planNextPlacement } from "./placement-planner.ts";
export type {
  PlacementActivationCandidate,
  PlacementHoldDraft,
  PlacementPlannerInput,
  PlacementPlannerResult,
  PlacementSelection,
} from "./placement-planner.ts";
export type {
  Activation,
  ActivationReason,
  AgentDefinitionContent,
  AgentDefinitionMutationResult,
  AgentDefinitionRecord,
  ExecutionPolicyContent,
  ExecutionPolicyMutationResult,
  ExecutionPolicyRecord,
  InboxItem,
  HostRecord,
  InputRequest,
  InputRequestMutationResult,
  InputRequestResolveMutationResult,
  MessageMutationResult,
  MessagePage,
  Message,
  OutboxEntry,
  PlacementLaunchClaim,
  Principal,
  ProvisionedHostCredential,
  ProvisionedPrincipal,
  Room,
  RoomMutationResult,
  RoomMembership,
  RoomMembershipMutationResult,
  RoomMembershipRemovalResult,
  RoomEvent,
  RoomSnapshot,
  RunAttempt,
  RuntimeProcessRecord,
  SyncResult,
  Task,
  TaskCreateMutationResult,
  TaskMutationResult,
  Thread,
  ThreadMutationResult,
  Workspace,
  WorkspaceAgentManagementInput,
  WorkspaceAgentManagementResult,
  WorkspaceAgentHostBinding,
  WorkspaceAgentProvisionInput,
  WorkspaceAgentProvisionResult,
  WorkspaceMutationResult,
} from "./types.ts";

export type { WorkerProfileMetadataPort } from "./worker-profile-metadata-port.ts";
export {
  deriveWorkerTaskIdempotencyKey,
  deriveWorkerMessageIdempotencyKey,
} from "./worker-message-identity.ts";
export {
  requireResolvedWorkerTaskCausality,
  resolveWorkerTaskCommandCausality,
  workerTaskCommandReadPosition,
  workerTaskReworkRoundSeq,
} from "./worker-task-command-identity.ts";
export type {
  ResolvedWorkerTaskCausality,
  WorkerTaskCommandIdentity,
} from "./worker-task-command-identity.ts";
export { projectWorkerMessageCheck } from "./worker-message-projection.ts";
