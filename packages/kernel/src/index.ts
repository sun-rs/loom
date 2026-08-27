export {
  AgentExecutionPausedError,
  ConflictError,
  DeliveryProofError,
  ExecutionFencedError,
  ForbiddenError,
  IdempotencyConflictError,
  KernelError,
  LeaseConflictError,
  NotFoundError,
  RuntimeTerminationProofError,
  StaleContextError,
  TaskSubmissionProofError,
  UnauthenticatedError,
} from "./errors.ts";
export { createHumanApplicationPort } from "./human-application-port.ts";
export type { HumanApplicationPort } from "./human-application-port.ts";
export {
  AuthenticatedActorContext,
  AuthenticatedHostContext,
  AuthenticatedWorkerExecutionContext,
} from "./auth.ts";
export { KERNEL_SCHEMA_VERSION, RoomKernel } from "./room-kernel.ts";
export { computeRuntimeCertificationDigest } from "./runtime-certification.ts";
export { manageWorkspaceAgentTransaction } from "./workspace-agent-management.ts";
export type {
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
