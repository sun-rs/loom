import { WorkerTargetContextService } from "./worker-target-context.ts";
import { AttachmentCommentsService } from "./attachment-comments.ts";
import { AgentChannelAttentionService } from "./agent-channel-attention.ts";
import { postWorkerMessageTransaction } from "./worker-message-command.ts";
import { WorkerReadService } from "./worker-read-tools.ts";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { RoomFiles } from "./room-files.ts";
import { RoomDeletionService } from "./room-deletion-service.ts";
import { readAgentPresence } from "./agent-presence.ts";
import { DatabaseSync } from "node:sqlite";
import { GlobalDiscovery } from "./global-discovery.ts";
import { initializeDiscoverySchema } from "./discovery-schema.ts";
import { migrateLegacyTaskSchema } from "./legacy-task-schema.ts";
import {
  expireHeldMessageDraftsAt,
  initializeHeldMessageDrafts,
} from "./held-message-drafts.ts";
import { ActivationObligationService } from "./activation-obligation-service.ts";
import { ReminderService } from "./reminder-service.ts";
import {
  buildTaskSubmissionEvidence,
  deriveTaskSubmissionWorkspaceEvidence,
} from "./task-submission-evidence.ts";
import type { RoomKernelOptions } from "./room-kernel-options.ts";
export type {
  PlacementCapacityPolicy,
  RoomKernelOptions,
} from "./room-kernel-options.ts";
import {
  applyActivationRetryPolicy,
  isActivationRetryBlocked,
  resolveActivationRetryFence,
} from "./activation-retry-fence.ts";
import type {
  ClientMessageForwardRequest,
  ClientMessageForwardResponse,
  ClientMessageForwardTargetsRequest,
  GlobalTasksRequest,
  WorkspaceSearchRequest,
  MessageContextRequest,
} from "@rah-os/protocol";

import {
  ActivationCredentialScopeSchema,
  AgentDefinitionRevisionSchema,
  AgentDefinitionSchema,
  AgentCatalogEntrySchema,
  ClientAgentManageRequestSchema,
  ClientPrincipalUpdateRequestSchema,
  ClientWorkspaceUpdateRequestSchema,
  ExecutionPolicyRevisionSchema,
  InputRequestStatusSchema,
  ParticipantKindSchema,
  PlacementDecisionSchema,
  RoomEventSchema,
  RuntimeRecoveryDescriptorSchema,
  RuntimeOfferSchema,
  RuntimeCertificationSchema,
  RuntimeOfferProjectionSchema,
  type Activation,
  type ActivationCredentialScope,
  type ActivationReason,
  type AgentExclusiveOperationAcquireInput,
  type AgentExclusiveOperationReleaseInput,
  type AgentExclusiveOperationRenewInput,
  type AgentDefinition,
  type AgentDefinitionRevision,
  type AgentCatalogEntry,
  type ExecutionPolicyRevision,
  type InputRequest,
  type InputRequestStatus,
  type WorkerTaskTrajectoryRequest,
  type WorkerTaskTrajectoryResponse,
  type RoomEvent,
  type PlacementDecision,
  type RuntimeRecoveryDescriptor,
  type RuntimeRetryDisposition,
  type RuntimeTrajectoryAppendInput,
  type RuntimeTrajectoryRecord,
  type RuntimeCertification,
  type RuntimeOffer,
  type RuntimeOfferProjection,
  type RoomAgentActivity,
  type Task,
  type TaskSubmissionRepositoryEvidence,
  type TaskVerificationDeclaration,
  type WorkerMessagePostRequest,
} from "@rah-os/protocol";

import {
  ActivationCancellationRequestedError,
  ConflictError,
  DeliveryProofError,
  ExecutionFencedError,
  ForbiddenError,
  IdempotencyConflictError,
  LeaseConflictError,
  NotFoundError,
  RuntimeTerminationProofError,
  StaleContextError,
  UnauthenticatedError,
} from "./errors.ts";
import { eventPayloadText } from "./event-payload.ts";
import {
  type AuthenticatedActorContext,
  type AuthenticatedHostContext,
  type AuthenticatedWorkerExecutionContext,
  createAccessToken,
  createHostAccessToken,
  hashAccessToken,
  isIssuedWorkerExecutionContext,
  issueAuthenticatedActorContext,
  issueAuthenticatedHostContext,
  issueAuthenticatedWorkerExecutionContext,
  requireAuthenticatedActor,
  requireAuthenticatedHost,
  requireAuthenticatedHostCredential,
} from "./auth.ts";
import { authorizedHostParticipantIds } from "./host-authorization.ts";
import {
  backfillAgentMemoryHomes,
  memoryHomeAuthorizedHosts,
  memoryHomeEligibleParticipants,
} from "./agent-memory-home.ts";
import {
  AgentExclusiveOperationService,
  activeAgentExclusiveOperationParticipantIds,
  assertAgentHasNoExclusiveOperation as assertAgentUnfenced,
  nextUnfencedActivation,
  nextUnfencedReservedPlacement,
} from "./agent-exclusive-operation-lease.ts";
import {
  resolveActivationCancellationTransaction,
  resolveRecoveredActivationCancellation,
  unresolvedActivationCancellation,
} from "./activation-cancellation.ts";
import { hostProjectionFromRow } from "./host-projection.ts";
import { canonicalDigest, canonicalValue } from "./canonical-digest.ts";
import { persistContextManifest } from "./context-manifest.ts";
import {
  assertPositiveCapacityLimit,
  capacityLimitMap,
  capacityProfileResourceId,
} from "./capacity-policy.ts";
import {
  requireHumanTaskManager,
  requireExecutionPolicyRevisionControlRoom,
  requireHumanControlRoomManager,
  requireRoomMember,
} from "./collaboration-policy.ts";
import { roomProjectionFromRow } from "./collaboration-projection.ts";
import {
  activationProjectionFromRow,
  inboxProjectionFromRow,
  inputRequestProjectionFromRow,
  outboxProjectionFromRow,
} from "./delivery-projection.ts";
import {
  agentRuntimeContextFromPlacement,
  prepareRunPlacement,
} from "./run-agent-context.ts";
import { classifyRunAttemptRuntimeStart } from "./run-attempt-runtime-transition.ts";
import { runAttemptProjectionFromRow } from "./run-attempt-projection.ts";
import { runtimeProcessProjectionFromRow } from "./runtime-process-projection.ts";
import {
  CollaborationService,
  type DirectRoomOpenInput,
  type MessageRecipient,
  type WorkspaceRoomCreateInput,
  type WorkspaceRoomLifecycleInput,
  type WorkspaceRoomUpdateInput,
} from "./collaboration-service.ts";
import {
  planNextPlacement,
  type PlacementPlannerInput,
} from "./placement-planner.ts";
import {
  migrateCollaborationSchemaV7,
  migrateRoomMetadataV14,
  migrateActivationRetryFencesV35,
  migrateInputRequestCancellationV38,
  migrateReminderTargetsV36,
  migrateTaskWorkflowAuthorityV48,
  migrateTaskWorkflowStatusV44,
  migrateMessageForwardingV46,
  migrateBoundedRoomReadsV49,
  migrateFrozenTaskSubmissionEvidenceV50,
  migrateDropRoomTaskDefaultsV52,
  SCHEMA_SQL,
} from "./schema.ts";
import * as agentThreads from "./agent-thread-subscriptions.ts";
import {
  integer,
  jsonObject,
  nullableInteger,
  nullableText,
  stringArray,
  text,
  type Row,
} from "./sqlite-row.ts";
import {
  RoomEventWriter,
  type AppendRoomEventInput,
} from "./room-event-writer.ts";
import { syncRoomEventWindow } from "./room-sync.ts";
import { listMessageReferenceReadStates as projectMessageReferenceReadStates } from "./message-reference-read-state.ts";
import * as ar from "./room-agent-service.ts";
import {
  RuntimeTrajectoryService,
  type AgentTrajectoryListInput,
} from "./runtime-trajectory.ts";
import {
  runtimeOfferIsAvailable,
  runtimeOfferObservationFromId,
} from "./runtime-offer-tool-access.ts";
import {
  compactUnreferencedRuntimeOfferObservations,
  currentRuntimeOfferFromRow,
  publishRuntimeOffer as publishRuntimeOfferTransaction,
} from "./runtime-offer-publication.ts";
import { computeRuntimeCertificationDigest } from "./runtime-certification.ts";

import {
  MessageForwardDestinationError,
  MessageForwardingService,
} from "./message-forwarding-service.ts";
import { TaskReviewService } from "./task-review-service.ts";
import { unblockTaskTransaction } from "./task-unblock-service.ts";
import { assignTaskTransaction } from "./task-assignment-service.ts";
import { WorkerSelfProfileService } from "./worker-self-profile.ts";
import { WorkerTaskManagementService } from "./worker-task-management.ts";
import { TaskLifecycleService } from "./task-lifecycle-service.ts";
import * as principalProfile from "./principal-profile.ts";
import { ProfileImageLifecycleService } from "./profile-image-lifecycle.ts";
import { createHumanCommandServices } from "./human-command-services.ts";
import {
  requireWorkerTaskDelivery,
  requireWorkerTaskVisibility,
  workerTaskInputResponder,
} from "./worker-task-scope.ts";
import { listWorkerTaskTrajectory } from "./worker-task-trajectory.ts";
import {
  listTaskProjectionPage,
  requireRoomTaskProjection,
  taskDependenciesComplete,
  taskProjectionFromRow,
  type RoomTaskPageRequest,
  type TaskPage,
} from "./task-projection.ts";
import {
  assertTaskEventReplay,
  findRoomEventByIdempotencyKey,
} from "./task-event-replay.ts";
import { assertInputRequestEventReplay } from "./input-request-event-replay.ts";
import {
  createTaskThreadReply,
  migrateTaskAnchorsV9,
  type TaskCreateCommand,
} from "./task-anchor.ts";
import {
  assertWorkerTaskFreshContext,
  claimMessageAsTaskTransaction,
  createWorkerTaskTransaction,
  createTaskMutationTransaction,
  requireOwnedTaskClaim,
} from "./task-intent.ts";
import {
  type TaskUnassignCommand,
  unassignTaskTransaction,
} from "./task-unassignment.ts";
import {
  normalizeAgentDefinitionContent,
  normalizeExecutionPolicyContent,
  provisionWorkspaceAgentTransaction,
} from "./workspace-agent-provisioning.ts";
import {
  getWorkspaceAgentManagementView,
  manageWorkspaceAgentTransaction,
  requireAgentExecutionEnabled,
} from "./workspace-agent-management.ts";
import type {
  InboxItem,
  AgentDefinitionContent,
  AgentDefinitionMutationResult,
  ExecutionPolicyContent,
  ExecutionPolicyMutationResult,
  ExecutionPolicyRecord,
  HostRecord,
  InputRequestMutationResult,
  InputRequestResolveMutationResult,
  MessageMutationResult,
  MessagePage,
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
  RoomSnapshot,
  RunAttempt,
  RuntimeProcessRecord,
  SyncResult,
  TaskCreateMutationResult,
  TaskMutationResult,
  Thread,
  ThreadMutationResult,
  Workspace,
  WorkspaceAgentManagementInput,
  WorkspaceAgentManagementResult,
  WorkspaceAgentProvisionInput,
  WorkspaceAgentProvisionResult,
  WorkspaceMutationResult,
} from "./types.ts";
import { listWorkspaceMemberGraph as projectWorkspaceMemberGraph } from "./workspace-member-graph.ts";
import { inImmediateTransaction } from "./sqlite-transaction.ts";
import {
  assertMessageReferenceDirectoryIsUnambiguous,
  principalHandleIsAvailable,
} from "./message-reference-identity.ts";
const SYSTEM_PRINCIPAL_ID = "principal_system";
const DEFAULT_RUNTIME_OFFER_CLOCK_SKEW_MS = 5_000;
const DEFAULT_RUNTIME_OFFER_MAX_TTL_MS = 5 * 60_000;
export const KERNEL_SCHEMA_VERSION = 53;
export class RoomKernel {
  readonly databasePath: string;
  readonly #database: DatabaseSync;
  readonly #agentExclusiveOperations: AgentExclusiveOperationService;
  readonly #now: () => Date;
  readonly #createId: (prefix: string) => string;
  readonly #runtimeCertifications: Map<string, RuntimeCertification>;
  readonly #runtimeOfferClockSkewMs: number;
  readonly #runtimeOfferMaxTtlMs: number;
  readonly #defaultPlacementMaxConcurrent: number;
  readonly #hostPlacementLimits: Map<string, number>;
  readonly #poolPlacementLimits: Map<string, number>;
  readonly #runtimeProfilePlacementLimits: Map<string, number>;
  readonly #activationObligations: ActivationObligationService;
  readonly #roomEvents: RoomEventWriter;
  readonly #collaboration: CollaborationService;
  readonly #messageForwarding: MessageForwardingService;
  readonly #roomDeletion: RoomDeletionService;

  readonly attachmentComments: AttachmentCommentsService;
  readonly workerTargetContext: WorkerTargetContextService;
  readonly workerReads: WorkerReadService;
  readonly taskDeletions: import("./task-deletion.ts").TaskDeletionService;
  readonly taskAmendments: import("./task-amendment.ts").TaskAmendmentService;
  readonly humanTaskHistory: import("./human-task-history.ts").HumanTaskHistory;
  readonly workerChannelAttention: AgentChannelAttentionService;
  readonly workerTaskManagement: WorkerTaskManagementService;
  readonly workerSelfProfile: WorkerSelfProfileService;
  readonly files: RoomFiles;
  readonly profileImages: ProfileImageLifecycleService;
  readonly followHumanThread;
  readonly getHumanThreadFollowers;
  readonly messageSocial;
  readonly listHumanActivity;
  readonly markHumanActivity;
  readonly removeHumanThreadAgentFollower;
  readonly restoreHumanThreadAgentFollower;
  readonly humanSidebar;
  readonly humanNavigation;
  readonly humanProfiles;
  readonly publicChannels;
  readonly humanNotifications;
  readonly reminders: ReminderService;
  readonly roomAgentSos;
  readonly #taskReviews: TaskReviewService;
  readonly #taskLifecycle: TaskLifecycleService;
  readonly taskReassignment;
  readonly #runtimeTrajectory: RuntimeTrajectoryService;
  constructor(options: RoomKernelOptions) {
    this.databasePath = options.databasePath;
    this.#now = options.now ?? (() => new Date());
    this.#createId =
      options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
    const placementCapacityPolicy = options.placementCapacityPolicy ?? {};
    this.#defaultPlacementMaxConcurrent =
      placementCapacityPolicy.defaultMaxConcurrent ?? 1;
    assertPositiveCapacityLimit(
      this.#defaultPlacementMaxConcurrent,
      "placementCapacityPolicy.defaultMaxConcurrent",
    );
    this.#hostPlacementLimits = capacityLimitMap(
      placementCapacityPolicy.hostLimits ?? [],
      ({ hostId }) => hostId,
      "Host",
    );
    this.#poolPlacementLimits = capacityLimitMap(
      placementCapacityPolicy.poolLimits ?? [],
      ({ capacityPoolId }) => capacityPoolId,
      "capacity pool",
    );
    this.#runtimeProfilePlacementLimits = capacityLimitMap(
      placementCapacityPolicy.runtimeProfileLimits ?? [],
      ({ hostId, runtimeProfileId }) =>
        capacityProfileResourceId(hostId, runtimeProfileId),
      "runtime profile",
    );
    this.#runtimeCertifications = new Map();
    for (const untrustedCertification of options.runtimeCertifications ?? []) {
      const parsedCertification = RuntimeCertificationSchema.parse(
        untrustedCertification,
      );
      const certification: RuntimeCertification = {
        ...parsedCertification,
        capabilities: [...parsedCertification.capabilities].sort(),
      };
      if (
        certification.certificationDigest !==
        computeRuntimeCertificationDigest(certification)
      ) {
        throw new Error(
          `RuntimeCertification ${certification.certificationId} digest does not match its canonical content`,
        );
      }
      const existing = this.#runtimeCertifications.get(
        certification.certificationId,
      );
      if (
        existing !== undefined &&
        JSON.stringify(canonicalValue(existing)) !==
          JSON.stringify(canonicalValue(certification))
      ) {
        throw new Error(
          `duplicate RuntimeCertification ${certification.certificationId}`,
        );
      }
      this.#runtimeCertifications.set(
        certification.certificationId,
        certification,
      );
    }
    this.#runtimeOfferClockSkewMs =
      options.runtimeOfferClockSkewMs ?? DEFAULT_RUNTIME_OFFER_CLOCK_SKEW_MS;
    this.#runtimeOfferMaxTtlMs =
      options.runtimeOfferMaxTtlMs ?? DEFAULT_RUNTIME_OFFER_MAX_TTL_MS;
    if (
      !Number.isSafeInteger(this.#runtimeOfferClockSkewMs) ||
      this.#runtimeOfferClockSkewMs < 0
    ) {
      throw new Error("runtimeOfferClockSkewMs must be a non-negative integer");
    }
    if (
      !Number.isSafeInteger(this.#runtimeOfferMaxTtlMs) ||
      this.#runtimeOfferMaxTtlMs <= 0
    ) {
      throw new Error("runtimeOfferMaxTtlMs must be a positive integer");
    }
    this.#database = new DatabaseSync(options.databasePath, { timeout: 5_000 });
    this.workerTargetContext = new WorkerTargetContextService({
      database: this.#database,
      now: this.#now,
      requireWorker: (worker) =>
        this.#requireAuthenticatedWorkerExecution(worker),
      transaction: (operation) => this.#transaction(operation),
      eventFromRow: (row) => this.#eventFromRow(row),
      snapshot: (roomId) => this.#snapshot(roomId),
      collaboration: () => this.#collaboration,
      attachmentComments: () => this.attachmentComments,
      files: () => this.files,
    });
    this.workerReads = new WorkerReadService({
      database: this.#database,
      now: this.#now,
      requireWorker: (worker) =>
        this.#requireAuthenticatedWorkerExecution(worker),
      transaction: (operation) => this.#transaction(operation),
    });
    this.#agentExclusiveOperations = new AgentExclusiveOperationService({
      createId: this.#createId,
      database: this.#database,
      now: this.#now,
      requireHost: (host) => this.#requireAuthenticatedHost(host),
      requireHostParticipant: (host, participantId) =>
        this.#requireHostParticipant(host, participantId),
      transaction: (operation) => this.#transaction(operation),
    });
    this.#activationObligations = new ActivationObligationService({
      createId: this.#createId,
      database: this.#database,
    });
    this.#roomEvents = new RoomEventWriter({
      createId: this.#createId,
      database: this.#database,
      now: this.#now,
      obligations: this.#activationObligations,
    });
    this.workerChannelAttention = new AgentChannelAttentionService({
      targetContext: () => this.workerTargetContext,
      database: this.#database,
      events: this.#roomEvents,
      requireWorker: (execution) =>
        this.#requireAuthenticatedWorkerExecution(execution),
      transaction: (operation) => this.#transaction(operation),
    });
    this.workerTaskManagement = new WorkerTaskManagementService({
      database: this.#database,
      events: this.#roomEvents,
      createId: this.#createId,
      now: this.#now,
      requireWorker: (execution) =>
        this.#requireAuthenticatedWorkerExecution(execution),
      transaction: (operation) => this.#transaction(operation),
    });

    this.reminders = new ReminderService({
      createId: this.#createId,
      database: this.#database,
      events: this.#roomEvents,
      defaultTimezone: options.reminderDefaultTimezone,
      fireDeliveryHook: options.reminderFireDeliveryHook,
      now: this.#now,
      requireActor: (actor) => this.#requireAuthenticatedActor(actor),
      requireWorker: (worker) =>
        this.#requireAuthenticatedWorkerExecution(worker),
      transaction: (operation) => this.#transaction(operation),
    });
    const humanCommands = createHumanCommandServices({
      assertFreshContext: (roomId, actorId, seq) =>
        this.#assertFreshContext(roomId, actorId, seq),
      requireWorker: (worker) =>
        this.#requireAuthenticatedWorkerExecution(worker),
      createId: this.#createId,
      database: this.#database,
      events: this.#roomEvents,
      now: this.#now,
      requireActor: (actor) => this.#requireAuthenticatedActor(actor),
      transaction: (operation) => this.#transaction(operation),
    });
    this.humanSidebar = humanCommands.humanSidebar;
    this.humanNavigation = humanCommands.humanNavigation;
    this.humanProfiles = humanCommands.humanProfiles;
    this.humanTaskHistory = humanCommands.humanTaskHistory;
    this.taskAmendments = humanCommands.taskAmendments;
    this.taskDeletions = humanCommands.taskDeletions;
    this.publicChannels = humanCommands.publicChannels;
    this.humanNotifications = humanCommands.humanNotifications;
    this.followHumanThread = humanCommands.followHumanThread;
    this.getHumanThreadFollowers = humanCommands.getHumanThreadFollowers;
    this.listHumanActivity = humanCommands.listHumanActivity;
    this.markHumanActivity = humanCommands.markHumanActivity;
    this.messageSocial = humanCommands.messageSocial;
    this.removeHumanThreadAgentFollower =
      humanCommands.removeHumanThreadAgentFollower;
    this.restoreHumanThreadAgentFollower =
      humanCommands.restoreHumanThreadAgentFollower;
    this.roomAgentSos = humanCommands.roomAgentSos;
    this.taskReassignment = humanCommands.taskReassignment;
    this.files = new RoomFiles({
      database: this.#database,
      directory: join(dirname(options.databasePath), "room-files"),
      verifyTargetContext: (execution, input) =>
        this.workerTargetContext.verifyPresented(execution, input),
      requireActor: (actor) => this.#requireAuthenticatedActor(actor),
      requireWorker: (worker) =>
        this.#requireAuthenticatedWorkerExecution(worker),
      now: this.#now,
    });
    this.profileImages = new ProfileImageLifecycleService({
      createId: this.#createId,
      database: this.#database,
      now: this.#now,
      requireActor: (actor) => this.#requireAuthenticatedActor(actor),
    });
    this.workerSelfProfile = new WorkerSelfProfileService({
      database: this.#database,
      createId: this.#createId,
      now: this.#now,
      events: this.#roomEvents,
      profileImages: this.profileImages,
      requireWorker: (execution) =>
        this.#requireAuthenticatedWorkerExecution(execution),
      transaction: (operation) => this.#transaction(operation),
    });

    this.#roomDeletion = new RoomDeletionService({
      createId: this.#createId,
      database: this.#database,
      files: this.files,
      now: this.#now,
      requireActor: (actor) => this.#requireAuthenticatedActor(actor),
      transaction: (operation) => this.#transaction(operation),
    });
    this.#collaboration = new CollaborationService({
      createId: this.#createId,
      database: this.#database,
      events: this.#roomEvents,
      now: this.#now,
    });
    this.attachmentComments = new AttachmentCommentsService({
      database: this.#database,
      transaction: (fn) => this.#transaction(fn),
      requireActor: (actor) => this.getAuthenticatedPrincipal(actor),
      requireWorker: (worker) =>
        this.#requireAuthenticatedWorkerExecution(worker),
      collaboration: this.#collaboration,
      events: this.#roomEvents,
    });
    this.#messageForwarding = new MessageForwardingService({
      createId: this.#createId,
      database: this.#database,
      events: this.#roomEvents,
      files: this.files,
      now: this.#now,
    });
    this.#taskReviews = new TaskReviewService({
      createId: this.#createId,
      database: this.#database,
      events: this.#roomEvents,
      now: this.#now,
      requireActor: (actor) => this.#requireAuthenticatedActor(actor),
      requireWorker: (worker) =>
        this.#requireAuthenticatedWorkerExecution(worker),
    });
    this.#taskLifecycle = new TaskLifecycleService({
      createId: this.#createId,
      database: this.#database,
      events: this.#roomEvents,
      now: this.#now,
      requireActor: (actor) => this.#requireAuthenticatedActor(actor),
      transaction: (operation) => this.#transaction(operation),
    });
    this.#runtimeTrajectory = new RuntimeTrajectoryService({
      createId: this.#createId,
      database: this.#database,
      now: this.#now,
      requireActor: (actor) => this.#requireAuthenticatedActor(actor),
      requireHost: (host) => this.#requireAuthenticatedHost(host),
      requireHostParticipant: (host, participantId) =>
        this.#requireHostParticipant(host, participantId),
      requireRunAttemptHostGeneration: (runAttempt, host) =>
        this.#requireRunAttemptHostGeneration(runAttempt, host),
    });
  }

  get taskReviews(): TaskReviewService {
    return this.#taskReviews;
  }

  initialize(): void {
    const schemaVersionRow = this.#database
      .prepare("PRAGMA user_version")
      .get();
    const schemaVersion = schemaVersionRow
      ? integer(schemaVersionRow, "user_version")
      : 0;
    if (schemaVersion > KERNEL_SCHEMA_VERSION) {
      throw new Error(
        `database uses newer Kernel schema ${schemaVersion}; this build supports ${KERNEL_SCHEMA_VERSION}`,
      );
    }
    migrateLegacyTaskSchema(this.#database);
    this.#database.exec(SCHEMA_SQL);
    initializeHeldMessageDrafts(this.#database, this.#now());
    migrateCollaborationSchemaV7(this.#database, this.#timestamp());
    migrateTaskAnchorsV9(this.#database, this.#createId, this.#roomEvents);
    migrateRoomMetadataV14(this.#database);
    migrateActivationRetryFencesV35(this.#database);
    migrateReminderTargetsV36(this.#database);
    migrateInputRequestCancellationV38(this.#database);
    migrateTaskWorkflowStatusV44(this.#database);
    migrateMessageForwardingV46(this.#database);
    migrateTaskWorkflowAuthorityV48(this.#database);
    migrateBoundedRoomReadsV49(this.#database);
    migrateFrozenTaskSubmissionEvidenceV50(this.#database);
    migrateDropRoomTaskDefaultsV52(this.#database);
    principalProfile.migrate(this.#database);
    this.#database
      .prepare(
        "INSERT OR IGNORE INTO principals(principal_id, handle, kind, created_at) VALUES(?, ?, 'service', ?)",
      )
      .run(SYSTEM_PRINCIPAL_ID, "rah-system", this.#timestamp());
    assertMessageReferenceDirectoryIsUnambiguous(this.#database);
    if (
      !this.#database
        .prepare("PRAGMA table_info(workspaces)")
        .all()
        .some((column) => column.name === "avatar_key")
    ) {
      this.#database.exec("ALTER TABLE workspaces ADD COLUMN avatar_key TEXT");
    }
    this.files.initialize();
    this.attachmentComments.initialize();
    initializeDiscoverySchema(this.#database);
    this.humanNotifications.initialize();
    this.#taskReviews.backfillLegacySubmissions();
    this.#activationObligations.backfillActive();
    agentThreads.backfillAgentThreadFollows(this.#database, this.#timestamp());
    this.#database.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_one_control_room_per_workspace ON rooms(workspace_id) WHERE kind = 'control'",
    );
    const hostColumns = this.#database
      .prepare("PRAGMA table_info(agent_hosts)")
      .all();
    if (!hostColumns.some((row) => text(row, "name") === "credential_id")) {
      this.#database.exec(
        "ALTER TABLE agent_hosts ADD COLUMN credential_id TEXT",
      );
      const now = this.#now();
      this.#database
        .prepare(
          "UPDATE agent_hosts SET state = 'offline', last_seen_at = ?, last_seen_ms = ?",
        )
        .run(now.toISOString(), now.getTime());
    }
    if (!hostColumns.some((row) => text(row, "name") === "instance_id")) {
      this.#database.exec(
        "ALTER TABLE agent_hosts ADD COLUMN instance_id TEXT",
      );
      const now = this.#now();
      this.#database
        .prepare(
          "UPDATE agent_hosts SET instance_id = 'legacy:' || host_id, state = 'offline', last_seen_at = ?, last_seen_ms = ?",
        )
        .run(now.toISOString(), now.getTime());
    }
    if (!hostColumns.some((row) => text(row, "name") === "build_version")) {
      this.#database.exec(
        "ALTER TABLE agent_hosts ADD COLUMN build_version TEXT",
      );
    }
    if (!hostColumns.some((row) => text(row, "name") === "protocol_version")) {
      this.#database.exec(
        "ALTER TABLE agent_hosts ADD COLUMN protocol_version INTEGER",
      );
    }
    if (!hostColumns.some((row) => text(row, "name") === "process_id")) {
      this.#database.exec(
        "ALTER TABLE agent_hosts ADD COLUMN process_id INTEGER",
      );
    }
    const runtimeOfferColumns = this.#database
      .prepare("PRAGMA table_info(runtime_offers)")
      .all();
    if (
      !runtimeOfferColumns.some(
        (row) => text(row, "name") === "current_observation_id",
      )
    ) {
      this.#database.exec(
        "ALTER TABLE runtime_offers ADD COLUMN current_observation_id TEXT",
      );
    }
    if (
      !runtimeOfferColumns.some(
        (row) => text(row, "name") === "current_snapshot_digest",
      )
    ) {
      this.#database.exec(
        "ALTER TABLE runtime_offers ADD COLUMN current_snapshot_digest TEXT",
      );
    }
    if (
      !runtimeOfferColumns.some((row) => text(row, "name") === "accepted_at")
    ) {
      this.#database.exec(
        "ALTER TABLE runtime_offers ADD COLUMN accepted_at TEXT",
      );
    }
    this.#database
      .prepare(
        "UPDATE runtime_offers SET state = 'unavailable', lease_until_ms = 0 WHERE current_observation_id IS NULL",
      )
      .run();
    const runAttemptColumns = this.#database
      .prepare("PRAGMA table_info(run_attempts)")
      .all();
    if (
      !runAttemptColumns.some((row) => text(row, "name") === "placement_id")
    ) {
      this.#database.exec(
        "ALTER TABLE run_attempts ADD COLUMN placement_id TEXT REFERENCES placements(placement_id)",
      );
    }
    const runAttemptPlacementForeignKey = this.#database
      .prepare("PRAGMA foreign_key_list(run_attempts)")
      .all()
      .some(
        (row) =>
          text(row, "from") === "placement_id" &&
          text(row, "table") === "placements",
      );
    if (!runAttemptPlacementForeignKey) {
      this.#database.exec("PRAGMA foreign_keys = OFF");
      try {
        this.#database.exec(`
          BEGIN IMMEDIATE;
          CREATE TABLE run_attempts_with_placement_fk (
            run_attempt_id TEXT PRIMARY KEY,
            placement_id TEXT REFERENCES placements(placement_id),
            activation_id TEXT NOT NULL REFERENCES activations(activation_id),
            room_id TEXT NOT NULL REFERENCES rooms(room_id),
            participant_id TEXT NOT NULL REFERENCES principals(principal_id),
            host_id TEXT NOT NULL,
            attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
            state TEXT NOT NULL CHECK (state IN ('starting', 'running', 'orphaned', 'exited', 'failed', 'cancelled', 'timed_out')),
            runtime_run_id TEXT,
            exit_code INTEGER,
            exit_signal TEXT,
            error TEXT,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            UNIQUE (activation_id, attempt_number)
          ) STRICT;
          INSERT INTO run_attempts_with_placement_fk(
            run_attempt_id, placement_id, activation_id, room_id, participant_id,
            host_id, attempt_number, state, runtime_run_id, exit_code,
            exit_signal, error, started_at, finished_at
          )
          SELECT
            run_attempt_id, placement_id, activation_id, room_id, participant_id,
            host_id, attempt_number, state, runtime_run_id, exit_code,
            exit_signal, error, started_at, finished_at
          FROM run_attempts;
          DROP TABLE run_attempts;
          ALTER TABLE run_attempts_with_placement_fk RENAME TO run_attempts;
          CREATE INDEX idx_run_attempts_room_started
            ON run_attempts(room_id, started_at, run_attempt_id);
          COMMIT;
        `);
      } catch (error) {
        if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
        throw error;
      } finally {
        this.#database.exec("PRAGMA foreign_keys = ON");
      }
    }
    const placementColumns = this.#database
      .prepare("PRAGMA table_info(placements)")
      .all();
    if (
      !placementColumns.some(
        (row) => text(row, "name") === "runtime_offer_observation_id",
      )
    ) {
      this.#database.exec(
        "ALTER TABLE placements ADD COLUMN runtime_offer_observation_id TEXT REFERENCES runtime_offer_observations(runtime_offer_observation_id)",
      );
    }
    const runtimeProcessColumns = this.#database
      .prepare("PRAGMA table_info(runtime_processes)")
      .all();
    if (
      !runtimeProcessColumns.some(
        (row) => text(row, "name") === "recovery_lease_owner_instance_id",
      )
    ) {
      this.#database.exec(
        "ALTER TABLE runtime_processes ADD COLUMN recovery_lease_owner_instance_id TEXT",
      );
    }
    if (
      !placementColumns.some(
        (row) => text(row, "name") === "runtime_offer_snapshot_digest",
      )
    ) {
      this.#database.exec(
        "ALTER TABLE placements ADD COLUMN runtime_offer_snapshot_digest TEXT",
      );
    }
    const compactedRuntimeOfferObservationCount =
      compactUnreferencedRuntimeOfferObservations(
        this.#database,
        schemaVersion,
      );
    this.#database.exec(`PRAGMA user_version = ${KERNEL_SCHEMA_VERSION}`);
    this.#transaction(() => {
      backfillAgentMemoryHomes(this.#database);
      const participantIds = this.#database
        .prepare(
          "SELECT DISTINCT participant_id FROM runtime_processes ORDER BY participant_id",
        )
        .all()
        .map((row) => text(row, "participant_id"));
      const now = this.#now();
      this.#reconcileUnownedRuntimeProcesses(participantIds, now);
      this.#quarantineExpiredActiveRuns(participantIds, now);
      this.#reconcileProvenActivationQuarantines(participantIds);
    });
    if (compactedRuntimeOfferObservationCount > 0) {
      this.#database.exec("VACUUM");
    }
  }

  close(): void {
    this.#database.close();
  }

  updateTaskWorkflowStatus(
    actor: AuthenticatedActorContext,
    input: Parameters<TaskLifecycleService["updateTaskWorkflowStatus"]>[1],
  ): TaskCreateMutationResult {
    return this.#taskLifecycle.updateTaskWorkflowStatus(actor, input, () =>
      this.completeTask(actor, {
        basedOnRoomSeq: input.basedOnRoomSeq,
        idempotencyKey: input.idempotencyKey,
        taskId: input.taskId,
      }),
    );
  }

  provisionPrincipal(input: {
    handle: string;
    kind: "human" | "agent" | "service";
  }): ProvisionedPrincipal {
    const handle = input.handle.trim();
    if (handle.length === 0) throw new Error("handle is required");
    if (!principalHandleIsAvailable(this.#database, handle)) {
      throw new ConflictError(`principal handle ${handle} is already in use`);
    }
    const kind = ParticipantKindSchema.parse(input.kind);
    const principal: Principal = {
      principalId: this.#createId("principal"),
      handle,
      kind,
    };
    const accessToken = createAccessToken();
    this.#transaction(() => {
      const createdAt = this.#timestamp();
      this.#database
        .prepare(
          "INSERT INTO principals(principal_id, handle, kind, created_at) VALUES(?, ?, ?, ?)",
        )
        .run(
          principal.principalId,
          principal.handle,
          principal.kind,
          createdAt,
        );
      this.#database
        .prepare(
          "INSERT INTO principal_credentials(credential_id, principal_id, token_hash, created_at) VALUES(?, ?, ?, ?)",
        )
        .run(
          this.#createId("credential"),
          principal.principalId,
          hashAccessToken(accessToken),
          createdAt,
        );
    });
    return { accessToken, principal };
  }

  authenticateAccessToken(accessToken: string): AuthenticatedActorContext {
    if (accessToken.trim().length === 0) {
      throw new UnauthenticatedError("authentication failed");
    }
    const row = this.#database
      .prepare(
        "SELECT credential_id, principal_id FROM principal_credentials WHERE token_hash = ? AND revoked_at IS NULL",
      )
      .get(hashAccessToken(accessToken));
    if (!row) throw new UnauthenticatedError("authentication failed");
    return issueAuthenticatedActorContext(
      text(row, "principal_id"),
      text(row, "credential_id"),
    );
  }

  authenticateHumanAccessToken(accessToken: string): AuthenticatedActorContext {
    const actor = this.authenticateAccessToken(accessToken);
    const principal = principalProfile.fromRow(
      this.#requirePrincipal(actor.principalId),
    );
    if (principal.kind !== "human") {
      throw new UnauthenticatedError("human client authentication failed");
    }
    return actor;
  }

  getAuthenticatedPrincipal(actor: AuthenticatedActorContext): Principal {
    return principalProfile.fromRow(
      this.#requirePrincipal(this.#requireAuthenticatedActor(actor)),
    );
  }

  updateAuthenticatedPrincipal(
    actor: AuthenticatedActorContext,
    rawInput: import("@rah-os/protocol").ClientPrincipalUpdateRequest,
  ): Principal {
    const input = ClientPrincipalUpdateRequestSchema.parse(rawInput);
    return this.#transaction(() => {
      const principal = this.getAuthenticatedPrincipal(actor);
      this.profileImages.bindReference(
        principal.principalId,
        input.avatarKey,
        input.avatarUploadIntentId,
      );
      const updated = principalProfile.update(this.#database, principal, input);
      this.profileImages.releaseReference(
        principal.avatarKey,
        updated.avatarKey,
      );
      return updated;
    });
  }

  provisionHostCredential(input: {
    hostId: string;
    participantIds: string[];
  }): ProvisionedHostCredential {
    const hostId = input.hostId.trim();
    if (hostId.length === 0) throw new Error("hostId is required");
    const participantIds = [...new Set(input.participantIds)].sort();
    if (participantIds.length === 0) {
      throw new Error("Host credential requires at least one participant");
    }
    const accessToken = createHostAccessToken();
    const credentialId = this.#createId("host_credential");
    this.#transaction(() => {
      for (const participantId of participantIds) {
        const principal = principalProfile.fromRow(
          this.#requirePrincipal(participantId),
        );
        if (principal.kind !== "agent") {
          throw new Error(
            `host participant ${participantId} must be an Agent principal`,
          );
        }
      }
      this.#database
        .prepare(
          "INSERT INTO agent_host_credentials(credential_id, host_id, token_hash, participant_ids_json, created_at) VALUES(?, ?, ?, ?, ?)",
        )
        .run(
          credentialId,
          hostId,
          hashAccessToken(accessToken),
          JSON.stringify(participantIds),
          this.#timestamp(),
        );
    });
    return { accessToken, credentialId, hostId, participantIds };
  }
  authenticateHostAccessToken(accessToken: string): AuthenticatedHostContext {
    if (accessToken.trim().length === 0) {
      throw new UnauthenticatedError("host authentication failed");
    }
    const row = this.#database
      .prepare(
        "SELECT credential_id, host_id, participant_ids_json FROM agent_host_credentials WHERE token_hash = ? AND revoked_at IS NULL",
      )
      .get(hashAccessToken(accessToken));
    if (!row) throw new UnauthenticatedError("host authentication failed");
    return issueAuthenticatedHostContext(
      text(row, "host_id"),
      stringArray(row, "participant_ids_json"),
      text(row, "credential_id"),
      this.#createId("host_instance"),
    );
  }
  revokeHostCredential(credentialId: string): void {
    const normalizedCredentialId = credentialId.trim();
    if (normalizedCredentialId.length === 0) {
      throw new Error("credentialId is required");
    }
    this.#transaction(() => {
      const existing = this.#database
        .prepare(
          "SELECT host_id FROM agent_host_credentials WHERE credential_id = ?",
        )
        .get(normalizedCredentialId);
      if (!existing) {
        throw new NotFoundError(
          `Host credential ${normalizedCredentialId} was not found`,
        );
      }
      this.#database
        .prepare(
          "UPDATE agent_host_credentials SET revoked_at = COALESCE(revoked_at, ?) WHERE credential_id = ?",
        )
        .run(this.#timestamp(), normalizedCredentialId);
      const now = this.#now();
      this.#database
        .prepare(
          "UPDATE agent_hosts SET state = 'offline', last_seen_at = ?, last_seen_ms = ? WHERE host_id = ? AND credential_id = ?",
        )
        .run(
          now.toISOString(),
          now.getTime(),
          text(existing, "host_id"),
          normalizedCredentialId,
        );
    });
  }
  createRoom(
    actor: AuthenticatedActorContext,
    input: { name: string; slug: string },
  ): Room {
    return this.#transaction(() =>
      this.#collaboration.createRoom(
        this.getAuthenticatedPrincipal(actor),
        input,
      ),
    );
  }
  createWorkspace(
    actor: AuthenticatedActorContext,
    input: { idempotencyKey: string; name: string; slug: string },
  ): WorkspaceMutationResult {
    return this.#transaction(() =>
      this.#collaboration.createWorkspace(
        this.getAuthenticatedPrincipal(actor),
        input,
      ),
    );
  }
  updateWorkspace(
    actor: AuthenticatedActorContext,
    rawInput: import("@rah-os/protocol").ClientWorkspaceUpdateRequest,
  ): WorkspaceMutationResult {
    const input = ClientWorkspaceUpdateRequestSchema.parse(rawInput);
    return this.#transaction(() => {
      const principal = this.getAuthenticatedPrincipal(actor);
      const previous = this.#database
        .prepare("SELECT avatar_key FROM workspaces WHERE workspace_id=?")
        .get(input.workspaceId);
      const previousAvatarKey =
        previous === undefined ? null : nullableText(previous, "avatar_key");
      this.profileImages.bindReference(
        principal.principalId,
        input.avatarKey,
        input.avatarUploadIntentId,
      );
      const result = this.#collaboration.updateWorkspace(principal, input);
      this.profileImages.releaseReference(
        previousAvatarKey,
        result.workspace.avatarKey,
      );
      return result;
    });
  }
  createWorkspaceRoom(
    actor: AuthenticatedActorContext,
    input: WorkspaceRoomCreateInput,
  ): RoomMutationResult {
    return this.#transaction(() =>
      this.#collaboration.createWorkspaceRoom(
        this.getAuthenticatedPrincipal(actor),
        input,
      ),
    );
  }
  updateWorkspaceRoom(
    actor: AuthenticatedActorContext,
    input: WorkspaceRoomUpdateInput,
  ): RoomMutationResult {
    return this.#transaction(() =>
      this.#collaboration.updateWorkspaceRoom(
        this.getAuthenticatedPrincipal(actor),
        input,
      ),
    );
  }
  archiveWorkspaceRoom(
    actor: AuthenticatedActorContext,
    input: WorkspaceRoomLifecycleInput,
  ): RoomMutationResult {
    return this.#transaction(() =>
      this.#collaboration.archiveWorkspaceRoom(
        this.getAuthenticatedPrincipal(actor),
        input,
      ),
    );
  }
  deleteWorkspaceRoom(...args: Parameters<RoomDeletionService["delete"]>) {
    return this.#roomDeletion.delete(...args);
  }
  unarchiveWorkspaceRoom(
    actor: AuthenticatedActorContext,
    input: WorkspaceRoomLifecycleInput,
  ): RoomMutationResult {
    return this.#transaction(() =>
      this.#collaboration.unarchiveWorkspaceRoom(
        this.getAuthenticatedPrincipal(actor),
        input,
      ),
    );
  }
  openDirectRoom(
    actor: AuthenticatedActorContext,
    input: DirectRoomOpenInput,
  ): Room {
    return this.#transaction(() =>
      this.#collaboration.openDirectRoom(
        this.getAuthenticatedPrincipal(actor),
        input,
      ),
    );
  }
  addMember(
    actor: AuthenticatedActorContext,
    input: { principalId: string; roomId: string },
  ): void {
    this.#transaction(() => {
      const actorId = this.#requireAuthenticatedActor(actor);
      this.#collaboration.addMember(actorId, input);
    });
  }
  listWorkspaces(actor: AuthenticatedActorContext): Workspace[] {
    return this.#collaboration.listWorkspaces(
      this.#requireAuthenticatedActor(actor),
    );
  }
  listWorkspaceMemberGraph(
    actor: AuthenticatedActorContext,
    input: { workspaceId: string },
  ) {
    const principal = this.getAuthenticatedPrincipal(actor);
    return projectWorkspaceMemberGraph(this.#database, principal, input);
  }
  listRooms(
    actor: AuthenticatedActorContext,
    input: { workspaceId?: string } = {},
  ): Room[] {
    return this.#collaboration.listRooms(
      this.#requireAuthenticatedActor(actor),
      input,
    );
  }
  listRoomAgentActivity(
    actor: AuthenticatedActorContext,
    input: { roomId: string },
  ): RoomAgentActivity[] {
    return ar.listRoomAgentActivity(
      this.#database,
      this.#requireAuthenticatedActor(actor),
      input.roomId,
    );
  }
  listWorkspaceAgentRooms(
    actor: AuthenticatedActorContext,
    input: { agentDefinitionId: string },
  ): Room[] {
    return ar.listWorkspaceAgentRooms(
      this.#database,
      this.#requireAuthenticatedActor(actor),
      input.agentDefinitionId,
    );
  }
  listAgentActivity(
    actor: AuthenticatedActorContext,
    input: ar.AgentActivityListInput,
  ) {
    const actorId = this.#requireAuthenticatedActor(actor);
    return ar.listAgentActivity(this.#database, actorId, input);
  }
  listAgentTrajectory(
    actor: AuthenticatedActorContext,
    input: AgentTrajectoryListInput,
  ) {
    return this.#runtimeTrajectory.list(actor, input);
  }
  listRoomMemberships(
    actor: AuthenticatedActorContext,
    input: { roomId: string },
  ): RoomMembership[] {
    return this.#collaboration.listRoomMemberships(
      this.#requireAuthenticatedActor(actor),
      input.roomId,
    );
  }
  addRoomMember(
    actor: AuthenticatedActorContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      principalId: string;
      role: RoomMembership["role"];
      roomId: string;
    },
  ): RoomMembershipMutationResult {
    return this.#transaction(() => {
      return this.#collaboration.addRoomMember(
        this.getAuthenticatedPrincipal(actor),
        input,
      );
    });
  }
  setRoomMemberRole(
    actor: AuthenticatedActorContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      principalId: string;
      role: RoomMembership["role"];
      roomId: string;
    },
  ): RoomMembershipMutationResult {
    return this.#transaction(() => {
      return this.#collaboration.setRoomMemberRole(
        this.getAuthenticatedPrincipal(actor),
        input,
      );
    });
  }
  removeRoomMember(
    actor: AuthenticatedActorContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      principalId: string;
      roomId: string;
    },
  ): RoomMembershipRemovalResult {
    return this.#transaction(() => {
      return this.#collaboration.removeRoomMember(
        this.getAuthenticatedPrincipal(actor),
        input,
      );
    });
  }
  leaveRoom(
    actor: AuthenticatedActorContext,
    input: WorkspaceRoomLifecycleInput,
  ): RoomMembershipRemovalResult {
    return this.#transaction(() =>
      this.#collaboration.leaveRoom(
        this.getAuthenticatedPrincipal(actor),
        input,
      ),
    );
  }
  listThreads(
    actor: AuthenticatedActorContext,
    input: { roomId: string },
  ): Thread[] {
    return this.#collaboration.listThreads(
      this.#requireAuthenticatedActor(actor),
      input.roomId,
    );
  }
  listMessages(
    actor: AuthenticatedActorContext,
    input: {
      afterSeq?: number;
      beforeSeq?: number;
      limit?: number;
      roomId: string;
      threadId?: string;
    },
  ): MessagePage {
    return this.#collaboration.listMessages(
      this.#requireAuthenticatedActor(actor),
      input,
    );
  }

  listMessageReferenceReadStates(
    actor: AuthenticatedActorContext,
    input: { messageIds: string[]; roomId: string },
  ) {
    return projectMessageReferenceReadStates(
      this.#database,
      this.#requireAuthenticatedActor(actor),
      input,
    );
  }
  listMessageForwardTargets(
    actor: AuthenticatedActorContext,
    input: ClientMessageForwardTargetsRequest,
  ): Room[] {
    return this.#messageForwarding.listTargets(
      this.getAuthenticatedPrincipal(actor),
      input,
    );
  }
  forwardMessages(
    actor: AuthenticatedActorContext,
    input: ClientMessageForwardRequest,
  ): ClientMessageForwardResponse {
    const principal = this.getAuthenticatedPrincipal(actor);
    const prepared = this.#transaction(() =>
      this.#messageForwarding.prepare(principal, input),
    );
    const results: ClientMessageForwardResponse["results"] = [];
    for (const destinationRoomId of input.destinationRoomIds) {
      try {
        const delivered = this.#transaction(() =>
          this.#messageForwarding.deliver(
            principal,
            prepared,
            destinationRoomId,
          ),
        );
        results.push({
          deduplicated: delivered.deduplicated,
          destinationRoomId,
          messageId: delivered.messageId,
          status: "delivered",
        });
      } catch (error) {
        const failure =
          error instanceof MessageForwardDestinationError
            ? { code: error.code, message: error.message }
            : error instanceof IdempotencyConflictError
              ? {
                  code: "idempotency_conflict" as const,
                  message: error.message,
                }
              : {
                  code: "delivery_failed" as const,
                  message:
                    error instanceof Error
                      ? error.message.slice(0, 500)
                      : "message forwarding failed",
                };
        results.push({ destinationRoomId, status: "failed", ...failure });
      }
    }
    return this.#messageForwarding.response(input.requestId, results);
  }
  createThread(
    actor: AuthenticatedActorContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      recipientIds: string[];
      roomId: string;
      rootMessageId: string;
    },
  ): ThreadMutationResult {
    return this.#transaction(() => {
      return this.#collaboration.createThread(
        this.getAuthenticatedPrincipal(actor),
        input,
      );
    });
  }
  replyThread(
    actor: AuthenticatedActorContext,
    input: ar.HumanThreadReplyInput,
  ): MessageMutationResult {
    return this.#transaction(() =>
      ar.replyHumanThread({
        actor,
        collaboration: this.#collaboration,
        database: this.#database,
        files: this.files,
        input,
        principal: this.getAuthenticatedPrincipal(actor),
      }),
    );
  }
  postMessage(
    actor: AuthenticatedActorContext,
    input: {
      basedOnRoomSeq?: number;
      body: string;
      idempotencyKey: string;
      recipients: MessageRecipient[];
      roomId: string;
    },
  ): MessageMutationResult {
    return this.#transaction(() => {
      return this.#collaboration.postMessage(
        this.getAuthenticatedPrincipal(actor),
        input,
      );
    });
  }
  postRoomMessage(
    actor: AuthenticatedActorContext,
    input: ar.HumanRoomMessageInput,
  ): MessageMutationResult {
    return this.#transaction(() =>
      ar.postHumanRoomMessage({
        actor,
        collaboration: this.#collaboration,
        database: this.#database,
        files: this.files,
        input,
        principal: this.getAuthenticatedPrincipal(actor),
      }),
    );
  }
  postWorkerMessage(
    execution: AuthenticatedWorkerExecutionContext,
    input: WorkerMessagePostRequest,
  ) {
    if (input.channel !== undefined)
      return this.workerTargetContext.post(execution, input);
    return this.#transaction(() => {
      const scope = this.#requireAuthenticatedWorkerExecution(execution);
      return postWorkerMessageTransaction({
        comments: this.attachmentComments,
        database: this.#database,
        collaboration: this.#collaboration,
        files: this.files,
        principal: principalProfile.fromRow(
          this.#requirePrincipal(scope.participantId),
        ),
        scope,
        execution,
        input,
        eventFromRow: (row) => this.#eventFromRow(row),
      });
    });
  }

  unfollowWorkerThread(
    execution: AuthenticatedWorkerExecutionContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      threadId: string;
    },
  ) {
    return this.#transaction(() =>
      agentThreads.unfollowWorkerThreadTransaction({
        command: input,
        database: this.#database,
        events: this.#roomEvents,
        scope: this.#requireAuthenticatedWorkerExecution(execution),
        updatedAt: this.#timestamp(),
      }),
    );
  }
  createTask(
    actor: AuthenticatedActorContext,
    input: TaskCreateCommand,
  ): TaskCreateMutationResult {
    return this.#transaction(() => {
      const actorId = this.#requireAuthenticatedActor(actor);
      this.#requireMember(input.roomId, actorId);
      return createTaskMutationTransaction(
        this.#taskIntentContext(),
        actorId,
        input,
      );
    });
  }
  listGlobalTasks(actor: AuthenticatedActorContext, input: GlobalTasksRequest) {
    return new GlobalDiscovery(this.#database).tasks(
      this.#requireAuthenticatedActor(actor),
      input,
    );
  }
  searchWorkspace(
    actor: AuthenticatedActorContext,
    input: WorkspaceSearchRequest,
  ) {
    return new GlobalDiscovery(this.#database).search(
      this.#requireAuthenticatedActor(actor),
      input,
    );
  }
  getMessageContext(
    actor: AuthenticatedActorContext,
    input: MessageContextRequest,
  ) {
    return new GlobalDiscovery(this.#database).context(
      this.#requireAuthenticatedActor(actor),
      input,
    );
  }
  listTasks(
    actor: AuthenticatedActorContext,
    input: RoomTaskPageRequest,
  ): Task[] {
    return this.listTaskPage(actor, input).tasks;
  }
  listTaskPage(
    actor: AuthenticatedActorContext,
    input: RoomTaskPageRequest,
  ): TaskPage {
    const actorId = this.#requireAuthenticatedActor(actor);
    this.#requireMember(input.roomId, actorId);
    return listTaskProjectionPage(this.#database, input.roomId, input);
  }
  getTask(
    actor: AuthenticatedActorContext,
    input: { roomId: string; taskId: string },
  ): Task {
    const actorId = this.#requireAuthenticatedActor(actor);
    this.#requireMember(input.roomId, actorId);
    return requireRoomTaskProjection(
      this.#database,
      input.roomId,
      input.taskId,
    );
  }
  listInputRequests(
    actor: AuthenticatedActorContext,
    input: { roomId: string },
  ): InputRequest[] {
    const actorId = this.#requireAuthenticatedActor(actor);
    this.#requireMember(input.roomId, actorId);
    return this.#database
      .prepare(
        "SELECT * FROM input_requests WHERE room_id = ? ORDER BY created_at, input_request_id",
      )
      .all(input.roomId)
      .map((row) => inputRequestProjectionFromRow(row));
  }
  createWorkerTask(
    execution: AuthenticatedWorkerExecutionContext,
    input: {
      assigneeId?: string;
      basedOnRoomSeq: number;
      idempotencyKey: string;
      leaseMs: number;
      title: string;
    },
  ): TaskMutationResult {
    return this.#transaction(() => {
      const scope = this.#requireAuthenticatedWorkerExecution(execution);
      return createWorkerTaskTransaction(
        this.#taskIntentContext(),
        scope,
        input,
      );
    });
  }
  claimMessageAsTask(
    execution: AuthenticatedWorkerExecutionContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      leaseMs: number;
      messageId: string;
      rationale: string;
    },
  ): TaskMutationResult {
    return this.#transaction(() => {
      const scope = this.#requireAuthenticatedWorkerExecution(execution);
      return claimMessageAsTaskTransaction(
        this.#taskIntentContext(),
        scope,
        input,
      );
    });
  }
  getWorkerTask(
    execution: AuthenticatedWorkerExecutionContext,
    input: { taskId: string },
  ): Task {
    return this.#transaction(() => {
      const scope = this.#requireAuthenticatedWorkerExecution(execution);
      return this.#taskFromRow(
        requireWorkerTaskVisibility(this.#database, scope, input.taskId),
      );
    });
  }
  listWorkerTaskTrajectory(
    execution: AuthenticatedWorkerExecutionContext,
    input: WorkerTaskTrajectoryRequest,
  ): WorkerTaskTrajectoryResponse {
    return this.#transaction(() =>
      listWorkerTaskTrajectory(
        this.#database,
        this.#requireAuthenticatedWorkerExecution(execution),
        input,
      ),
    );
  }
  getWorkerTaskInputStatus(
    execution: AuthenticatedWorkerExecutionContext,
    input: { taskId: string },
  ): InputRequestStatus | null {
    return this.#transaction(() => {
      const scope = this.#requireAuthenticatedWorkerExecution(execution);
      this.#requireWorkerTask(scope, input.taskId);
      const row = this.#database
        .prepare(
          `SELECT input_request_id, task_id, state
           FROM input_requests
           WHERE task_id = ? AND requester_id = ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT 1`,
        )
        .get(input.taskId, scope.participantId);
      if (row === undefined) return null;
      return InputRequestStatusSchema.parse({
        inputRequestId: text(row, "input_request_id"),
        taskId: text(row, "task_id"),
        state: text(row, "state"),
      });
    });
  }

  heartbeatTaskClaim(
    execution: AuthenticatedWorkerExecutionContext,
    input: { leaseMs: number; taskId: string },
  ): Task {
    return this.#transaction(() => {
      const scope = this.#requireAuthenticatedWorkerExecution(execution);
      const taskRow = this.#requireWorkerTask(scope, input.taskId);
      this.#assertPositiveTaskLease(input.leaseMs);
      const state = text(taskRow, "state");
      if (state !== "claimed" && state !== "in_progress") {
        throw new ConflictError(
          `Task ${input.taskId} has no renewable claim in state ${state}`,
        );
      }
      requireOwnedTaskClaim(
        taskRow,
        scope.participantId,
        state,
        this.#now().getTime(),
      );

      const now = this.#now();
      const claimUntilMs = Math.max(
        nullableInteger(taskRow, "claim_until_ms") ?? 0,
        now.getTime() + input.leaseMs,
      );
      this.#database
        .prepare(
          "UPDATE tasks SET claim_until = ?, claim_until_ms = ?, updated_at = ? WHERE task_id = ?",
        )
        .run(
          new Date(claimUntilMs).toISOString(),
          claimUntilMs,
          now.toISOString(),
          input.taskId,
        );
      return this.#taskFromRow(this.#requireTaskRow(input.taskId));
    });
  }

  claimTask(
    execution: AuthenticatedWorkerExecutionContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      leaseMs: number;
      taskId: string;
    },
  ): TaskMutationResult {
    return this.#transaction(() => {
      const scope = this.#requireAuthenticatedWorkerExecution(execution);
      const taskRow = this.#requireWorkerTask(scope, input.taskId);
      const replay = this.#replayWorkerTaskCommand(taskRow, scope, {
        eventType: "task.claimed",
        idempotencyKey: input.idempotencyKey,
      });
      if (replay !== null) return replay;
      this.#assertPositiveTaskLease(input.leaseMs);
      const existingAssignee = nullableText(taskRow, "assignee_id");
      if (
        existingAssignee !== null &&
        existingAssignee !== scope.participantId
      ) {
        throw new LeaseConflictError(
          `Task ${input.taskId} is owned by another Agent`,
        );
      }
      const incompleteDependency = this.#database
        .prepare(
          `SELECT task_dependencies.dependency_task_id
           FROM task_dependencies
           JOIN tasks AS dependency
             ON dependency.task_id = task_dependencies.dependency_task_id
           WHERE task_dependencies.task_id = ?
             AND dependency.state <> 'completed'
           ORDER BY task_dependencies.dependency_task_id
           LIMIT 1`,
        )
        .get(input.taskId);
      if (incompleteDependency !== undefined) {
        throw new ConflictError(
          `Task ${input.taskId} is waiting for dependency ${text(incompleteDependency, "dependency_task_id")}`,
        );
      }
      assertWorkerTaskFreshContext(
        this.#database,
        scope,
        input.basedOnRoomSeq,
        input.taskId,
      );

      const previousState = text(taskRow, "state");
      const previousClaimedBy = nullableText(taskRow, "claimed_by");
      const previousClaimUntil = nullableText(taskRow, "claim_until");
      const previousClaimUntilMs = nullableInteger(taskRow, "claim_until_ms");
      const claimIsActive =
        (previousState === "claimed" || previousState === "in_progress") &&
        previousClaimUntilMs !== null &&
        previousClaimUntilMs > this.#now().getTime();
      if (previousState !== "todo" && !claimIsActive) {
        if (previousState !== "claimed" && previousState !== "in_progress") {
          throw new ConflictError(
            `Task ${input.taskId} cannot be claimed from state ${previousState}`,
          );
        }
      }
      if (claimIsActive) {
        throw new LeaseConflictError(
          `Task ${input.taskId} already has an active claim`,
        );
      }

      const now = this.#now();
      const updatedAt = now.toISOString();
      const claimUntil = new Date(now.getTime() + input.leaseMs).toISOString();
      this.#database
        .prepare(
          "UPDATE tasks SET state = 'claimed', assignee_id = ?, claimed_by = ?, claim_until = ?, claim_until_ms = ?, updated_at = ? WHERE task_id = ?",
        )
        .run(
          scope.participantId,
          scope.participantId,
          claimUntil,
          now.getTime() + input.leaseMs,
          updatedAt,
          input.taskId,
        );
      const event = this.#appendWorkerTaskEvent(scope, {
        basedOnRoomSeq: input.basedOnRoomSeq,
        eventType: "task.claimed",
        idempotencyKey: input.idempotencyKey,
        payload: {
          claimedBy: scope.participantId,
          claimUntil,
          ...(previousClaimedBy === null ? {} : { previousClaimedBy }),
          ...(previousClaimUntil === null ? {} : { previousClaimUntil }),
          previousState,
        },
        taskId: input.taskId,
      });
      return {
        deduplicated: false,
        event,
        task: this.#taskFromRow(this.#requireTaskRow(input.taskId)),
      };
    });
  }

  startTask(
    execution: AuthenticatedWorkerExecutionContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      leaseMs: number;
      taskId: string;
    },
  ): TaskMutationResult {
    return this.#transitionOwnedTask(execution, {
      ...input,
      eventType: "task.started",
      expectedState: "claimed",
      nextState: "in_progress",
    });
  }

  progressTask(
    execution: AuthenticatedWorkerExecutionContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      leaseMs: number;
      progress: string;
      taskId: string;
    },
  ): TaskMutationResult {
    const progress = input.progress.trim();
    if (progress.length === 0) throw new Error("task progress is required");
    return this.#transitionOwnedTask(execution, {
      ...input,
      eventType: "task.progressed",
      expectedState: "in_progress",
      extraPayload: { progress },
      lastProgress: progress,
      nextState: "in_progress",
    });
  }

  releaseTask(
    execution: AuthenticatedWorkerExecutionContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      taskId: string;
    },
  ): TaskCreateMutationResult {
    return this.#transaction(() => {
      const scope = this.#requireAuthenticatedWorkerExecution(execution);
      const taskRow = this.#requireWorkerTask(scope, input.taskId);
      const replay = this.#replayWorkerTaskCommand(taskRow, scope, {
        eventType: "task.released",
        idempotencyKey: input.idempotencyKey,
      });
      if (replay !== null) return { ...replay, activationIds: [] };
      assertWorkerTaskFreshContext(
        this.#database,
        scope,
        input.basedOnRoomSeq,
        input.taskId,
      );
      const previousState = text(taskRow, "state");
      if (previousState !== "claimed" && previousState !== "in_progress") {
        throw new ConflictError(
          `Task ${input.taskId} cannot be released from state ${previousState}`,
        );
      }
      requireOwnedTaskClaim(
        taskRow,
        scope.participantId,
        previousState,
        this.#now().getTime(),
      );

      const releasedAt = this.#timestamp();
      const previousParticipants = this.#database
        .prepare(
          "SELECT participant_id, role FROM task_participants WHERE task_id = ? ORDER BY participant_id, role",
        )
        .all(input.taskId);
      this.#database
        .prepare(
          "UPDATE tasks SET state = 'todo', assignee_id = NULL, claimed_by = NULL, claim_until = NULL, claim_until_ms = NULL, updated_at = ? WHERE task_id = ?",
        )
        .run(releasedAt, input.taskId);
      this.#database
        .prepare("DELETE FROM task_participants WHERE task_id = ?")
        .run(input.taskId);
      const event = this.#appendWorkerTaskEvent(scope, {
        basedOnRoomSeq: input.basedOnRoomSeq,
        eventType: "task.released",
        idempotencyKey: input.idempotencyKey,
        payload: {
          previousAssigneeId: scope.participantId,
          previousCollaboratorIds: previousParticipants
            .filter(
              (participant) => text(participant, "role") === "collaborator",
            )
            .map((participant) => text(participant, "participant_id")),
          previousReviewerIds: previousParticipants
            .filter((participant) => text(participant, "role") === "reviewer")
            .map((participant) => text(participant, "participant_id")),
          previousState,
          releasedAt,
        },
        taskId: input.taskId,
      });
      const recipients = ar.listRoomAgentRecipients(
        this.#database,
        scope.roomId,
        "task_available",
        scope.participantId,
      );
      const activationIds = this.#deriveAttention(
        event,
        recipients,
        releasedAt,
      );
      return {
        activationIds,
        deduplicated: false,
        event,
        task: this.#taskFromRow(this.#requireTaskRow(input.taskId)),
      };
    });
  }

  blockTask(
    execution: AuthenticatedWorkerExecutionContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      reason: string;
      taskId: string;
    },
  ): TaskCreateMutationResult {
    const reason = input.reason.trim();
    if (reason.length === 0) throw new Error("block reason is required");
    return this.#transaction(() => {
      const scope = this.#requireAuthenticatedWorkerExecution(execution);
      const taskRow = this.#requireWorkerTask(scope, input.taskId);
      const replay = this.#replayWorkerTaskCommand(taskRow, scope, {
        eventType: "task.blocked",
        idempotencyKey: input.idempotencyKey,
        payload: { reason },
      });
      if (replay !== null) return { ...replay, activationIds: [] };
      assertWorkerTaskFreshContext(
        this.#database,
        scope,
        input.basedOnRoomSeq,
        input.taskId,
      );
      requireOwnedTaskClaim(
        taskRow,
        scope.participantId,
        "in_progress",
        this.#now().getTime(),
      );

      const blockedAt = this.#timestamp();
      this.#database
        .prepare(
          "UPDATE tasks SET state = 'blocked', claimed_by = NULL, claim_until = NULL, claim_until_ms = NULL, blocked_reason = ?, blocked_at = ?, updated_at = ? WHERE task_id = ?",
        )
        .run(reason, blockedAt, blockedAt, input.taskId);
      const event = this.#appendWorkerTaskEvent(scope, {
        basedOnRoomSeq: input.basedOnRoomSeq,
        eventType: "task.blocked",
        idempotencyKey: input.idempotencyKey,
        payload: { blockedAt, reason },
        taskId: input.taskId,
      });
      const activationIds = this.#deriveAttention(
        event,
        [
          {
            participantId: text(taskRow, "creator_id"),
            reason: "task_updated",
          },
        ],
        blockedAt,
      );
      return {
        activationIds,
        deduplicated: false,
        event,
        task: this.#taskFromRow(this.#requireTaskRow(input.taskId)),
      };
    });
  }

  requestTaskInput(
    execution: AuthenticatedWorkerExecutionContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      question: string;
      taskId: string;
    },
  ): InputRequestMutationResult {
    const question = input.question.trim();
    if (question.length === 0) throw new Error("input question is required");
    return this.#transaction(() => {
      const scope = this.#requireAuthenticatedWorkerExecution(execution);
      const taskRow = this.#requireWorkerTask(scope, input.taskId);
      const previous = findRoomEventByIdempotencyKey(
        this.#database,
        scope.roomId,
        input.idempotencyKey,
      );
      if (previous !== undefined) {
        const event = assertInputRequestEventReplay(
          this.#eventFromRow(previous),
          {
            actorId: scope.participantId,
            eventType: "input.requested",
            payload: { question, taskId: input.taskId },
          },
        );
        return {
          deduplicated: true,
          event,
          inputRequest: inputRequestProjectionFromRow(
            this.#requireInputRequestRow(event.aggregateId),
          ),
          task: this.#taskFromRow(this.#requireTaskRow(input.taskId)),
        };
      }
      const responderId = workerTaskInputResponder(this.#database, taskRow);
      assertWorkerTaskFreshContext(
        this.#database,
        scope,
        input.basedOnRoomSeq,
        input.taskId,
      );
      requireOwnedTaskClaim(
        taskRow,
        scope.participantId,
        "in_progress",
        this.#now().getTime(),
      );

      const inputRequestId = this.#createId("input");
      const createdAt = this.#timestamp();
      this.#database
        .prepare(
          "INSERT INTO input_requests(input_request_id, room_id, task_id, requester_id, responder_id, question, state, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
        )
        .run(
          inputRequestId,
          scope.roomId,
          input.taskId,
          scope.participantId,
          responderId,
          question,
          createdAt,
          createdAt,
        );
      this.#database
        .prepare(
          "UPDATE tasks SET state = 'waiting_input', claimed_by = NULL, claim_until = NULL, claim_until_ms = NULL, updated_at = ? WHERE task_id = ?",
        )
        .run(createdAt, input.taskId);
      const event = this.#appendEvent({
        actorId: scope.participantId,
        aggregateId: inputRequestId,
        aggregateType: "input_request",
        idempotencyKey: input.idempotencyKey,
        payload: {
          basedOnRoomSeq: input.basedOnRoomSeq,
          inputRequestId,
          question,
          requesterId: scope.participantId,
          responderId,
          runAttemptId: scope.runAttemptId,
          taskId: input.taskId,
        },
        roomId: scope.roomId,
        type: "input.requested",
      });
      this.#insertInboxItem({
        createdAt,
        event,
        participantId: responderId,
        reason: "input_requested",
      });
      return {
        deduplicated: false,
        event,
        inputRequest: inputRequestProjectionFromRow(
          this.#requireInputRequestRow(inputRequestId),
        ),
        task: this.#taskFromRow(this.#requireTaskRow(input.taskId)),
      };
    });
  }

  submitTask(
    execution: AuthenticatedWorkerExecutionContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      deliveryRepository?: TaskSubmissionRepositoryEvidence;
      summary: string;
      taskId: string;
      verification?: TaskVerificationDeclaration;
    },
  ): TaskMutationResult {
    const summary = input.summary.trim();
    if (summary.length === 0) throw new Error("task summary is required");
    return this.#transaction(() => {
      const scope = this.#requireAuthenticatedWorkerExecution(execution);
      const taskRow = this.#requireWorkerTask(scope, input.taskId);
      const replay = this.#replayWorkerTaskCommand(taskRow, scope, {
        eventType: "task.submitted",
        idempotencyKey: input.idempotencyKey,
        payload: { summary, verification: input.verification ?? null },
      });
      if (replay !== null) return replay;
      assertWorkerTaskFreshContext(
        this.#database,
        scope,
        input.basedOnRoomSeq,
        input.taskId,
      );
      requireOwnedTaskClaim(
        taskRow,
        scope.participantId,
        "in_progress",
        this.#now().getTime(),
      );
      const artifactEvidence = this.files.forTaskSubmission(
        execution,
        input.taskId,
        input.deliveryRepository,
      );
      const workspaceEvidence = deriveTaskSubmissionWorkspaceEvidence(
        this.#database,
        scope,
      );
      const evidence = buildTaskSubmissionEvidence({
        artifacts: artifactEvidence.references,
        repository: input.deliveryRepository,
        verification: input.verification,
        workspace: workspaceEvidence,
      });

      const submittedAt = this.#timestamp();
      this.#database
        .prepare(
          "UPDATE tasks SET state = 'submitted', claimed_by = NULL, claim_until = NULL, claim_until_ms = NULL, submission_summary = ?, submitted_at = ?, updated_at = ? WHERE task_id = ?",
        )
        .run(summary, submittedAt, submittedAt, input.taskId);
      const { messageId, threadId } = createTaskThreadReply(
        this.#database,
        this.#createId,
        taskRow,
        {
          actorId: scope.participantId,
          attachments: artifactEvidence.attachments,
          body: summary,
          createdAt: submittedAt,
          roomId: scope.roomId,
        },
      );
      const submission = this.#taskReviews.recordSubmission(taskRow, {
        artifacts: artifactEvidence.references,
        createdAt: submittedAt,
        evidence,
        messageId,
        producerId: scope.participantId,
        summary,
      });
      this.files.consume(artifactEvidence.attachments, messageId);
      const event = this.#appendWorkerTaskEvent(scope, {
        basedOnRoomSeq: input.basedOnRoomSeq,
        eventType: "task.submitted",
        idempotencyKey: input.idempotencyKey,
        payload: {
          messageId,
          artifactIds: artifactEvidence.references.map(
            ({ attachmentId }) => attachmentId,
          ),
          submissionDigest: submission.submissionDigest,
          submissionId: submission.submissionId,
          summary,
          submittedAt,
          threadId,
          verification: input.verification ?? null,
        },
        taskId: input.taskId,
      });
      const reviewerRecipients: MessageRecipient[] = this.#database
        .prepare(
          "SELECT participant_id FROM task_participants WHERE task_id = ? AND role = 'reviewer' ORDER BY participant_id",
        )
        .all(input.taskId)
        .map((reviewer) => ({
          obligations: [
            {
              kind: "task_review" as const,
              submissionId: submission.submissionId,
              taskId: input.taskId,
            },
          ],
          participantId: text(reviewer, "participant_id"),
          reason: "task_review" as const,
        }));
      this.#deriveAttention(event, reviewerRecipients, submittedAt);
      return {
        deduplicated: false,
        event,
        task: this.#taskFromRow(this.#requireTaskRow(input.taskId)),
      };
    });
  }

  replayTaskSubmission(
    execution: AuthenticatedWorkerExecutionContext,
    input: {
      idempotencyKey: string;
      summary: string;
      taskId: string;
      verification?: TaskVerificationDeclaration;
    },
  ): TaskMutationResult | null {
    const summary = input.summary.trim();
    if (summary.length === 0) throw new Error("task summary is required");
    return this.#transaction(() => {
      const scope = this.#requireAuthenticatedWorkerExecution(execution);
      const taskRow = this.#requireWorkerTask(scope, input.taskId);
      return this.#replayWorkerTaskCommand(taskRow, scope, {
        eventType: "task.submitted",
        idempotencyKey: input.idempotencyKey,
        payload: { summary, verification: input.verification ?? null },
      });
    });
  }

  assignTask(
    actor: AuthenticatedActorContext,
    input: {
      assigneeId: string;
      basedOnRoomSeq: number;
      idempotencyKey: string;
      taskId: string;
    },
  ): TaskCreateMutationResult {
    return this.#transaction(() =>
      assignTaskTransaction(
        {
          database: this.#database,
          events: this.#roomEvents,
          assignedAt: this.#timestamp(),
          assertFreshContext: (roomId, actorId, seq) =>
            this.#assertFreshContext(roomId, actorId, seq),
        },
        this.#requireAuthenticatedActor(actor),
        input,
      ),
    );
  }

  unassignTask(
    actor: AuthenticatedActorContext,
    input: TaskUnassignCommand,
  ): TaskCreateMutationResult {
    return this.#transaction(() =>
      unassignTaskTransaction(this.#database, this.#roomEvents, {
        actorId: this.#requireAuthenticatedActor(actor),
        command: input,
        unassignedAt: this.#timestamp(),
      }),
    );
  }

  unblockTask(
    actor: AuthenticatedActorContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      taskId: string;
    },
  ): TaskCreateMutationResult {
    return this.#transaction(() =>
      unblockTaskTransaction(
        {
          database: this.#database,
          events: this.#roomEvents,
          unblockedAt: this.#timestamp(),
          assertFreshContext: (roomId, actorId, seq) =>
            this.#assertFreshContext(roomId, actorId, seq),
        },
        this.#requireAuthenticatedActor(actor),
        input,
      ),
    );
  }

  cancelTask(
    actor: AuthenticatedActorContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      reason: string;
      taskId: string;
    },
  ): TaskCreateMutationResult {
    return this.#taskLifecycle.cancelTask(actor, input);
  }

  reopenTask(
    actor: AuthenticatedActorContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      taskId: string;
    },
  ): TaskCreateMutationResult {
    return this.#taskLifecycle.reopenTask(actor, input);
  }

  resolveInputRequest(
    actor: AuthenticatedActorContext,
    input: {
      answer: string;
      basedOnRoomSeq: number;
      idempotencyKey: string;
      inputRequestId: string;
    },
  ): InputRequestResolveMutationResult {
    const answer = input.answer.trim();
    if (answer.length === 0) throw new Error("input answer is required");
    return this.#transaction(() => {
      const actorId = this.#requireAuthenticatedActor(actor);
      const inputRow = this.#requireInputRequestRow(input.inputRequestId);
      const roomId = text(inputRow, "room_id");
      const taskId = text(inputRow, "task_id");
      this.#requireMember(roomId, actorId);
      if (text(inputRow, "responder_id") !== actorId) {
        throw new ForbiddenError(
          `only the designated responder can resolve InputRequest ${input.inputRequestId}`,
        );
      }
      const previous = findRoomEventByIdempotencyKey(
        this.#database,
        roomId,
        input.idempotencyKey,
      );
      if (previous !== undefined) {
        const event = assertInputRequestEventReplay(
          this.#eventFromRow(previous),
          {
            actorId,
            aggregateId: input.inputRequestId,
            eventType: "input.resolved",
            payload: { answer, inputRequestId: input.inputRequestId, taskId },
          },
        );
        return {
          activationIds: [],
          deduplicated: true,
          event,
          inputRequest: inputRequestProjectionFromRow(
            this.#requireInputRequestRow(input.inputRequestId),
          ),
          task: this.#taskFromRow(this.#requireTaskRow(taskId)),
        };
      }
      this.#assertFreshContext(roomId, actorId, input.basedOnRoomSeq);
      if (text(inputRow, "state") !== "pending") {
        throw new ConflictError(
          `InputRequest ${input.inputRequestId} is not pending`,
        );
      }
      const taskRow = this.#requireTaskRow(taskId);
      if (text(taskRow, "state") !== "waiting_input") {
        throw new ConflictError(`Task ${taskId} is not waiting for input`);
      }

      const resolvedAt = this.#timestamp();
      this.#database
        .prepare(
          "UPDATE input_requests SET state = 'resolved', answer = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE input_request_id = ?",
        )
        .run(answer, actorId, resolvedAt, resolvedAt, input.inputRequestId);
      this.#database
        .prepare(
          "UPDATE tasks SET state = 'todo', updated_at = ? WHERE task_id = ?",
        )
        .run(resolvedAt, taskId);
      const event = this.#appendEvent({
        actorId,
        aggregateId: input.inputRequestId,
        aggregateType: "input_request",
        idempotencyKey: input.idempotencyKey,
        payload: {
          answer,
          basedOnRoomSeq: input.basedOnRoomSeq,
          inputRequestId: input.inputRequestId,
          requesterId: text(inputRow, "requester_id"),
          resolvedAt,
          resolvedBy: actorId,
          taskId,
        },
        roomId,
        type: "input.resolved",
      });
      const activationIds = this.#deriveAttention(
        event,
        [
          {
            participantId: text(inputRow, "requester_id"),
            reason: "input_resolved",
          },
        ],
        resolvedAt,
      );
      return {
        activationIds,
        deduplicated: false,
        event,
        inputRequest: inputRequestProjectionFromRow(
          this.#requireInputRequestRow(input.inputRequestId),
        ),
        task: this.#taskFromRow(this.#requireTaskRow(taskId)),
      };
    });
  }

  completeTask(
    actor: AuthenticatedActorContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      taskId: string;
    },
  ): TaskCreateMutationResult {
    return this.#transaction(() => {
      const actorId = this.#requireAuthenticatedActor(actor);
      const taskRow = this.#requireTaskRow(input.taskId);
      const roomId = text(taskRow, "room_id");
      this.#requireMember(roomId, actorId);
      requireHumanTaskManager(
        this.#database,
        { creatorId: text(taskRow, "creator_id"), roomId },
        actorId,
      );
      const previous = findRoomEventByIdempotencyKey(
        this.#database,
        roomId,
        input.idempotencyKey,
      );
      if (previous !== undefined) {
        const event = assertTaskEventReplay(this.#eventFromRow(previous), {
          actorId,
          aggregateId: input.taskId,
          eventType: "task.completed",
          payload: { basedOnRoomSeq: input.basedOnRoomSeq },
        });
        return {
          activationIds: [],
          deduplicated: true,
          event,
          task: this.#taskFromRow(this.#requireTaskRow(input.taskId)),
        };
      }
      if (input.basedOnRoomSeq === undefined) {
        throw new StaleContextError(
          undefined,
          integer(this.#requireRoom(roomId), "next_seq") - 1,
        );
      }
      this.#assertFreshContext(roomId, actorId, input.basedOnRoomSeq);
      if (text(taskRow, "state") !== "submitted") {
        throw new ConflictError(
          `Task ${input.taskId} can only be completed from submitted`,
        );
      }
      this.#taskReviews.assertCompletionAllowed(input.taskId);
      const completedAt = this.#timestamp();
      this.#database
        .prepare(
          "UPDATE tasks SET state = 'completed', completed_at = ?, updated_at = ? WHERE task_id = ?",
        )
        .run(completedAt, completedAt, input.taskId);
      const readyTasks = this.#database
        .prepare(
          `SELECT candidate.*
           FROM task_dependencies
           JOIN tasks AS candidate
             ON candidate.task_id = task_dependencies.task_id
           WHERE task_dependencies.dependency_task_id = ?
             AND candidate.state = 'todo'
             AND NOT EXISTS (
               SELECT 1
               FROM task_dependencies AS remaining
               JOIN tasks AS dependency
                 ON dependency.task_id = remaining.dependency_task_id
               WHERE remaining.task_id = candidate.task_id
                 AND dependency.state <> 'completed'
             )
           ORDER BY candidate.task_id`,
        )
        .all(input.taskId);
      const readyTaskIds = readyTasks.map((readyTask) =>
        text(readyTask, "task_id"),
      );
      const event = this.#appendEvent({
        actorId,
        aggregateId: input.taskId,
        aggregateType: "task",
        idempotencyKey: input.idempotencyKey,
        payload: {
          basedOnRoomSeq: input.basedOnRoomSeq,
          completedAt,
          readyTaskIds,
          taskId: input.taskId,
        },
        roomId,
        type: "task.completed",
      });
      const recipientMap = new Map<string, MessageRecipient>();
      for (const readyTask of readyTasks) {
        const assigneeId = nullableText(readyTask, "assignee_id");
        const recipients =
          assigneeId === null
            ? ar.listRoomAgentRecipients(
                this.#database,
                roomId,
                "dependency_resolved",
              )
            : [
                {
                  participantId: assigneeId,
                  reason: "dependency_resolved" as const,
                },
                ...this.#database
                  .prepare(
                    "SELECT participant_id FROM task_participants WHERE task_id = ? AND role = 'collaborator' ORDER BY participant_id",
                  )
                  .all(text(readyTask, "task_id"))
                  .map((participant) => ({
                    participantId: text(participant, "participant_id"),
                    reason: "task_collaboration" as const,
                  })),
              ];
        for (const recipient of recipients) {
          recipientMap.set(recipient.participantId, recipient);
        }
      }
      const activationIds = this.#deriveAttention(
        event,
        [...recipientMap.values()].sort((left, right) =>
          left.participantId.localeCompare(right.participantId),
        ),
        completedAt,
      );
      return {
        activationIds,
        deduplicated: false,
        event,
        task: this.#taskFromRow(this.#requireTaskRow(input.taskId)),
      };
    });
  }

  listInbox(
    actor: AuthenticatedActorContext,
    input: { roomId: string },
  ): InboxItem[] {
    const participantId = this.#requireAuthenticatedActor(actor);
    this.#requireMember(input.roomId, participantId);
    return this.#database
      .prepare(
        "SELECT * FROM inbox_items WHERE room_id = ? AND participant_id = ? ORDER BY event_seq, inbox_item_id",
      )
      .all(input.roomId, participantId)
      .map((row) => inboxProjectionFromRow(row));
  }

  listActivations(
    input: {
      participantId?: string;
      roomId?: string;
    } = {},
  ): Activation[] {
    const conditions: string[] = [];
    const parameters: string[] = [];
    if (input.roomId !== undefined) {
      conditions.push("room_id = ?");
      parameters.push(input.roomId);
    }
    if (input.participantId !== undefined) {
      conditions.push("participant_id = ?");
      parameters.push(input.participantId);
    }
    const where =
      conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    return this.#database
      .prepare(
        `SELECT * FROM activations${where} ORDER BY created_at, activation_id`,
      )
      .all(...parameters)
      .map((row) => activationProjectionFromRow(row));
  }

  listOutbox(): OutboxEntry[] {
    return this.#database
      .prepare("SELECT * FROM outbox ORDER BY outbox_seq")
      .all()
      .map((row) => outboxProjectionFromRow(row));
  }

  createExecutionPolicy(
    actor: AuthenticatedActorContext,
    input: ExecutionPolicyContent & {
      basedOnRoomSeq: number;
      controlRoomId: string;
      idempotencyKey: string;
    },
  ): ExecutionPolicyMutationResult {
    return this.#transaction(() => {
      const actorId = this.#requireHumanControlActor(
        actor,
        input.controlRoomId,
      );
      this.#assertIdempotencyKey(input.idempotencyKey);
      const content = normalizeExecutionPolicyContent(input);
      const contentDigest = canonicalDigest(content);
      const previous = findRoomEventByIdempotencyKey(
        this.#database,
        input.controlRoomId,
        input.idempotencyKey,
      );
      if (previous !== undefined) {
        const event = this.#assertControlEventReplay(previous, {
          actorId,
          contentDigest,
          eventType: "policy.created",
        });
        const revisionId = eventPayloadText(event, "executionPolicyRevisionId");
        return {
          deduplicated: true,
          event,
          policy: this.#executionPolicyRevisionFromRow(
            this.#requireExecutionPolicyRevisionRow(revisionId),
          ),
        };
      }
      this.#assertFreshContext(
        input.controlRoomId,
        actorId,
        input.basedOnRoomSeq,
      );

      const executionPolicyId = this.#createId("execution_policy");
      const executionPolicyRevisionId = this.#createId(
        "execution_policy_revision",
      );
      const createdAt = this.#timestamp();
      const policy = ExecutionPolicyRevisionSchema.parse({
        ...content,
        contentDigest,
        controlRoomId: input.controlRoomId,
        createdAt,
        createdBy: actorId,
        executionPolicyId,
        executionPolicyRevisionId,
        revision: 1,
      });
      this.#database
        .prepare(
          "INSERT INTO execution_policies(execution_policy_id, control_room_id, current_revision_id, created_at, updated_at) VALUES(?, ?, ?, ?, ?)",
        )
        .run(
          executionPolicyId,
          input.controlRoomId,
          executionPolicyRevisionId,
          createdAt,
          createdAt,
        );
      this.#insertExecutionPolicyRevision(policy);
      const event = this.#appendEvent({
        actorId,
        aggregateId: executionPolicyId,
        aggregateType: "execution_policy",
        idempotencyKey: input.idempotencyKey,
        payload: {
          basedOnRoomSeq: input.basedOnRoomSeq,
          contentDigest,
          executionPolicyId,
          executionPolicyRevisionId,
          revision: 1,
        },
        roomId: input.controlRoomId,
        type: "policy.created",
      });
      return { deduplicated: false, event, policy };
    });
  }

  reviseExecutionPolicy(
    actor: AuthenticatedActorContext,
    input: ExecutionPolicyContent & {
      basedOnRoomSeq: number;
      executionPolicyId: string;
      idempotencyKey: string;
    },
  ): ExecutionPolicyMutationResult {
    return this.#transaction(() => {
      const policyRow = this.#requireExecutionPolicyRow(
        input.executionPolicyId,
      );
      const controlRoomId = text(policyRow, "control_room_id");
      const actorId = this.#requireHumanControlActor(actor, controlRoomId);
      this.#assertIdempotencyKey(input.idempotencyKey);
      const content = normalizeExecutionPolicyContent(input);
      const contentDigest = canonicalDigest(content);
      const previous = findRoomEventByIdempotencyKey(
        this.#database,
        controlRoomId,
        input.idempotencyKey,
      );
      if (previous !== undefined) {
        const event = this.#assertControlEventReplay(previous, {
          actorId,
          aggregateId: input.executionPolicyId,
          contentDigest,
          eventType: "policy.revised",
        });
        return {
          deduplicated: true,
          event,
          policy: this.#executionPolicyRevisionFromRow(
            this.#requireExecutionPolicyRevisionRow(
              eventPayloadText(event, "executionPolicyRevisionId"),
            ),
          ),
        };
      }
      this.#assertFreshContext(controlRoomId, actorId, input.basedOnRoomSeq);
      const currentRevision = this.#executionPolicyRevisionFromRow(
        this.#requireExecutionPolicyRevisionRow(
          text(policyRow, "current_revision_id"),
        ),
      );
      const revision = currentRevision.revision + 1;
      const executionPolicyRevisionId = this.#createId(
        "execution_policy_revision",
      );
      const createdAt = this.#timestamp();
      const policy = ExecutionPolicyRevisionSchema.parse({
        ...content,
        contentDigest,
        controlRoomId,
        createdAt,
        createdBy: actorId,
        executionPolicyId: input.executionPolicyId,
        executionPolicyRevisionId,
        revision,
      });
      this.#insertExecutionPolicyRevision(policy);
      this.#database
        .prepare(
          "UPDATE execution_policies SET current_revision_id = ?, updated_at = ? WHERE execution_policy_id = ?",
        )
        .run(executionPolicyRevisionId, createdAt, input.executionPolicyId);
      const event = this.#appendEvent({
        actorId,
        aggregateId: input.executionPolicyId,
        aggregateType: "execution_policy",
        idempotencyKey: input.idempotencyKey,
        payload: {
          basedOnRoomSeq: input.basedOnRoomSeq,
          contentDigest,
          executionPolicyId: input.executionPolicyId,
          executionPolicyRevisionId,
          revision,
        },
        roomId: controlRoomId,
        type: "policy.revised",
      });
      return { deduplicated: false, event, policy };
    });
  }

  getExecutionPolicy(executionPolicyId: string): ExecutionPolicyRecord {
    const row = this.#requireExecutionPolicyRow(executionPolicyId);
    return {
      currentRevision: this.#executionPolicyRevisionFromRow(
        this.#requireExecutionPolicyRevisionRow(
          text(row, "current_revision_id"),
        ),
      ),
    };
  }

  getExecutionPolicyRevision(
    executionPolicyRevisionId: string,
  ): ExecutionPolicyRevision {
    return this.#executionPolicyRevisionFromRow(
      this.#requireExecutionPolicyRevisionRow(executionPolicyRevisionId),
    );
  }

  createAgentDefinition(
    actor: AuthenticatedActorContext,
    input: AgentDefinitionContent & {
      basedOnRoomSeq: number;
      controlRoomId: string;
      idempotencyKey: string;
      participantId: string;
    },
  ): AgentDefinitionMutationResult {
    return this.#transaction(() => {
      const actorId = this.#requireHumanControlActor(
        actor,
        input.controlRoomId,
      );
      this.#assertIdempotencyKey(input.idempotencyKey);
      this.#requireAgentParticipant(input.participantId);
      this.#requireMember(input.controlRoomId, input.participantId);
      requireExecutionPolicyRevisionControlRoom(
        this.#database,
        input.executionPolicyRevisionId,
        input.controlRoomId,
      );
      const content = normalizeAgentDefinitionContent(input);
      const contentDigest = canonicalDigest(content);
      const previous = findRoomEventByIdempotencyKey(
        this.#database,
        input.controlRoomId,
        input.idempotencyKey,
      );
      if (previous !== undefined) {
        const event = this.#assertControlEventReplay(previous, {
          actorId,
          contentDigest,
          eventType: "agent.created",
          payload: { participantId: input.participantId },
        });
        return this.#agentDefinitionMutationReplay(event);
      }
      this.#assertFreshContext(
        input.controlRoomId,
        actorId,
        input.basedOnRoomSeq,
      );
      const agentDefinitionId = this.#createId("agent_definition");
      const agentDefinitionRevisionId = this.#createId(
        "agent_definition_revision",
      );
      const createdAt = this.#timestamp();
      const definition = AgentDefinitionSchema.parse({
        agentDefinitionId,
        controlRoomId: input.controlRoomId,
        createdAt,
        currentRevisionId: agentDefinitionRevisionId,
        participantId: input.participantId,
        state: "enabled",
        updatedAt: createdAt,
      });
      const revision = AgentDefinitionRevisionSchema.parse({
        ...content,
        agentDefinitionId,
        agentDefinitionRevisionId,
        contentDigest,
        createdAt,
        createdBy: actorId,
        revision: 1,
      });
      this.#database
        .prepare(
          "INSERT INTO agent_definitions(agent_definition_id, participant_id, control_room_id, state, current_revision_id, created_at, updated_at) VALUES(?, ?, ?, 'enabled', ?, ?, ?)",
        )
        .run(
          agentDefinitionId,
          input.participantId,
          input.controlRoomId,
          agentDefinitionRevisionId,
          createdAt,
          createdAt,
        );
      this.#insertAgentDefinitionRevision(revision);
      const event = this.#appendEvent({
        actorId,
        aggregateId: agentDefinitionId,
        aggregateType: "agent_definition",
        idempotencyKey: input.idempotencyKey,
        payload: {
          agentDefinitionId,
          agentDefinitionRevisionId,
          basedOnRoomSeq: input.basedOnRoomSeq,
          contentDigest,
          participantId: input.participantId,
          revision: 1,
        },
        roomId: input.controlRoomId,
        type: "agent.created",
      });
      return { deduplicated: false, definition, event, revision };
    });
  }

  reviseAgentDefinition(
    actor: AuthenticatedActorContext,
    input: AgentDefinitionContent & {
      agentDefinitionId: string;
      basedOnRoomSeq: number;
      idempotencyKey: string;
    },
  ): AgentDefinitionMutationResult {
    return this.#transaction(() => {
      const definitionRow = this.#requireAgentDefinitionRow(
        input.agentDefinitionId,
      );
      const controlRoomId = text(definitionRow, "control_room_id");
      const actorId = this.#requireHumanControlActor(actor, controlRoomId);
      this.#assertIdempotencyKey(input.idempotencyKey);
      requireExecutionPolicyRevisionControlRoom(
        this.#database,
        input.executionPolicyRevisionId,
        controlRoomId,
      );
      const content = normalizeAgentDefinitionContent(input);
      const contentDigest = canonicalDigest(content);
      const previous = findRoomEventByIdempotencyKey(
        this.#database,
        controlRoomId,
        input.idempotencyKey,
      );
      if (previous !== undefined) {
        const event = this.#assertControlEventReplay(previous, {
          actorId,
          aggregateId: input.agentDefinitionId,
          contentDigest,
          eventType: "agent.revised",
        });
        return this.#agentDefinitionMutationReplay(event);
      }
      this.#assertFreshContext(controlRoomId, actorId, input.basedOnRoomSeq);
      const currentRevision = this.#agentDefinitionRevisionFromRow(
        this.#requireAgentDefinitionRevisionRow(
          text(definitionRow, "current_revision_id"),
        ),
      );
      const revisionNumber = currentRevision.revision + 1;
      const agentDefinitionRevisionId = this.#createId(
        "agent_definition_revision",
      );
      const createdAt = this.#timestamp();
      const revision = AgentDefinitionRevisionSchema.parse({
        ...content,
        agentDefinitionId: input.agentDefinitionId,
        agentDefinitionRevisionId,
        contentDigest,
        createdAt,
        createdBy: actorId,
        revision: revisionNumber,
      });
      this.#insertAgentDefinitionRevision(revision);
      this.#database
        .prepare(
          "UPDATE agent_definitions SET current_revision_id = ?, updated_at = ? WHERE agent_definition_id = ?",
        )
        .run(agentDefinitionRevisionId, createdAt, input.agentDefinitionId);
      const definition = this.#agentDefinitionFromRow(
        this.#requireAgentDefinitionRow(input.agentDefinitionId),
      );
      const event = this.#appendEvent({
        actorId,
        aggregateId: input.agentDefinitionId,
        aggregateType: "agent_definition",
        idempotencyKey: input.idempotencyKey,
        payload: {
          agentDefinitionId: input.agentDefinitionId,
          agentDefinitionRevisionId,
          basedOnRoomSeq: input.basedOnRoomSeq,
          contentDigest,
          revision: revisionNumber,
        },
        roomId: controlRoomId,
        type: "agent.revised",
      });
      return { deduplicated: false, definition, event, revision };
    });
  }

  provisionWorkspaceAgent(
    actor: AuthenticatedActorContext,
    input: WorkspaceAgentProvisionInput,
  ): WorkspaceAgentProvisionResult {
    return this.#transaction(() =>
      provisionWorkspaceAgentTransaction(
        {
          actorId: this.#requireHumanControlActor(actor, input.controlRoomId),
          createId: this.#createId,
          database: this.#database,
          events: this.#roomEvents,
          now: this.#now,
        },
        input,
      ),
    );
  }
  manageWorkspaceAgent(
    actor: AuthenticatedActorContext,
    rawInput: WorkspaceAgentManagementInput,
  ): WorkspaceAgentManagementResult {
    const input = ClientAgentManageRequestSchema.parse(rawInput);
    return this.#transaction(() => {
      const actorId = this.#requireAuthenticatedActor(actor);
      const current =
        input.action === "update_profile" && input.field === "avatarKey"
          ? getWorkspaceAgentManagementView(
              this.#database,
              actorId,
              input.agentDefinitionId,
            ).agent.currentRevision.avatarKey
          : undefined;
      if (input.action === "update_profile" && input.field === "avatarKey") {
        this.profileImages.bindReference(
          actorId,
          input.value,
          input.avatarUploadIntentId,
        );
      }
      const result = manageWorkspaceAgentTransaction(
        {
          actorId,
          createId: this.#createId,
          database: this.#database,
          events: this.#roomEvents,
          now: this.#now,
        },
        input,
      );
      if (input.action === "update_profile" && input.field === "avatarKey") {
        this.profileImages.releaseReference(current, input.value);
      }
      return result;
    });
  }
  getWorkspaceAgentManagementView(
    actor: AuthenticatedActorContext,
    agentDefinitionId: string,
  ) {
    return getWorkspaceAgentManagementView(
      this.#database,
      this.#requireAuthenticatedActor(actor),
      agentDefinitionId,
    );
  }
  listAgentCatalog(
    actor: AuthenticatedActorContext,
    input: { controlRoomId?: string } = {},
  ): AgentCatalogEntry[] {
    return ar.listAgentCatalog(
      this.#database,
      this.#requireAuthenticatedActor(actor),
      input.controlRoomId,
    );
  }
  listAgentPresence(
    actor: AuthenticatedActorContext,
    input: { controlRoomId: string },
  ) {
    const now = this.#now();
    return {
      observedAt: now.toISOString(),
      agents: this.listAgentCatalog(actor, input).map((agent) =>
        readAgentPresence(this.#database, agent, now),
      ),
    };
  }
  onboardAgentToRoom(
    actor: AuthenticatedActorContext,
    input: {
      agentDefinitionId: string;
      basedOnRoomSeq: number;
      idempotencyKey: string;
      roomId: string;
    },
  ): RoomMembershipMutationResult {
    return this.#transaction(() => {
      const actorId = this.#requireAuthenticatedActor(actor);
      const principal = principalProfile.fromRow(
        this.#requirePrincipal(actorId),
      );
      if (principal.kind !== "human") {
        throw new ForbiddenError(
          "Agent onboarding requires an authenticated Human principal",
        );
      }
      const definition = this.#agentDefinitionFromRow(
        this.#requireAgentDefinitionRow(input.agentDefinitionId),
      );
      this.#requireMember(definition.controlRoomId, actorId);
      this.#collaboration.requireSameWorkspace(
        definition.controlRoomId,
        input.roomId,
      );
      if (definition.state !== "enabled") {
        throw new ConflictError(
          `AgentDefinition ${input.agentDefinitionId} is not enabled`,
        );
      }
      return this.#collaboration.addRoomMember(principal, {
        basedOnRoomSeq: input.basedOnRoomSeq,
        idempotencyKey: input.idempotencyKey,
        principalId: definition.participantId,
        role: "member",
        roomId: input.roomId,
      });
    });
  }

  publishRuntimeOffer(
    host: AuthenticatedHostContext,
    untrustedOffer: RuntimeOffer,
  ): RuntimeOfferProjection {
    return publishRuntimeOfferTransaction(
      {
        clockSkewMs: this.#runtimeOfferClockSkewMs,
        createId: this.#createId,
        database: this.#database,
        maxTtlMs: this.#runtimeOfferMaxTtlMs,
        now: this.#now,
        requireAuthenticatedHost: (candidate) =>
          this.#requireAuthenticatedHost(candidate),
        requireRuntimeOfferRow: (runtimeOfferId) =>
          this.#requireRuntimeOfferRow(runtimeOfferId),
        resolveTrustedEvidence: (offer) =>
          this.#resolveTrustedRuntimeOfferEvidence(offer),
        transaction: (operation) => this.#transaction(operation),
      },
      host,
      untrustedOffer,
    );
  }
  getRuntimeOfferObservation(
    runtimeOfferObservationId: string,
  ): RuntimeOfferProjection {
    return runtimeOfferObservationFromId(
      this.#database,
      runtimeOfferObservationId,
    );
  }

  runtimeOfferIsCurrentlyAvailable(runtimeOfferId: string): boolean {
    return runtimeOfferIsAvailable({
      database: this.#database,
      evidenceIsTrusted: (offer) =>
        this.#runtimeOfferEvidenceIsCurrentlyTrusted(offer),
      nowMs: this.#now().getTime(),
      offerFromRow: (row) => this.#runtimeOfferFromRow(row),
      runtimeOfferId,
    });
  }

  acquireAgentExclusiveOperationLease(
    host: AuthenticatedHostContext,
    input: AgentExclusiveOperationAcquireInput,
  ) {
    return this.#agentExclusiveOperations.acquire(host, input);
  }

  renewAgentExclusiveOperationLease(
    host: AuthenticatedHostContext,
    input: AgentExclusiveOperationRenewInput,
  ) {
    return this.#agentExclusiveOperations.renew(host, input);
  }

  releaseAgentExclusiveOperationLease(
    host: AuthenticatedHostContext,
    input: AgentExclusiveOperationReleaseInput,
  ) {
    return this.#agentExclusiveOperations.release(host, input);
  }

  getAgentExclusiveOperationLease(operationId: string) {
    return this.#agentExclusiveOperations.get(operationId);
  }

  scheduleNextPlacement(input: {
    leaseMs: number;
    schedulerVersion?: string;
  }): PlacementDecision | null {
    if (!Number.isInteger(input.leaseMs) || input.leaseMs <= 0) {
      throw new Error("leaseMs must be a positive integer");
    }
    const schedulerVersion = input.schedulerVersion ?? "placement-planner/v1";
    return this.#transaction(() => {
      const now = this.#now();
      const participantIds = this.#database
        .prepare(
          "SELECT participant_id FROM agent_definitions ORDER BY participant_id",
        )
        .all()
        .map((row) => text(row, "participant_id"));
      this.#reconcileUnownedRuntimeProcesses(participantIds, now);
      this.#quarantineExpiredActiveRuns(participantIds, now);
      this.#reconcileProvenActivationQuarantines(participantIds);
      this.#releaseExpiredReservedPlacements(now);
      const plannerInput = this.#buildPlacementPlannerInput(
        now,
        schedulerVersion,
      );
      const planned = planNextPlacement(plannerInput);
      if (planned.selection === undefined) return null;

      const selection = planned.selection;
      const activation = this.#requireActivationRow(selection.activationId);
      if (
        text(activation, "state") !== "queued" ||
        integer(activation, "available_at_ms") > now.getTime()
      ) {
        throw new ConflictError(
          `Activation ${selection.activationId} is no longer schedulable`,
        );
      }
      const offer = this.#runtimeOfferFromRow(
        this.#requireRuntimeOfferRow(selection.runtimeOfferId),
      );
      if (
        offer.hostId !== selection.hostId ||
        offer.hostInstanceId !== selection.hostInstanceId ||
        offer.runtimeOfferObservationId !==
          selection.runtimeOfferObservationId ||
        offer.runtimeOfferSnapshotDigest !==
          selection.runtimeOfferSnapshotDigest ||
        Date.parse(offer.leaseUntil) <= now.getTime()
      ) {
        throw new ConflictError(
          `RuntimeOffer ${selection.runtimeOfferId} is no longer current`,
        );
      }
      const placementId = this.#createId("placement");
      const leaseUntil = new Date(
        Math.min(now.getTime() + input.leaseMs, Date.parse(offer.leaseUntil)),
      );
      const attemptNumber = integer(activation, "attempt_count") + 1;
      const placement = PlacementDecisionSchema.parse({
        ...selection,
        createdAt: now.toISOString(),
        leaseUntil: leaseUntil.toISOString(),
        placementId,
        state: "reserved",
      });
      this.#database
        .prepare(
          `INSERT INTO placements(placement_id, activation_id, activation_attempt_number, room_id, participant_id, agent_definition_revision_id, execution_policy_revision_id, host_id, host_instance_id, runtime_offer_id, runtime_offer_observation_id, runtime_offer_snapshot_digest, runtime_profile_id, runtime_profile_revision_id, workspace_mount_revision_id, workspace_mode, state, lease_until, lease_until_ms, decision_json, created_at, updated_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?)`,
        )
        .run(
          placementId,
          placement.activationId,
          attemptNumber,
          placement.roomId,
          placement.participantId,
          placement.agentDefinitionRevisionId,
          placement.executionPolicyRevisionId,
          placement.hostId,
          placement.hostInstanceId,
          placement.runtimeOfferId,
          offer.runtimeOfferObservationId,
          offer.runtimeOfferSnapshotDigest,
          offer.runtimeProfileId,
          placement.runtimeProfileRevisionId,
          placement.workspaceMountRevisionId,
          placement.workspaceMode,
          placement.leaseUntil,
          leaseUntil.getTime(),
          JSON.stringify(placement),
          placement.createdAt,
          placement.createdAt,
        );
      this.#reservePlacementResources(placement, offer);
      this.#database
        .prepare(
          "UPDATE activations SET state = 'leased', lease_owner = ?, lease_until = ?, lease_until_ms = ?, attempt_count = ?, updated_at = ? WHERE activation_id = ?",
        )
        .run(
          placement.hostId,
          placement.leaseUntil,
          leaseUntil.getTime(),
          attemptNumber,
          placement.createdAt,
          placement.activationId,
        );
      const event = this.#appendEvent({
        actorId: SYSTEM_PRINCIPAL_ID,
        aggregateId: placementId,
        aggregateType: "placement",
        idempotencyKey: `placement.reserve:${placementId}`,
        payload: {
          activationId: placement.activationId,
          agentDefinitionRevisionId: placement.agentDefinitionRevisionId,
          attemptNumber,
          executionPolicyRevisionId: placement.executionPolicyRevisionId,
          hostId: placement.hostId,
          hostInstanceId: placement.hostInstanceId,
          leaseUntil: placement.leaseUntil,
          placementId,
          runtimeOfferId: placement.runtimeOfferId,
        },
        roomId: placement.roomId,
        type: "placement.reserved",
      });
      this.#insertOutbox({
        payload: {
          hostId: placement.hostId,
          hostInstanceId: placement.hostInstanceId,
          placementId,
        },
        roomId: placement.roomId,
        roomSeq: event.roomSeq,
        topic: "placement.ready",
      });
      return placement;
    });
  }

  pullNextPlacement(host: AuthenticatedHostContext): PlacementDecision | null {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    const row = nextUnfencedReservedPlacement(
      this.#database,
      authenticatedHost.hostId,
      authenticatedHost.instanceId,
      this.#now().getTime(),
    );
    return row === undefined ? null : this.#placementFromRow(row);
  }

  claimNextPlacement(
    host: AuthenticatedHostContext,
    input: { leaseMs: number },
  ): PlacementLaunchClaim | null {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    if (!Number.isInteger(input.leaseMs) || input.leaseMs <= 0) {
      throw new Error("leaseMs must be a positive integer");
    }
    return this.#transaction(() => {
      this.#requireAuthenticatedHost(authenticatedHost);
      const now = this.#now();
      const placementRow = nextUnfencedReservedPlacement(
        this.#database,
        authenticatedHost.hostId,
        authenticatedHost.instanceId,
        now.getTime(),
      );
      if (placementRow === undefined) return null;

      const activationId = text(placementRow, "activation_id");
      const activationRow = this.#requireActivationRow(activationId);
      this.#requireHostParticipant(
        authenticatedHost,
        text(activationRow, "participant_id"),
      );
      this.#requireActivationLease(activationRow, authenticatedHost.hostId);
      this.#requireActivationHostGeneration(activationRow, authenticatedHost);
      if (
        integer(placementRow, "activation_attempt_number") !==
        integer(activationRow, "attempt_count")
      ) {
        throw new LeaseConflictError(
          `Placement ${text(placementRow, "placement_id")} no longer matches its Activation attempt`,
        );
      }

      const leaseUntil = new Date(now.getTime() + input.leaseMs);
      this.#database
        .prepare(
          "UPDATE activations SET lease_until = ?, lease_until_ms = ?, updated_at = ? WHERE activation_id = ?",
        )
        .run(
          leaseUntil.toISOString(),
          leaseUntil.getTime(),
          now.toISOString(),
          activationId,
        );
      const runAttempt = this.#createRunAttemptInTransaction(
        authenticatedHost,
        activationId,
      );
      const consumedPlacement = this.#database
        .prepare("SELECT * FROM placements WHERE placement_id = ?")
        .get(text(placementRow, "placement_id"));
      if (consumedPlacement === undefined) {
        throw new NotFoundError("claimed Placement disappeared");
      }
      return {
        activation: activationProjectionFromRow(
          this.#requireActivationRow(activationId),
        ),
        agentContext: agentRuntimeContextFromPlacement(
          this.#database,
          consumedPlacement,
        ),
        placement: this.#placementFromRow(consumedPlacement),
        runAttempt,
      };
    });
  }

  listPlacements(input: { roomId?: string } = {}): PlacementDecision[] {
    const rows =
      input.roomId === undefined
        ? this.#database
            .prepare(
              "SELECT * FROM placements ORDER BY created_at, placement_id",
            )
            .all()
        : this.#database
            .prepare(
              "SELECT * FROM placements WHERE room_id = ? ORDER BY created_at, placement_id",
            )
            .all(input.roomId);
    return rows.map((row) => this.#placementFromRow(row));
  }

  heartbeatHost(
    host: AuthenticatedHostContext,
    input: {
      buildVersion?: string;
      processId?: number;
      protocolVersion?: number;
      state?: "online" | "draining" | "offline";
      takeoverAfterMs?: number;
    } = {},
  ): HostRecord {
    const authenticatedHost = this.#requireAuthenticatedHostCredential(host);
    const hostId = authenticatedHost.hostId;
    const participantIds = authorizedHostParticipantIds(
      this.#database,
      authenticatedHost,
    );
    const state = input.state ?? "online";
    if (
      input.takeoverAfterMs !== undefined &&
      (!Number.isInteger(input.takeoverAfterMs) || input.takeoverAfterMs <= 0)
    ) {
      throw new Error("takeoverAfterMs must be a positive integer");
    }
    if (
      input.processId !== undefined &&
      (!Number.isInteger(input.processId) || input.processId <= 0)
    ) {
      throw new Error("processId must be a positive integer");
    }
    if (
      input.protocolVersion !== undefined &&
      (!Number.isInteger(input.protocolVersion) || input.protocolVersion <= 0)
    ) {
      throw new Error("protocolVersion must be a positive integer");
    }
    return this.#transaction(() => {
      for (const participantId of participantIds) {
        const principal = principalProfile.fromRow(
          this.#requirePrincipal(participantId),
        );
        if (principal.kind !== "agent") {
          throw new Error(
            `host participant ${participantId} must be an Agent principal`,
          );
        }
      }
      const now = this.#now();
      const existing = this.#database
        .prepare("SELECT * FROM agent_hosts WHERE host_id = ?")
        .get(hostId);
      if (
        existing !== undefined &&
        text(existing, "instance_id") !== authenticatedHost.instanceId &&
        text(existing, "state") !== "offline" &&
        (input.takeoverAfterMs === undefined ||
          integer(existing, "last_seen_ms") + input.takeoverAfterMs >
            now.getTime())
      ) {
        throw new ConflictError(
          `Host ${hostId} already has an active daemon instance`,
        );
      }
      this.#database
        .prepare(
          `INSERT INTO agent_hosts(host_id, credential_id, instance_id, build_version, protocol_version, process_id, participant_ids_json, state, created_at, last_seen_at, last_seen_ms)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(host_id) DO UPDATE SET
             credential_id = excluded.credential_id,
             instance_id = excluded.instance_id,
             build_version = COALESCE(excluded.build_version, agent_hosts.build_version),
             protocol_version = COALESCE(excluded.protocol_version, agent_hosts.protocol_version),
             process_id = COALESCE(excluded.process_id, agent_hosts.process_id),
             participant_ids_json = excluded.participant_ids_json,
             state = excluded.state,
             last_seen_at = excluded.last_seen_at,
             last_seen_ms = excluded.last_seen_ms`,
        )
        .run(
          hostId,
          authenticatedHost.credentialId,
          authenticatedHost.instanceId,
          input.buildVersion ?? null,
          input.protocolVersion ?? null,
          input.processId ?? null,
          JSON.stringify(participantIds),
          state,
          now.toISOString(),
          now.toISOString(),
          now.getTime(),
        );
      return hostProjectionFromRow(this.#requireHostRow(hostId));
    });
  }

  listHosts(): HostRecord[] {
    return this.#database
      .prepare("SELECT * FROM agent_hosts ORDER BY host_id")
      .all()
      .map((row) => hostProjectionFromRow(row));
  }

  createRunAttempt(
    host: AuthenticatedHostContext,
    input: { activationId: string },
  ): RunAttempt {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    return this.#transaction(() =>
      this.#createRunAttemptInTransaction(
        authenticatedHost,
        input.activationId,
      ),
    );
  }

  prepareRunAttemptRuntime(
    host: AuthenticatedHostContext,
    input: {
      recoveryDescriptor: RuntimeRecoveryDescriptor;
      runAttemptId: string;
      runtimeRunId: string;
    },
  ): RuntimeProcessRecord {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    const hostId = authenticatedHost.hostId;
    const recoveryDescriptor = RuntimeRecoveryDescriptorSchema.parse(
      input.recoveryDescriptor,
    );
    if (input.runtimeRunId.trim().length === 0) {
      throw new Error("runtimeRunId is required");
    }
    return this.#transaction(() => {
      const runAttempt = this.#requireRunAttemptRow(input.runAttemptId);
      this.#requireHostParticipant(
        authenticatedHost,
        text(runAttempt, "participant_id"),
      );
      this.#requireRunAttemptOwner(runAttempt, hostId);
      this.#requireRunAttemptHostGeneration(runAttempt, authenticatedHost);
      if (text(runAttempt, "state") !== "starting") {
        throw new ConflictError(
          `run attempt ${input.runAttemptId} is not starting`,
        );
      }
      const existing = this.#database
        .prepare("SELECT * FROM runtime_processes WHERE run_attempt_id = ?")
        .get(input.runAttemptId);
      if (existing) {
        if (
          text(existing, "state") === "prepared" &&
          text(existing, "launch_host_id") === hostId &&
          text(existing, "runtime_run_id") === input.runtimeRunId &&
          text(existing, "recovery_driver") === recoveryDescriptor.driver &&
          text(existing, "recovery_descriptor_json") ===
            JSON.stringify(recoveryDescriptor)
        ) {
          return this.#runtimeProcessFromRow(existing);
        }
        throw new ConflictError(
          `run attempt ${input.runAttemptId} already has a different runtime`,
        );
      }

      const registeredAt = this.#timestamp();
      const runtimeProcessId = this.#createId("runtime_process");
      this.#database
        .prepare(
          "INSERT INTO runtime_processes(runtime_process_id, run_attempt_id, activation_id, room_id, participant_id, launch_host_id, runtime_run_id, recovery_driver, recovery_descriptor_json, state, registered_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)",
        )
        .run(
          runtimeProcessId,
          input.runAttemptId,
          text(runAttempt, "activation_id"),
          text(runAttempt, "room_id"),
          text(runAttempt, "participant_id"),
          hostId,
          input.runtimeRunId,
          recoveryDescriptor.driver,
          JSON.stringify(recoveryDescriptor),
          registeredAt,
          registeredAt,
        );
      this.#appendEvent({
        actorId: SYSTEM_PRINCIPAL_ID,
        aggregateId: input.runAttemptId,
        aggregateType: "run_attempt",
        idempotencyKey: `run.runtime_prepare:${input.runAttemptId}`,
        payload: {
          activationId: text(runAttempt, "activation_id"),
          hostId,
          recoveryDriver: recoveryDescriptor.driver,
          runAttemptId: input.runAttemptId,
          runtimeRunId: input.runtimeRunId,
        },
        roomId: text(runAttempt, "room_id"),
        type: "run.runtime_prepared",
      });
      return this.#runtimeProcessFromRow(
        this.#requireRuntimeProcessById(runtimeProcessId),
      );
    });
  }

  appendRunTrajectory(
    host: AuthenticatedHostContext,
    untrustedInput: RuntimeTrajectoryAppendInput,
  ): RuntimeTrajectoryRecord {
    return this.#runtimeTrajectory.append(host, untrustedInput);
  }
  markRunAttemptRunning(
    host: AuthenticatedHostContext,
    input: {
      recoveryDescriptor: RuntimeRecoveryDescriptor;
      runAttemptId: string;
      runtimeRunId: string;
    },
  ): RunAttempt {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    const hostId = authenticatedHost.hostId;
    const recoveryDescriptor = RuntimeRecoveryDescriptorSchema.parse(
      input.recoveryDescriptor,
    );
    return this.#transaction(() => {
      const row = this.#requireRunAttemptRow(input.runAttemptId);
      this.#requireHostParticipant(
        authenticatedHost,
        text(row, "participant_id"),
      );
      this.#requireRunAttemptOwner(row, hostId);
      this.#requireRunAttemptHostGeneration(row, authenticatedHost);
      const runtimeProcess = this.#database
        .prepare("SELECT * FROM runtime_processes WHERE run_attempt_id = ?")
        .get(input.runAttemptId);
      const transition = classifyRunAttemptRuntimeStart({
        hostId,
        recoveryDescriptorJson: JSON.stringify(recoveryDescriptor),
        recoveryDriver: recoveryDescriptor.driver,
        runAttemptState: text(row, "state"),
        runtimeProcess,
        runtimeRunId: input.runtimeRunId,
      });
      if (transition === "replay") return this.#runAttemptFromRow(row);
      if (transition === "invalid_run_state") {
        throw new ConflictError(
          `run attempt ${input.runAttemptId} is not starting`,
        );
      }
      if (transition !== "ready" || runtimeProcess === undefined) {
        throw new ConflictError(
          `run attempt ${input.runAttemptId} has no matching prepared runtime`,
        );
      }
      const updatedAt = this.#timestamp();
      this.#database
        .prepare(
          "UPDATE run_attempts SET state = 'running', runtime_run_id = ? WHERE run_attempt_id = ?",
        )
        .run(input.runtimeRunId, input.runAttemptId);
      this.#database
        .prepare(
          "UPDATE runtime_processes SET state = 'active', updated_at = ? WHERE runtime_process_id = ?",
        )
        .run(updatedAt, text(runtimeProcess, "runtime_process_id"));
      this.#appendEvent({
        actorId: SYSTEM_PRINCIPAL_ID,
        aggregateId: input.runAttemptId,
        aggregateType: "run_attempt",
        idempotencyKey: `run.start:${input.runAttemptId}`,
        payload: {
          activationId: text(row, "activation_id"),
          hostId,
          recoveryDriver: recoveryDescriptor.driver,
          runAttemptId: input.runAttemptId,
          runtimeRunId: input.runtimeRunId,
        },
        roomId: text(row, "room_id"),
        type: "run.started",
      });
      return this.#runAttemptFromRow(
        this.#requireRunAttemptRow(input.runAttemptId),
      );
    });
  }

  finishRunAttempt(
    host: AuthenticatedHostContext,
    input: {
      error?: string;
      exitCode?: number;
      exitSignal?: string;
      runAttemptId: string;
      state: "exited" | "failed" | "cancelled" | "timed_out";
    },
  ): RunAttempt {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    return this.#transaction(() => {
      const row = this.#requireRunAttemptRow(input.runAttemptId);
      this.#requireHostParticipant(
        authenticatedHost,
        text(row, "participant_id"),
      );
      this.#requireRunAttemptOwner(row, authenticatedHost.hostId);
      this.#requireRunAttemptHostGeneration(row, authenticatedHost);
      const currentState = text(row, "state");
      if (currentState !== "starting" && currentState !== "running") {
        return this.#runAttemptFromRow(row);
      }
      const runtimeProcess = this.#database
        .prepare("SELECT * FROM runtime_processes WHERE run_attempt_id = ?")
        .get(input.runAttemptId);
      if (
        runtimeProcess !== undefined &&
        text(runtimeProcess, "state") !== "terminated"
      ) {
        throw new RuntimeTerminationProofError(
          `RunAttempt ${input.runAttemptId} still has a non-terminal RuntimeProcess`,
        );
      }
      const finishedAt = this.#timestamp();
      this.#database
        .prepare(
          "UPDATE run_attempts SET state = ?, exit_code = ?, exit_signal = ?, error = ?, finished_at = ? WHERE run_attempt_id = ?",
        )
        .run(
          input.state,
          input.exitCode ?? null,
          input.exitSignal ?? null,
          input.error ?? null,
          finishedAt,
          input.runAttemptId,
        );
      const placementId = nullableText(row, "placement_id");
      if (placementId !== null) {
        const placement = this.#requirePlacementRow(placementId);
        if (text(placement, "state") !== "released") {
          this.#setPlacementState(
            placement,
            "released",
            `RunAttempt finished ${input.state}`,
          );
          this.#releasePlacementResources(placementId);
        }
      }
      this.#appendEvent({
        actorId: SYSTEM_PRINCIPAL_ID,
        aggregateId: input.runAttemptId,
        aggregateType: "run_attempt",
        idempotencyKey: `run.finish:${input.runAttemptId}`,
        payload: {
          runAttemptId: input.runAttemptId,
          state: input.state,
          ...(placementId === null ? {} : { placementId }),
          ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
          ...(input.exitSignal === undefined
            ? {}
            : { exitSignal: input.exitSignal }),
          ...(input.error === undefined ? {} : { error: input.error }),
        },
        roomId: text(row, "room_id"),
        type: "run.finished",
      });
      return this.#runAttemptFromRow(
        this.#requireRunAttemptRow(input.runAttemptId),
      );
    });
  }

  listRunAttempts(input: { roomId?: string } = {}): RunAttempt[] {
    const rows = input.roomId
      ? this.#database
          .prepare(
            "SELECT * FROM run_attempts WHERE room_id = ? ORDER BY started_at, run_attempt_id",
          )
          .all(input.roomId)
      : this.#database
          .prepare(
            "SELECT * FROM run_attempts ORDER BY started_at, run_attempt_id",
          )
          .all();
    return rows.map((row) => this.#runAttemptFromRow(row));
  }

  listRuntimeProcesses(
    input: { roomId?: string } = {},
  ): RuntimeProcessRecord[] {
    const rows = input.roomId
      ? this.#database
          .prepare(
            "SELECT * FROM runtime_processes WHERE room_id = ? ORDER BY registered_at, runtime_process_id",
          )
          .all(input.roomId)
      : this.#database
          .prepare(
            "SELECT * FROM runtime_processes ORDER BY registered_at, runtime_process_id",
          )
          .all();
    return rows.map((row) => this.#runtimeProcessFromRow(row));
  }

  leaseNextRuntimeRecovery(
    host: AuthenticatedHostContext,
    input: { driverIds: string[]; leaseMs: number },
  ): RuntimeProcessRecord | null {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    const recoveryHostId = authenticatedHost.hostId;
    if (!Number.isInteger(input.leaseMs) || input.leaseMs <= 0) {
      throw new Error("leaseMs must be a positive integer");
    }
    const driverIds = [
      ...new Set(input.driverIds.map((driverId) => driverId.trim())),
    ].filter((driverId) => driverId.length > 0);
    const participantIds = authorizedHostParticipantIds(
      this.#database,
      authenticatedHost,
    );
    if (driverIds.length === 0 || participantIds.length === 0) return null;

    return this.#transaction(() => {
      const now = this.#now();
      const nowMs = now.getTime();
      const driverPlaceholders = driverIds.map(() => "?").join(", ");
      const participantPlaceholders = participantIds.map(() => "?").join(", ");
      const candidate = this.#database
        .prepare(
          `SELECT * FROM runtime_processes
           WHERE state = 'orphaned'
             AND participant_id IN (${participantPlaceholders})
             AND recovery_driver IN (${driverPlaceholders})
             AND recovery_available_at_ms <= ?
             AND (recovery_lease_owner IS NULL OR recovery_lease_until_ms <= ?)
           ORDER BY registered_at, runtime_process_id
           LIMIT 1`,
        )
        .get(...participantIds, ...driverIds, nowMs, nowMs);
      if (!candidate) return null;

      const runtimeProcessId = text(candidate, "runtime_process_id");
      const attemptCount = integer(candidate, "recovery_attempt_count") + 1;
      const leaseUntil = new Date(nowMs + input.leaseMs);
      this.#database
        .prepare(
          "UPDATE runtime_processes SET recovery_lease_owner = ?, recovery_lease_owner_instance_id = ?, recovery_lease_until = ?, recovery_lease_until_ms = ?, recovery_attempt_count = ?, recovery_last_error = NULL, updated_at = ? WHERE runtime_process_id = ?",
        )
        .run(
          recoveryHostId,
          authenticatedHost.instanceId,
          leaseUntil.toISOString(),
          leaseUntil.getTime(),
          attemptCount,
          now.toISOString(),
          runtimeProcessId,
        );
      this.#appendEvent({
        actorId: SYSTEM_PRINCIPAL_ID,
        aggregateId: runtimeProcessId,
        aggregateType: "runtime_process",
        idempotencyKey: `runtime_process.recovery_lease:${runtimeProcessId}:${String(attemptCount)}`,
        payload: {
          recoveryAttemptCount: attemptCount,
          recoveryHostId,
          runtimeProcessId,
        },
        roomId: text(candidate, "room_id"),
        type: "runtime_process.recovery_leased",
      });
      return this.#runtimeProcessFromRow(
        this.#requireRuntimeProcessById(runtimeProcessId),
      );
    });
  }

  renewRuntimeRecoveryLease(
    host: AuthenticatedHostContext,
    input: {
      leaseMs: number;
      recoveryAttemptCount: number;
      runtimeProcessId: string;
    },
  ): RuntimeProcessRecord {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    const recoveryHostId = authenticatedHost.hostId;
    if (!Number.isInteger(input.leaseMs) || input.leaseMs <= 0) {
      throw new Error("leaseMs must be a positive integer");
    }
    if (
      !Number.isInteger(input.recoveryAttemptCount) ||
      input.recoveryAttemptCount <= 0
    ) {
      throw new Error("recoveryAttemptCount must be a positive integer");
    }
    return this.#transaction(() => {
      const row = this.#requireRuntimeProcessById(input.runtimeProcessId);
      this.#requireHostParticipant(
        authenticatedHost,
        text(row, "participant_id"),
      );
      if (
        text(row, "state") !== "orphaned" ||
        nullableText(row, "recovery_lease_owner") !== recoveryHostId ||
        nullableText(row, "recovery_lease_owner_instance_id") !==
          authenticatedHost.instanceId ||
        integer(row, "recovery_attempt_count") !== input.recoveryAttemptCount ||
        (nullableInteger(row, "recovery_lease_until_ms") ?? 0) <=
          this.#now().getTime()
      ) {
        throw new LeaseConflictError(
          `recovery host ${recoveryHostId} does not own recovery attempt ${String(input.recoveryAttemptCount)} for ${input.runtimeProcessId}`,
        );
      }
      const now = this.#now();
      const leaseUntil = new Date(now.getTime() + input.leaseMs);
      this.#database
        .prepare(
          "UPDATE runtime_processes SET recovery_lease_until = ?, recovery_lease_until_ms = ?, updated_at = ? WHERE runtime_process_id = ?",
        )
        .run(
          leaseUntil.toISOString(),
          leaseUntil.getTime(),
          now.toISOString(),
          input.runtimeProcessId,
        );
      return this.#runtimeProcessFromRow(
        this.#requireRuntimeProcessById(input.runtimeProcessId),
      );
    });
  }

  recordRecoveredRuntimeTermination(
    host: AuthenticatedHostContext,
    input: {
      exit: { code: number | null; signal?: string };
      recoveryAttemptCount: number;
      runtimeProcessId: string;
    },
  ): RuntimeProcessRecord {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    const recoveryHostId = authenticatedHost.hostId;
    this.#validateRunExit(input.exit);
    return this.#transaction(() => {
      const row = this.#requireRuntimeProcessById(input.runtimeProcessId);
      this.#requireHostParticipant(
        authenticatedHost,
        text(row, "participant_id"),
      );
      if (text(row, "state") === "terminated") {
        return this.#assertMatchingRuntimeTermination(row, input.exit);
      }
      if (
        text(row, "state") !== "orphaned" ||
        nullableText(row, "recovery_lease_owner") !== recoveryHostId ||
        nullableText(row, "recovery_lease_owner_instance_id") !==
          authenticatedHost.instanceId ||
        integer(row, "recovery_attempt_count") !== input.recoveryAttemptCount ||
        (nullableInteger(row, "recovery_lease_until_ms") ?? 0) <=
          this.#now().getTime()
      ) {
        throw new LeaseConflictError(
          `recovery host ${recoveryHostId} does not own an active recovery lease for ${input.runtimeProcessId}`,
        );
      }
      return this.#persistRuntimeTermination(row, input.exit, {
        recoveryHostId,
      });
    });
  }

  retryRuntimeRecovery(
    host: AuthenticatedHostContext,
    input: {
      error: string;
      recoveryAttemptCount: number;
      retryAfterMs: number;
      runtimeProcessId: string;
    },
  ): RuntimeProcessRecord {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    const recoveryHostId = authenticatedHost.hostId;
    if (!Number.isInteger(input.retryAfterMs) || input.retryAfterMs < 0) {
      throw new Error("retryAfterMs must be a non-negative integer");
    }
    const error = input.error.trim();
    if (error.length === 0) throw new Error("recovery error is required");
    return this.#transaction(() => {
      const row = this.#requireRuntimeProcessById(input.runtimeProcessId);
      this.#requireHostParticipant(
        authenticatedHost,
        text(row, "participant_id"),
      );
      if (
        text(row, "state") !== "orphaned" ||
        nullableText(row, "recovery_lease_owner") !== recoveryHostId ||
        nullableText(row, "recovery_lease_owner_instance_id") !==
          authenticatedHost.instanceId ||
        integer(row, "recovery_attempt_count") !== input.recoveryAttemptCount ||
        (nullableInteger(row, "recovery_lease_until_ms") ?? 0) <=
          this.#now().getTime()
      ) {
        throw new LeaseConflictError(
          `recovery host ${recoveryHostId} does not own an active recovery lease for ${input.runtimeProcessId}`,
        );
      }
      const now = this.#now();
      this.#database
        .prepare(
          "UPDATE runtime_processes SET recovery_available_at_ms = ?, recovery_lease_owner = NULL, recovery_lease_owner_instance_id = NULL, recovery_lease_until = NULL, recovery_lease_until_ms = NULL, recovery_last_error = ?, updated_at = ? WHERE runtime_process_id = ?",
        )
        .run(
          now.getTime() + input.retryAfterMs,
          error,
          now.toISOString(),
          input.runtimeProcessId,
        );
      this.#appendEvent({
        actorId: SYSTEM_PRINCIPAL_ID,
        aggregateId: input.runtimeProcessId,
        aggregateType: "runtime_process",
        idempotencyKey: `runtime_process.recovery_retry:${input.runtimeProcessId}:${integer(row, "recovery_attempt_count")}`,
        payload: {
          error,
          recoveryHostId,
          retryAfterMs: input.retryAfterMs,
          runtimeProcessId: input.runtimeProcessId,
        },
        roomId: text(row, "room_id"),
        type: "runtime_process.recovery_retry_scheduled",
      });
      return this.#runtimeProcessFromRow(
        this.#requireRuntimeProcessById(input.runtimeProcessId),
      );
    });
  }

  recordRuntimeTermination(
    host: AuthenticatedHostContext,
    input: {
      exit: { code: number | null; signal?: string };
      runAttemptId: string;
      runtimeRunId: string;
    },
  ): RuntimeProcessRecord {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    const hostId = authenticatedHost.hostId;
    this.#validateRunExit(input.exit);
    return this.#transaction(() => {
      const row = this.#requireRuntimeProcessRow(input.runAttemptId);
      this.#requireHostParticipant(
        authenticatedHost,
        text(row, "participant_id"),
      );
      this.#requireRunAttemptHostGeneration(
        this.#requireRunAttemptRow(text(row, "run_attempt_id")),
        authenticatedHost,
      );
      if (
        text(row, "launch_host_id") !== hostId ||
        text(row, "runtime_run_id") !== input.runtimeRunId
      ) {
        throw new ExecutionFencedError(
          "runtime termination proof does not match the launched execution",
        );
      }
      if (text(row, "state") === "terminated") {
        return this.#assertMatchingRuntimeTermination(row, input.exit);
      }
      return this.#persistRuntimeTermination(row, input.exit, {
        hostId,
      });
    });
  }

  authorizeWorkerExecution(
    host: AuthenticatedHostContext,
    uncheckedScope: ActivationCredentialScope,
  ): AuthenticatedWorkerExecutionContext {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    const scope = ActivationCredentialScopeSchema.parse(uncheckedScope);
    if (scope.hostId !== authenticatedHost.hostId) {
      throw new ForbiddenError(
        "worker execution scope must belong to the authenticated Host",
      );
    }
    this.#requireHostParticipant(authenticatedHost, scope.participantId);
    this.#transaction(() => {
      const { runAttempt } = this.#assertWorkerGrantScope(scope);
      this.#requireRunAttemptHostGeneration(runAttempt, authenticatedHost);
    });
    return issueAuthenticatedWorkerExecutionContext(
      authenticatedHost.credentialId,
      authenticatedHost.instanceId,
      scope,
    );
  }

  leaseNextOutbox(input: {
    dispatcherId: string;
    leaseMs: number;
    topics?: string[];
  }): OutboxEntry | null {
    if (input.dispatcherId.trim().length === 0) {
      throw new Error("dispatcherId is required");
    }
    if (!Number.isInteger(input.leaseMs) || input.leaseMs <= 0) {
      throw new Error("leaseMs must be a positive integer");
    }
    const topics =
      input.topics === undefined
        ? undefined
        : [...new Set(input.topics.map((topic) => topic.trim()))];
    if (topics !== undefined && (topics.length === 0 || topics.includes(""))) {
      throw new Error("topics must contain at least one non-empty topic");
    }
    return this.#transaction(() => {
      const now = this.#now();
      const nowMs = now.getTime();
      const candidate = this.#database
        .prepare(
          `SELECT * FROM outbox
           WHERE published_at IS NULL
             AND available_at_ms <= ?
             AND (lease_owner IS NULL OR lease_until_ms <= ?)
             ${topics === undefined ? "" : `AND topic IN (${topics.map(() => "?").join(", ")})`}
           ORDER BY outbox_seq
           LIMIT 1`,
        )
        .get(nowMs, nowMs, ...(topics ?? []));
      if (!candidate) return null;

      const outboxId = text(candidate, "outbox_id");
      const attemptCount = integer(candidate, "attempt_count") + 1;
      const leaseUntil = new Date(nowMs + input.leaseMs).toISOString();
      this.#database
        .prepare(
          "UPDATE outbox SET lease_owner = ?, lease_until = ?, lease_until_ms = ?, attempt_count = ?, last_error = NULL WHERE outbox_id = ?",
        )
        .run(
          input.dispatcherId,
          leaseUntil,
          nowMs + input.leaseMs,
          attemptCount,
          outboxId,
        );
      return outboxProjectionFromRow(this.#requireOutboxRow(outboxId));
    });
  }

  acknowledgeOutboxPublished(input: {
    dispatcherId: string;
    outboxId: string;
  }): OutboxEntry {
    return this.#transaction(() => {
      const row = this.#requireOutboxRow(input.outboxId);
      if (nullableText(row, "published_at") !== null) {
        return outboxProjectionFromRow(row);
      }
      this.#requireOutboxLease(row, input.dispatcherId);
      this.#database
        .prepare(
          "UPDATE outbox SET published_at = ?, lease_owner = NULL, lease_until = NULL, lease_until_ms = NULL, last_error = NULL WHERE outbox_id = ?",
        )
        .run(this.#timestamp(), input.outboxId);
      return outboxProjectionFromRow(this.#requireOutboxRow(input.outboxId));
    });
  }

  retryOutbox(input: {
    dispatcherId: string;
    error: string;
    outboxId: string;
    retryAfterMs: number;
  }): OutboxEntry {
    if (!Number.isInteger(input.retryAfterMs) || input.retryAfterMs < 0) {
      throw new Error("retryAfterMs must be a non-negative integer");
    }
    const error = input.error.trim();
    if (error.length === 0) throw new Error("retry error is required");
    return this.#transaction(() => {
      const row = this.#requireOutboxRow(input.outboxId);
      this.#requireOutboxLease(row, input.dispatcherId);
      this.#database
        .prepare(
          "UPDATE outbox SET available_at_ms = ?, lease_owner = NULL, lease_until = NULL, lease_until_ms = NULL, last_error = ? WHERE outbox_id = ?",
        )
        .run(this.#now().getTime() + input.retryAfterMs, error, input.outboxId);
      return outboxProjectionFromRow(this.#requireOutboxRow(input.outboxId));
    });
  }

  leaseNextActivation(
    host: AuthenticatedHostContext,
    input: { leaseMs: number },
  ): Activation | null {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    const hostId = authenticatedHost.hostId;
    if (!Number.isInteger(input.leaseMs) || input.leaseMs <= 0) {
      throw new Error("leaseMs must be a positive integer");
    }
    const participantIds = authorizedHostParticipantIds(
      this.#database,
      authenticatedHost,
    );
    if (participantIds.length === 0) return null;

    return this.#transaction(() => {
      const now = this.#now();
      const nowMs = now.getTime();
      expireHeldMessageDraftsAt(this.#database, now);
      this.#reconcileUnownedRuntimeProcesses(participantIds, now);
      this.#quarantineExpiredActiveRuns(participantIds, now);
      this.#reconcileProvenActivationQuarantines(participantIds);
      const candidate = nextUnfencedActivation(
        this.#database,
        memoryHomeEligibleParticipants(this.#database, hostId, participantIds),
        nowMs,
      );
      if (!candidate) return null;

      const activationId = text(candidate, "activation_id");
      const attemptCount = integer(candidate, "attempt_count") + 1;
      const leaseUntil = new Date(nowMs + input.leaseMs);
      const updatedAt = now.toISOString();
      this.#database
        .prepare(
          "UPDATE activations SET state = 'leased', lease_owner = ?, lease_until = ?, lease_until_ms = ?, attempt_count = ?, updated_at = ? WHERE activation_id = ?",
        )
        .run(
          hostId,
          leaseUntil.toISOString(),
          leaseUntil.getTime(),
          attemptCount,
          updatedAt,
          activationId,
        );

      const roomId = text(candidate, "room_id");
      this.#appendEvent({
        actorId: SYSTEM_PRINCIPAL_ID,
        aggregateId: activationId,
        aggregateType: "activation",
        idempotencyKey: `activation.lease:${activationId}:${attemptCount}`,
        payload: {
          activationId,
          attemptCount,
          hostId,
          leaseUntil: leaseUntil.toISOString(),
        },
        roomId,
        type: "activation.leased",
      });
      return activationProjectionFromRow(
        this.#requireActivationRow(activationId),
      );
    });
  }

  renewActivationLease(
    host: AuthenticatedHostContext,
    input: { activationId: string; leaseMs: number },
  ): Activation {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    if (!Number.isInteger(input.leaseMs) || input.leaseMs <= 0) {
      throw new Error("leaseMs must be a positive integer");
    }
    return this.#transaction(() => {
      const row = this.#requireActivationRow(input.activationId);
      this.#requireHostParticipant(
        authenticatedHost,
        text(row, "participant_id"),
      );
      this.#requireActivationLease(row, authenticatedHost.hostId);
      this.#requireActivationHostGeneration(row, authenticatedHost);
      const cancellation = unresolvedActivationCancellation(
        this.#database,
        row,
      );
      if (cancellation !== undefined) {
        throw new ActivationCancellationRequestedError(
          text(cancellation, "reason"),
        );
      }
      requireAgentExecutionEnabled(this.#database, text(row, "participant_id"));
      const now = this.#now();
      const leaseUntil = new Date(now.getTime() + input.leaseMs);
      this.#database
        .prepare(
          "UPDATE activations SET lease_until = ?, lease_until_ms = ?, updated_at = ? WHERE activation_id = ?",
        )
        .run(
          leaseUntil.toISOString(),
          leaseUntil.getTime(),
          now.toISOString(),
          input.activationId,
        );
      return activationProjectionFromRow(
        this.#requireActivationRow(input.activationId),
      );
    });
  }

  resolveActivationCancellation(
    host: AuthenticatedHostContext,
    input: { activationId: string },
  ): Activation {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    return this.#transaction(() => {
      const row = this.#requireActivationRow(input.activationId);
      this.#requireHostParticipant(
        authenticatedHost,
        text(row, "participant_id"),
      );
      this.#requireActivationLease(row, authenticatedHost.hostId);
      this.#requireActivationHostGeneration(row, authenticatedHost);
      return activationProjectionFromRow(
        resolveActivationCancellationTransaction({
          activation: row,
          database: this.#database,
          events: this.#roomEvents,
          now: this.#now(),
          systemPrincipalId: SYSTEM_PRINCIPAL_ID,
        }),
      );
    });
  }

  quarantineActivation(
    host: AuthenticatedHostContext,
    input: { activationId: string; error: string },
  ): Activation {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    const error = input.error.trim();
    if (error.length === 0) throw new Error("quarantine error is required");
    return this.#transaction(() => {
      const row = this.#requireActivationRow(input.activationId);
      this.#requireHostParticipant(
        authenticatedHost,
        text(row, "participant_id"),
      );
      if (
        text(row, "state") === "quarantined" &&
        nullableText(row, "last_error") === error
      ) {
        return activationProjectionFromRow(row);
      }
      this.#requireActivationLease(row, authenticatedHost.hostId);
      this.#requireActivationHostGeneration(row, authenticatedHost);
      const updatedAt = this.#timestamp();
      const activeRunAttempts = this.#database
        .prepare(
          "SELECT * FROM run_attempts WHERE activation_id = ? AND state IN ('starting', 'running') ORDER BY attempt_number",
        )
        .all(input.activationId);
      for (const runAttempt of activeRunAttempts) {
        const runAttemptId = text(runAttempt, "run_attempt_id");
        this.#database
          .prepare(
            "UPDATE run_attempts SET state = 'orphaned', error = ?, finished_at = ? WHERE run_attempt_id = ?",
          )
          .run(error, updatedAt, runAttemptId);
        this.#appendEvent({
          actorId: SYSTEM_PRINCIPAL_ID,
          aggregateId: runAttemptId,
          aggregateType: "run_attempt",
          idempotencyKey: `run.orphan:${runAttemptId}`,
          payload: {
            activationId: input.activationId,
            error,
            runAttemptId,
          },
          roomId: text(row, "room_id"),
          type: "run.orphaned",
        });
      }
      this.#database
        .prepare(
          "UPDATE activations SET state = 'quarantined', lease_owner = NULL, lease_until = NULL, lease_until_ms = NULL, last_error = ?, updated_at = ? WHERE activation_id = ?",
        )
        .run(error, updatedAt, input.activationId);
      this.#database
        .prepare(
          "UPDATE runtime_processes SET state = 'orphaned', updated_at = ? WHERE activation_id = ? AND state IN ('prepared', 'active')",
        )
        .run(updatedAt, input.activationId);
      this.#appendEvent({
        actorId: SYSTEM_PRINCIPAL_ID,
        aggregateId: input.activationId,
        aggregateType: "activation",
        idempotencyKey: `activation.quarantine:${input.activationId}:${integer(row, "attempt_count")}`,
        payload: {
          activationId: input.activationId,
          error,
          hostId: authenticatedHost.hostId,
        },
        roomId: text(row, "room_id"),
        type: "activation.quarantined",
      });
      return activationProjectionFromRow(
        this.#requireActivationRow(input.activationId),
      );
    });
  }

  resolveActivationQuarantine(
    host: AuthenticatedHostContext,
    input: { activationId: string },
  ): Activation {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    return this.#transaction(() => {
      const row = this.#requireActivationRow(input.activationId);
      this.#requireHostParticipant(
        authenticatedHost,
        text(row, "participant_id"),
      );
      return this.#resolveProvenActivationQuarantine(row, {
        resolverHostId: authenticatedHost.hostId,
      });
    });
  }

  retryActivation(
    host: AuthenticatedHostContext,
    input: {
      activationId: string;
      error: string;
      retryAfterMs: number;
      retryDisposition?: RuntimeRetryDisposition;
    },
  ): Activation {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    if (!Number.isInteger(input.retryAfterMs) || input.retryAfterMs < 0) {
      throw new Error("retryAfterMs must be a non-negative integer");
    }
    const error = input.error.trim();
    if (error.length === 0) throw new Error("retry error is required");
    return this.#transaction(() => {
      const row = this.#requireActivationRow(input.activationId);
      this.#requireHostParticipant(
        authenticatedHost,
        text(row, "participant_id"),
      );
      const unprovenRuntime = this.#database
        .prepare(
          "SELECT runtime_process_id FROM runtime_processes WHERE activation_id = ? AND state <> 'terminated' LIMIT 1",
        )
        .get(input.activationId);
      if (unprovenRuntime !== undefined) {
        throw new RuntimeTerminationProofError(
          `activation ${input.activationId} has a RuntimeProcess without terminal proof`,
        );
      }
      if (
        text(row, "state") === "queued" &&
        nullableText(row, "last_error") === error
      ) {
        return activationProjectionFromRow(row);
      }
      this.#requireActivationLease(row, authenticatedHost.hostId);
      this.#requireActivationHostGeneration(row, authenticatedHost);
      const activeRunAttempt = this.#database
        .prepare(
          "SELECT run_attempt_id FROM run_attempts WHERE activation_id = ? AND state IN ('starting', 'running') ORDER BY attempt_number DESC LIMIT 1",
        )
        .get(input.activationId);
      if (activeRunAttempt !== undefined) {
        throw new RuntimeTerminationProofError(
          `activation ${input.activationId} has an unfinished RunAttempt ${text(activeRunAttempt, "run_attempt_id")}`,
        );
      }
      const activePlacement = this.#database
        .prepare(
          "SELECT * FROM placements WHERE activation_id = ? AND state IN ('reserved', 'consumed') ORDER BY created_at DESC, placement_id DESC LIMIT 1",
        )
        .get(input.activationId);
      if (activePlacement !== undefined) {
        const placementId = text(activePlacement, "placement_id");
        this.#setPlacementState(activePlacement, "released", error);
        this.#releasePlacementResources(placementId);
      }

      const followUp = this.#database
        .prepare(
          "SELECT * FROM activations WHERE room_id = ? AND participant_id = ? AND state = 'queued' AND activation_id <> ?",
        )
        .get(
          text(row, "room_id"),
          text(row, "participant_id"),
          input.activationId,
        );
      let fromSeq = integer(row, "from_seq");
      let toSeq = integer(row, "to_seq");
      let mergedActivationId: string | undefined;
      if (followUp) {
        fromSeq = Math.min(fromSeq, integer(followUp, "from_seq"));
        toSeq = Math.max(toSeq, integer(followUp, "to_seq"));
        mergedActivationId = text(followUp, "activation_id");
        this.#database
          .prepare(
            "UPDATE activations SET state = 'cancelled', last_error = ?, updated_at = ? WHERE activation_id = ?",
          )
          .run(
            `merged into retry ${input.activationId}`,
            this.#timestamp(),
            mergedActivationId,
          );
      }

      const now = this.#now();
      applyActivationRetryPolicy(this.#database, this.#roomEvents, {
        activationId: input.activationId,
        attemptCount: integer(row, "attempt_count"),
        error,
        fromSeq,
        hostId: authenticatedHost.hostId,
        ...(mergedActivationId === undefined ? {} : { mergedActivationId }),
        now,
        participantId: text(row, "participant_id"),
        retryAfterMs: input.retryAfterMs,
        ...(input.retryDisposition === undefined
          ? {}
          : { retryDisposition: input.retryDisposition }),
        roomId: text(row, "room_id"),
        systemPrincipalId: SYSTEM_PRINCIPAL_ID,
        toSeq,
      });
      return activationProjectionFromRow(
        this.#requireActivationRow(input.activationId),
      );
    });
  }

  completeActivation(
    host: AuthenticatedHostContext,
    input: { activationId: string; consumerId: string },
  ): Activation {
    const authenticatedHost = this.#requireAuthenticatedHost(host);
    return this.#transaction(() => {
      const row = this.#requireActivationRow(input.activationId);
      this.#requireHostParticipant(
        authenticatedHost,
        text(row, "participant_id"),
      );
      if (input.consumerId.trim().length === 0) {
        throw new Error("consumerId is required");
      }
      if (text(row, "state") === "completed") {
        this.#requireActivationHostGeneration(row, authenticatedHost);
        return activationProjectionFromRow(row);
      }
      this.#requireActivationLease(row, authenticatedHost.hostId);
      this.#requireActivationHostGeneration(row, authenticatedHost);
      const cursor = this.#database
        .prepare(
          "SELECT last_seq FROM subscription_cursors WHERE room_id = ? AND participant_id = ? AND consumer_id = ?",
        )
        .get(
          text(row, "room_id"),
          text(row, "participant_id"),
          input.consumerId,
        );
      const acknowledgedThrough = cursor ? integer(cursor, "last_seq") : 0;
      const requiredThrough = integer(row, "to_seq");
      if (acknowledgedThrough < requiredThrough) {
        throw new DeliveryProofError(
          `activation delivery is not acknowledged through sequence ${requiredThrough}`,
        );
      }
      const unverifiedRuntime = this.#database
        .prepare(
          "SELECT runtime_process_id FROM runtime_processes WHERE activation_id = ? AND state <> 'terminated' LIMIT 1",
        )
        .get(input.activationId);
      if (unverifiedRuntime) {
        throw new RuntimeTerminationProofError(
          `activation ${input.activationId} has a runtime without terminal proof`,
        );
      }
      this.#activationObligations.assertSatisfied(input.activationId);
      const updatedAt = this.#timestamp();
      resolveActivationRetryFence(this.#database, {
        activationId: input.activationId,
        resolutionKind: "progress",
        resolvedAt: updatedAt,
      });
      this.#database
        .prepare(
          "UPDATE activations SET state = 'completed', lease_owner = NULL, lease_until = NULL, lease_until_ms = NULL, updated_at = ? WHERE activation_id = ?",
        )
        .run(updatedAt, input.activationId);
      this.#appendEvent({
        actorId: SYSTEM_PRINCIPAL_ID,
        aggregateId: input.activationId,
        aggregateType: "activation",
        idempotencyKey: `activation.complete:${input.activationId}`,
        payload: {
          activationId: input.activationId,
          consumerId: input.consumerId,
          hostId: authenticatedHost.hostId,
        },
        roomId: text(row, "room_id"),
        type: "activation.finished",
      });
      return activationProjectionFromRow(
        this.#requireActivationRow(input.activationId),
      );
    });
  }

  acknowledgeInboxThrough(
    actor: AuthenticatedActorContext,
    input: { roomId: string; throughSeq: number },
  ): void {
    this.#transaction(() => {
      const participantId = this.#requireAuthenticatedActor(actor);
      this.#requireMember(input.roomId, participantId);
      if (!Number.isInteger(input.throughSeq) || input.throughSeq <= 0) {
        throw new Error("throughSeq must be a positive integer");
      }
      const acknowledgedAt = this.#timestamp();
      const result = this.#database
        .prepare(
          "UPDATE inbox_items SET state = 'acknowledged', acknowledged_at = ? WHERE room_id = ? AND participant_id = ? AND event_seq <= ? AND state = 'pending'",
        )
        .run(acknowledgedAt, input.roomId, participantId, input.throughSeq);
      if (Number(result.changes) === 0) return;
      this.#appendEvent({
        actorId: participantId,
        aggregateId: participantId,
        aggregateType: "inbox",
        idempotencyKey: `inbox.ack:${participantId}:${input.throughSeq}`,
        payload: {
          participantId,
          throughSeq: input.throughSeq,
        },
        roomId: input.roomId,
        type: "inbox.acknowledged",
      });
    });
  }

  acknowledgeCursor(
    actor: AuthenticatedActorContext,
    input: { consumerId: string; roomId: string; throughSeq: number },
  ): void {
    this.#transaction(() => {
      const participantId = this.#requireAuthenticatedActor(actor);
      this.#acknowledgeCursorForParticipant(participantId, input);
    });
  }

  acknowledgeWorkerCursor(
    execution: AuthenticatedWorkerExecutionContext,
    input: { throughSeq: number },
  ): void {
    this.#transaction(() => {
      const scope = this.#requireAuthenticatedWorkerExecution(execution);
      this.#acknowledgeCursorForParticipant(scope.participantId, {
        consumerId: scope.consumerId,
        roomId: scope.roomId,
        throughSeq: input.throughSeq,
      });
    });
  }

  sync(
    actor: AuthenticatedActorContext,
    input: {
      bootstrap?: "latest";
      consumerId: string;
      roomId: string;
      afterSeq?: number;
      limit?: number;
      throughSeq?: number;
    },
  ): SyncResult {
    return this.#transaction(() => {
      const participantId = this.#requireAuthenticatedActor(actor);
      return this.#syncForParticipant(participantId, input);
    });
  }

  syncWorker(
    execution: AuthenticatedWorkerExecutionContext,
    input: { afterSeq?: number; limit?: number },
  ): SyncResult {
    return this.#transaction(() => {
      const scope = this.#requireAuthenticatedWorkerExecution(execution);
      return this.#syncForParticipant(scope.participantId, {
        ...input,
        consumerId: scope.consumerId,
        roomId: scope.roomId,
        throughSeq: scope.toSeq,
      });
    });
  }

  #acknowledgeCursorForParticipant(
    participantId: string,
    input: { consumerId: string; roomId: string; throughSeq: number },
  ): void {
    this.#requireMember(input.roomId, participantId);
    if (input.consumerId.trim().length === 0) {
      throw new Error("consumerId is required");
    }
    if (!Number.isInteger(input.throughSeq) || input.throughSeq < 0) {
      throw new Error("throughSeq must be a non-negative integer");
    }
    const roomRow = this.#requireRoom(input.roomId);
    const latestRoomSeq = integer(roomRow, "next_seq") - 1;
    if (input.throughSeq > latestRoomSeq) {
      throw new Error("throughSeq cannot exceed the latest Room sequence");
    }
    this.#database
      .prepare(
        `INSERT INTO subscription_cursors(room_id, participant_id, consumer_id, last_seq, updated_at)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(room_id, participant_id, consumer_id) DO UPDATE SET
           last_seq = MAX(subscription_cursors.last_seq, excluded.last_seq),
           updated_at = excluded.updated_at`,
      )
      .run(
        input.roomId,
        participantId,
        input.consumerId,
        input.throughSeq,
        this.#timestamp(),
      );
  }

  #syncForParticipant(
    participantId: string,
    input: {
      bootstrap?: "latest";
      consumerId: string;
      roomId: string;
      afterSeq?: number;
      limit?: number;
      throughSeq?: number;
    },
  ): SyncResult {
    this.#requireMember(input.roomId, participantId);
    return syncRoomEventWindow(this.#database, participantId, input, {
      eventFromRow: (row) => this.#eventFromRow(row),
      snapshot: (roomId) => this.#snapshot(roomId),
    });
  }

  #appendEvent(input: AppendRoomEventInput): RoomEvent {
    return this.#roomEvents.append(input);
  }
  #taskIntentContext() {
    return {
      assertFreshContext: this.#assertFreshContext.bind(this),
      createId: this.#createId,
      database: this.#database,
      events: this.#roomEvents,
      now: this.#now,
    };
  }
  #insertOutbox(input: {
    payload: Record<string, unknown>;
    roomId: string;
    roomSeq: number;
    topic: string;
  }): void {
    this.#roomEvents.insertOutbox(input);
  }

  #deriveAttention(
    event: RoomEvent,
    recipients: MessageRecipient[],
    createdAt: string,
  ): string[] {
    return this.#roomEvents.deriveAttention(event, recipients, createdAt);
  }

  #insertInboxItem(input: {
    createdAt: string;
    event: RoomEvent;
    participantId: string;
    reason: ActivationReason;
  }): void {
    this.#roomEvents.insertInboxItem(input);
  }

  #transitionOwnedTask(
    execution: AuthenticatedWorkerExecutionContext,
    input: {
      basedOnRoomSeq: number;
      eventType: "task.progressed" | "task.started";
      expectedState: "claimed" | "in_progress";
      extraPayload?: Record<string, unknown>;
      idempotencyKey: string;
      lastProgress?: string;
      leaseMs: number;
      nextState: "in_progress";
      taskId: string;
    },
  ): TaskMutationResult {
    return this.#transaction(() => {
      const scope = this.#requireAuthenticatedWorkerExecution(execution);
      const taskRow = this.#requireWorkerTask(scope, input.taskId);
      const replay = this.#replayWorkerTaskCommand(taskRow, scope, {
        eventType: input.eventType,
        idempotencyKey: input.idempotencyKey,
        ...(input.extraPayload === undefined
          ? {}
          : { payload: input.extraPayload }),
      });
      if (replay !== null) return replay;
      this.#assertPositiveTaskLease(input.leaseMs);
      assertWorkerTaskFreshContext(
        this.#database,
        scope,
        input.basedOnRoomSeq,
        input.taskId,
      );
      requireOwnedTaskClaim(
        taskRow,
        scope.participantId,
        input.expectedState,
        this.#now().getTime(),
      );

      const now = this.#now();
      const updatedAt = now.toISOString();
      const claimUntil = new Date(now.getTime() + input.leaseMs).toISOString();
      if (input.lastProgress === undefined) {
        this.#database
          .prepare(
            "UPDATE tasks SET state = ?, claim_until = ?, claim_until_ms = ?, updated_at = ? WHERE task_id = ?",
          )
          .run(
            input.nextState,
            claimUntil,
            now.getTime() + input.leaseMs,
            updatedAt,
            input.taskId,
          );
      } else {
        this.#database
          .prepare(
            "UPDATE tasks SET state = ?, claim_until = ?, claim_until_ms = ?, last_progress = ?, updated_at = ? WHERE task_id = ?",
          )
          .run(
            input.nextState,
            claimUntil,
            now.getTime() + input.leaseMs,
            input.lastProgress,
            updatedAt,
            input.taskId,
          );
      }
      const reply =
        input.lastProgress === undefined
          ? undefined
          : createTaskThreadReply(this.#database, this.#createId, taskRow, {
              actorId: scope.participantId,
              body: input.lastProgress,
              createdAt: updatedAt,
              roomId: scope.roomId,
            });
      const event = this.#appendWorkerTaskEvent(scope, {
        basedOnRoomSeq: input.basedOnRoomSeq,
        eventType: input.eventType,
        idempotencyKey: input.idempotencyKey,
        payload: {
          claimUntil,
          ...(input.extraPayload ?? {}),
          ...(reply ?? {}),
        },
        taskId: input.taskId,
      });
      return {
        deduplicated: false,
        event,
        task: this.#taskFromRow(this.#requireTaskRow(input.taskId)),
      };
    });
  }

  #replayWorkerTaskCommand(
    taskRow: Row,
    scope: ActivationCredentialScope,
    input: {
      eventType:
        | "task.blocked"
        | "task.claimed"
        | "task.progressed"
        | "task.released"
        | "task.started"
        | "task.submitted";
      idempotencyKey: string;
      payload?: Record<string, unknown>;
    },
  ): TaskMutationResult | null {
    const roomId = text(taskRow, "room_id");
    const previous = findRoomEventByIdempotencyKey(
      this.#database,
      roomId,
      input.idempotencyKey,
    );
    if (previous === undefined) return null;
    const event = assertTaskEventReplay(this.#eventFromRow(previous), {
      actorId: scope.participantId,
      aggregateId: text(taskRow, "task_id"),
      eventType: input.eventType,
      payload: input.payload ?? {},
    });
    return {
      deduplicated: true,
      event,
      task: this.#taskFromRow(this.#requireTaskRow(text(taskRow, "task_id"))),
    };
  }

  #appendWorkerTaskEvent(
    scope: ActivationCredentialScope,
    input: {
      basedOnRoomSeq: number;
      eventType:
        | "task.blocked"
        | "task.claimed"
        | "task.progressed"
        | "task.released"
        | "task.started"
        | "task.submitted";
      idempotencyKey: string;
      payload: Record<string, unknown>;
      taskId: string;
    },
  ): RoomEvent {
    return this.#appendEvent({
      actorId: scope.participantId,
      aggregateId: input.taskId,
      aggregateType: "task",
      idempotencyKey: input.idempotencyKey,
      payload: {
        basedOnRoomSeq: input.basedOnRoomSeq,
        runAttemptId: scope.runAttemptId,
        taskId: input.taskId,
        ...input.payload,
      },
      roomId: scope.roomId,
      type: input.eventType,
    });
  }

  #requireWorkerTask(scope: ActivationCredentialScope, taskId: string): Row {
    return requireWorkerTaskDelivery(this.#database, scope, taskId);
  }

  #assertPositiveTaskLease(leaseMs: number): void {
    if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
      throw new Error("leaseMs must be a positive integer");
    }
  }

  #requireHumanControlActor(
    actor: AuthenticatedActorContext,
    controlRoomId: string,
  ): string {
    const actorId = this.#requireAuthenticatedActor(actor);
    requireHumanControlRoomManager(this.#database, controlRoomId, actorId);
    return actorId;
  }

  #requireAgentParticipant(participantId: string): void {
    if (
      principalProfile.fromRow(this.#requirePrincipal(participantId)).kind !==
      "agent"
    ) {
      throw new ForbiddenError(
        `principal ${participantId} is not an Agent participant`,
      );
    }
  }

  #assertIdempotencyKey(idempotencyKey: string): void {
    if (idempotencyKey.trim().length === 0) {
      throw new Error("idempotencyKey is required");
    }
  }

  #assertControlEventReplay(
    row: Row,
    expected: {
      actorId: string;
      aggregateId?: string;
      contentDigest: string;
      eventType:
        "agent.created" | "agent.revised" | "policy.created" | "policy.revised";
      payload?: Record<string, unknown>;
    },
  ): RoomEvent {
    const event = this.#eventFromRow(row);
    if (
      event.type !== expected.eventType ||
      event.actorId !== expected.actorId ||
      (expected.aggregateId !== undefined &&
        event.aggregateId !== expected.aggregateId) ||
      event.payload.contentDigest !== expected.contentDigest ||
      Object.entries(expected.payload ?? {}).some(
        ([key, value]) =>
          JSON.stringify(event.payload[key]) !== JSON.stringify(value),
      )
    ) {
      throw new IdempotencyConflictError(
        `idempotency key ${event.idempotencyKey} was already used for another mutation`,
      );
    }
    return event;
  }

  #insertExecutionPolicyRevision(policy: ExecutionPolicyRevision): void {
    this.#database
      .prepare(
        "INSERT INTO execution_policy_revisions(execution_policy_revision_id, execution_policy_id, control_room_id, revision, content_digest, policy_json, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        policy.executionPolicyRevisionId,
        policy.executionPolicyId,
        policy.controlRoomId,
        policy.revision,
        policy.contentDigest,
        JSON.stringify(policy),
        policy.createdBy,
        policy.createdAt,
      );
  }

  #insertAgentDefinitionRevision(revision: AgentDefinitionRevision): void {
    this.#database
      .prepare(
        "INSERT INTO agent_definition_revisions(agent_definition_revision_id, agent_definition_id, revision, content_digest, definition_json, execution_policy_revision_id, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        revision.agentDefinitionRevisionId,
        revision.agentDefinitionId,
        revision.revision,
        revision.contentDigest,
        JSON.stringify(revision),
        revision.executionPolicyRevisionId,
        revision.createdBy,
        revision.createdAt,
      );
  }

  #agentDefinitionMutationReplay(
    event: RoomEvent,
  ): AgentDefinitionMutationResult {
    const revision = this.#agentDefinitionRevisionFromRow(
      this.#requireAgentDefinitionRevisionRow(
        eventPayloadText(event, "agentDefinitionRevisionId"),
      ),
    );
    return {
      deduplicated: true,
      definition: this.#agentDefinitionFromRow(
        this.#requireAgentDefinitionRow(event.aggregateId),
      ),
      event,
      revision,
    };
  }

  #requireExecutionPolicyRow(executionPolicyId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM execution_policies WHERE execution_policy_id = ?")
      .get(executionPolicyId);
    if (row === undefined) {
      throw new NotFoundError(
        `execution policy ${executionPolicyId} was not found`,
      );
    }
    return row;
  }

  #requireExecutionPolicyRevisionRow(executionPolicyRevisionId: string): Row {
    const row = this.#database
      .prepare(
        "SELECT * FROM execution_policy_revisions WHERE execution_policy_revision_id = ?",
      )
      .get(executionPolicyRevisionId);
    if (row === undefined) {
      throw new NotFoundError(
        `execution policy revision ${executionPolicyRevisionId} was not found`,
      );
    }
    return row;
  }

  #executionPolicyRevisionFromRow(row: Row): ExecutionPolicyRevision {
    return ExecutionPolicyRevisionSchema.parse(jsonObject(row, "policy_json"));
  }

  #requireAgentDefinitionRow(agentDefinitionId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM agent_definitions WHERE agent_definition_id = ?")
      .get(agentDefinitionId);
    if (row === undefined) {
      throw new NotFoundError(
        `AgentDefinition ${agentDefinitionId} was not found`,
      );
    }
    return row;
  }

  #requireAgentDefinitionRevisionRow(agentDefinitionRevisionId: string): Row {
    const row = this.#database
      .prepare(
        "SELECT * FROM agent_definition_revisions WHERE agent_definition_revision_id = ?",
      )
      .get(agentDefinitionRevisionId);
    if (row === undefined) {
      throw new NotFoundError(
        `AgentDefinition revision ${agentDefinitionRevisionId} was not found`,
      );
    }
    return row;
  }

  #agentDefinitionFromRow(row: Row): AgentDefinition {
    return AgentDefinitionSchema.parse({
      agentDefinitionId: text(row, "agent_definition_id"),
      controlRoomId: text(row, "control_room_id"),
      createdAt: text(row, "created_at"),
      currentRevisionId: text(row, "current_revision_id"),
      participantId: text(row, "participant_id"),
      state: text(row, "state"),
      updatedAt: text(row, "updated_at"),
    });
  }

  #agentDefinitionRevisionFromRow(row: Row): AgentDefinitionRevision {
    return AgentDefinitionRevisionSchema.parse(
      jsonObject(row, "definition_json"),
    );
  }

  #requireRuntimeOfferRow(runtimeOfferId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM runtime_offers WHERE runtime_offer_id = ?")
      .get(runtimeOfferId);
    if (row === undefined) {
      throw new NotFoundError(`RuntimeOffer ${runtimeOfferId} was not found`);
    }
    return row;
  }

  #runtimeOfferFromRow(row: Row): RuntimeOfferProjection {
    return currentRuntimeOfferFromRow(row);
  }

  #resolveTrustedRuntimeOfferEvidence(
    offer: RuntimeOffer,
  ): RuntimeCertification[] {
    const referencedCertifications = offer.certificationRefs.map(
      (reference) => {
        const certification = this.#runtimeCertifications.get(
          reference.certificationId,
        );
        if (
          certification === undefined ||
          certification.certificationDigest !== reference.certificationDigest
        ) {
          throw new ConflictError(
            `RuntimeOffer ${offer.runtimeOfferId} references no trusted certification ${reference.certificationId}`,
          );
        }
        if (
          certification.protocolFamily !== offer.protocolFamily ||
          certification.runtimeProfileDigest !== offer.revisionDigest
        ) {
          throw new ConflictError(
            `RuntimeOffer ${offer.runtimeOfferId} trusted certification subject does not match its profile`,
          );
        }
        return certification;
      },
    );
    for (const evidence of offer.capabilityEvidence) {
      if (
        evidence.evidence === "certified" &&
        !referencedCertifications.some((certification) =>
          certification.capabilities.includes(evidence.capability),
        )
      ) {
        throw new ConflictError(
          `RuntimeOffer ${offer.runtimeOfferId} has no trusted certification for capability ${evidence.capability}`,
        );
      }
    }
    if (offer.isolation.evidence === "certified") {
      const isolationRanks = ["none", "process", "platform", "container"];
      const requiredRank = isolationRanks.indexOf(offer.isolation.level);
      if (
        !referencedCertifications.some(
          (certification) =>
            isolationRanks.indexOf(certification.maximumIsolation) >=
            requiredRank,
        )
      ) {
        throw new ConflictError(
          `RuntimeOffer ${offer.runtimeOfferId} has no trusted certification for isolation ${offer.isolation.level}`,
        );
      }
    }
    if (
      offer.modelBindingDescriptors.some(
        (binding) => binding.evidence === "certified",
      )
    ) {
      throw new ConflictError(
        `RuntimeOffer ${offer.runtimeOfferId} cannot self-certify model bindings`,
      );
    }
    return [...referencedCertifications].sort((left, right) =>
      left.certificationId.localeCompare(right.certificationId),
    );
  }

  #runtimeOfferEvidenceIsCurrentlyTrusted(offer: RuntimeOffer): boolean {
    try {
      this.#resolveTrustedRuntimeOfferEvidence(offer);
      return true;
    } catch (error) {
      if (error instanceof ConflictError) return false;
      throw error;
    }
  }

  #requirePlacementRow(placementId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM placements WHERE placement_id = ?")
      .get(placementId);
    if (row === undefined) {
      throw new NotFoundError(`Placement ${placementId} was not found`);
    }
    return row;
  }

  #placementFromRow(row: Row): PlacementDecision {
    const decision = jsonObject(row, "decision_json");
    return PlacementDecisionSchema.parse({
      ...decision,
      provenanceVersion:
        decision.provenanceVersion ?? "legacy_without_offer_observation",
      state: text(row, "state"),
    });
  }

  #setPlacementState(
    row: Row,
    state: "consumed" | "released",
    releaseReason?: string,
  ): void {
    const decision = jsonObject(row, "decision_json");
    const placement = PlacementDecisionSchema.parse({
      ...decision,
      provenanceVersion:
        decision.provenanceVersion ?? "legacy_without_offer_observation",
      state,
    });
    this.#database
      .prepare(
        "UPDATE placements SET state = ?, decision_json = ?, release_reason = COALESCE(?, release_reason), updated_at = ? WHERE placement_id = ?",
      )
      .run(
        state,
        JSON.stringify(placement),
        releaseReason ?? null,
        this.#timestamp(),
        placement.placementId,
      );
  }

  #reservePlacementResources(
    placement: PlacementDecision,
    offer: RuntimeOffer,
  ): void {
    const resources: Array<["host" | "offer" | "pool" | "profile", string]> = [
      ["offer", placement.runtimeOfferId],
      ["host", placement.hostId],
      [
        "profile",
        capacityProfileResourceId(placement.hostId, offer.runtimeProfileId),
      ],
      ...placement.capacityPoolIds.map((capacityPoolId): ["pool", string] => [
        "pool",
        capacityPoolId,
      ]),
    ];
    const insert = this.#database.prepare(
      "INSERT INTO placement_capacity_reservations(placement_id, resource_type, resource_id) VALUES(?, ?, ?)",
    );
    for (const [resourceType, resourceId] of resources) {
      insert.run(placement.placementId, resourceType, resourceId);
    }
    this.#database
      .prepare(
        "INSERT INTO workspace_leases(placement_id, workspace_mount_revision_id, workspace_mode, created_at) VALUES(?, ?, ?, ?)",
      )
      .run(
        placement.placementId,
        placement.workspaceMountRevisionId,
        placement.workspaceMode,
        placement.createdAt,
      );
  }

  #releasePlacementResources(placementId: string): void {
    const unprovenRuntime = this.#database
      .prepare(
        `SELECT runtime_processes.runtime_process_id
         FROM runtime_processes
         JOIN run_attempts
           ON run_attempts.run_attempt_id = runtime_processes.run_attempt_id
         WHERE run_attempts.placement_id = ?
           AND runtime_processes.state <> 'terminated'
         LIMIT 1`,
      )
      .get(placementId);
    if (unprovenRuntime !== undefined) {
      throw new RuntimeTerminationProofError(
        `Placement ${placementId} has a RuntimeProcess without terminal proof`,
      );
    }
    this.#database
      .prepare(
        "DELETE FROM placement_capacity_reservations WHERE placement_id = ?",
      )
      .run(placementId);
    this.#database
      .prepare("DELETE FROM workspace_leases WHERE placement_id = ?")
      .run(placementId);
  }

  #releaseExpiredReservedPlacements(now: Date): void {
    const expired = this.#database
      .prepare(
        "SELECT * FROM placements WHERE state = 'reserved' AND lease_until_ms <= ? ORDER BY created_at, placement_id",
      )
      .all(now.getTime());
    for (const placementRow of expired) {
      const placementId = text(placementRow, "placement_id");
      const runAttempt = this.#database
        .prepare("SELECT 1 AS present FROM run_attempts WHERE placement_id = ?")
        .get(placementId);
      if (runAttempt !== undefined) continue;
      this.#setPlacementState(
        placementRow,
        "released",
        "placement lease expired before RunAttempt",
      );
      this.#releasePlacementResources(placementId);

      const activation = this.#requireActivationRow(
        text(placementRow, "activation_id"),
      );
      let mergedActivationId: string | undefined;
      if (
        text(activation, "state") === "leased" &&
        nullableText(activation, "lease_owner") ===
          text(placementRow, "host_id") &&
        integer(activation, "attempt_count") ===
          integer(placementRow, "activation_attempt_number")
      ) {
        const followUp = this.#database
          .prepare(
            "SELECT * FROM activations WHERE room_id = ? AND participant_id = ? AND state = 'queued' AND activation_id <> ?",
          )
          .get(
            text(activation, "room_id"),
            text(activation, "participant_id"),
            text(activation, "activation_id"),
          );
        let fromSeq = integer(activation, "from_seq");
        let toSeq = integer(activation, "to_seq");
        if (followUp !== undefined) {
          fromSeq = Math.min(fromSeq, integer(followUp, "from_seq"));
          toSeq = Math.max(toSeq, integer(followUp, "to_seq"));
          mergedActivationId = text(followUp, "activation_id");
          this.#database
            .prepare(
              "UPDATE activations SET state = 'cancelled', last_error = ?, updated_at = ? WHERE activation_id = ?",
            )
            .run(
              `merged into expired placement ${placementId}`,
              now.toISOString(),
              mergedActivationId,
            );
        }
        this.#database
          .prepare(
            "UPDATE activations SET state = 'queued', from_seq = ?, to_seq = ?, lease_owner = NULL, lease_until = NULL, lease_until_ms = NULL, available_at = ?, available_at_ms = ?, last_error = ?, updated_at = ? WHERE activation_id = ?",
          )
          .run(
            fromSeq,
            toSeq,
            now.toISOString(),
            now.getTime(),
            "placement lease expired before RunAttempt",
            now.toISOString(),
            text(activation, "activation_id"),
          );
      }
      this.#appendEvent({
        actorId: SYSTEM_PRINCIPAL_ID,
        aggregateId: placementId,
        aggregateType: "placement",
        idempotencyKey: `placement.release:${placementId}`,
        payload: {
          activationId: text(placementRow, "activation_id"),
          ...(mergedActivationId === undefined ? {} : { mergedActivationId }),
          placementId,
          reason: "placement lease expired before RunAttempt",
        },
        roomId: text(placementRow, "room_id"),
        type: "placement.released",
      });
    }
  }

  #buildPlacementPlannerInput(
    now: Date,
    schedulerVersion: string,
  ): PlacementPlannerInput {
    const offerRows = this.#database
      .prepare(
        `SELECT runtime_offers.*
         FROM runtime_offers
         JOIN agent_hosts ON agent_hosts.host_id = runtime_offers.host_id
         WHERE runtime_offers.lease_until_ms > ?
           AND agent_hosts.state = 'online'
           AND agent_hosts.instance_id = runtime_offers.host_instance_id
         ORDER BY runtime_offers.runtime_offer_id`,
      )
      .all(now.getTime());
    const offers = offerRows
      .map((row) => this.#runtimeOfferFromRow(row))
      .filter((offer) => this.#runtimeOfferEvidenceIsCurrentlyTrusted(offer));
    const workspaceDefinitionIds = [
      ...new Set(
        offers.flatMap((offer) =>
          offer.workspaceMountDescriptors.map(
            (workspace) => workspace.workspaceDefinitionId,
          ),
        ),
      ),
    ].sort();
    const workspaceDefinitionId =
      workspaceDefinitionIds.length === 1
        ? workspaceDefinitionIds[0]!
        : "workspace-unconfigured";

    const candidateRows = this.#database
      .prepare(
        `SELECT activations.*, agent_definitions.state AS agent_state,
                agent_definitions.current_revision_id AS agent_revision_id
         FROM activations
         JOIN agent_definitions
           ON agent_definitions.participant_id = activations.participant_id
         WHERE activations.state = 'queued'
           AND activations.available_at_ms <= ?
         ORDER BY activations.available_at_ms, activations.created_at, activations.activation_id`,
      )
      .all(now.getTime());
    const candidates = candidateRows.map((row) => {
      const revision = this.#agentDefinitionRevisionFromRow(
        this.#requireAgentDefinitionRevisionRow(text(row, "agent_revision_id")),
      );
      return {
        activationId: text(row, "activation_id"),
        agentDefinitionRevisionId: revision.agentDefinitionRevisionId,
        agentEnabled: text(row, "agent_state") === "enabled",
        availableAt: text(row, "available_at"),
        createdAt: text(row, "created_at"),
        executionPolicy: this.#executionPolicyRevisionFromRow(
          this.#requireExecutionPolicyRevisionRow(
            revision.executionPolicyRevisionId,
          ),
        ),
        participantId: text(row, "participant_id"),
        priority: 0,
        roomId: text(row, "room_id"),
        workspaceDefinitionId,
      };
    });

    const hostRows = this.#database
      .prepare(
        "SELECT * FROM agent_hosts WHERE state = 'online' ORDER BY host_id",
      )
      .all();
    const reservationRows = this.#database
      .prepare(
        "SELECT placement_id, resource_type, resource_id FROM placement_capacity_reservations ORDER BY placement_id, resource_type, resource_id",
      )
      .all();
    const reservationKeys = new Set<string>();
    const reservedByResource = new Map<string, number>();
    for (const row of reservationRows) {
      const placementId = text(row, "placement_id");
      const resourceType = text(row, "resource_type");
      const resourceId = text(row, "resource_id");
      reservationKeys.add(`${placementId}:${resourceType}:${resourceId}`);
      const resourceKey = `${resourceType}:${resourceId}`;
      reservedByResource.set(
        resourceKey,
        (reservedByResource.get(resourceKey) ?? 0) + 1,
      );
    }
    const unprovenRuntimePlacementRows = this.#database
      .prepare(
        `SELECT DISTINCT placements.*
         FROM placements
         JOIN run_attempts ON run_attempts.placement_id = placements.placement_id
         JOIN runtime_processes
           ON runtime_processes.run_attempt_id = run_attempts.run_attempt_id
         WHERE runtime_processes.state <> 'terminated'
         ORDER BY placements.placement_id`,
      )
      .all();
    const unprovenRuntimePlacements = unprovenRuntimePlacementRows.map(
      (row) => ({
        placement: this.#placementFromRow(row),
        runtimeProfileId: text(row, "runtime_profile_id"),
      }),
    );
    for (const { placement, runtimeProfileId } of unprovenRuntimePlacements) {
      const implicitResources: Array<
        ["host" | "offer" | "pool" | "profile", string]
      > = [
        ["offer", placement.runtimeOfferId],
        ["host", placement.hostId],
        [
          "profile",
          capacityProfileResourceId(placement.hostId, runtimeProfileId),
        ],
        ...placement.capacityPoolIds.map((capacityPoolId): ["pool", string] => [
          "pool",
          capacityPoolId,
        ]),
      ];
      for (const [resourceType, resourceId] of implicitResources) {
        const reservationKey = `${placement.placementId}:${resourceType}:${resourceId}`;
        if (reservationKeys.has(reservationKey)) continue;
        reservationKeys.add(reservationKey);
        const resourceKey = `${resourceType}:${resourceId}`;
        reservedByResource.set(
          resourceKey,
          (reservedByResource.get(resourceKey) ?? 0) + 1,
        );
      }
    }
    const reserved = (resourceType: string, resourceId: string): number =>
      reservedByResource.get(`${resourceType}:${resourceId}`) ?? 0;
    const uniqueHosts = new Map<
      string,
      { adminMaxConcurrent: number; hostId: string; reserved: number }
    >();
    const uniqueProfiles = new Map<
      string,
      {
        adminMaxConcurrent: number;
        hostId: string;
        reserved: number;
        runtimeProfileId: string;
      }
    >();
    const uniquePools = new Map<
      string,
      {
        adminMaxConcurrent: number;
        capacityPoolId: string;
        reserved: number;
      }
    >();
    for (const offer of offers) {
      uniqueHosts.set(offer.hostId, {
        adminMaxConcurrent:
          this.#hostPlacementLimits.get(offer.hostId) ??
          this.#defaultPlacementMaxConcurrent,
        hostId: offer.hostId,
        reserved: reserved("host", offer.hostId),
      });
      uniqueProfiles.set(
        capacityProfileResourceId(offer.hostId, offer.runtimeProfileId),
        {
          adminMaxConcurrent:
            this.#runtimeProfilePlacementLimits.get(
              capacityProfileResourceId(offer.hostId, offer.runtimeProfileId),
            ) ?? this.#defaultPlacementMaxConcurrent,
          hostId: offer.hostId,
          reserved: reserved(
            "profile",
            capacityProfileResourceId(offer.hostId, offer.runtimeProfileId),
          ),
          runtimeProfileId: offer.runtimeProfileId,
        },
      );
      for (const capacityPoolId of offer.capacityPoolIds) {
        uniquePools.set(capacityPoolId, {
          adminMaxConcurrent:
            this.#poolPlacementLimits.get(capacityPoolId) ??
            this.#defaultPlacementMaxConcurrent,
          capacityPoolId,
          reserved: reserved("pool", capacityPoolId),
        });
      }
    }

    return {
      activeHostInstances: hostRows.map((row) => ({
        hostId: text(row, "host_id"),
        hostInstanceId: text(row, "instance_id"),
      })),
      activeParticipantIds: [
        ...new Set([
          ...this.#database
            .prepare(
              "SELECT DISTINCT participant_id FROM activations WHERE state = 'quarantined' OR (state = 'leased' AND lease_until_ms > ?) ORDER BY participant_id",
            )
            .all(now.getTime())
            .map((row) => text(row, "participant_id")),
          ...this.#database
            .prepare(
              "SELECT DISTINCT participant_id FROM runtime_processes WHERE state <> 'terminated' ORDER BY participant_id",
            )
            .all()
            .map((row) => text(row, "participant_id")),
          ...activeAgentExclusiveOperationParticipantIds(this.#database),
        ]),
      ].sort(),
      authorizedHostParticipants: memoryHomeAuthorizedHosts(
        this.#database,
        hostRows,
      ),
      busyWorkspaceMountRevisionIds: [
        ...new Set([
          ...this.#database
            .prepare(
              "SELECT workspace_mount_revision_id FROM workspace_leases WHERE workspace_mode = 'in_place' ORDER BY workspace_mount_revision_id",
            )
            .all()
            .map((row) => text(row, "workspace_mount_revision_id")),
          ...unprovenRuntimePlacements
            .map(({ placement }) => placement)
            .filter((placement) => placement.workspaceMode === "in_place")
            .map((placement) => placement.workspaceMountRevisionId),
        ]),
      ].sort(),
      candidates,
      capacities: {
        hosts: [...uniqueHosts.values()],
        offers: offers.map((offer) => ({
          reserved: reserved("offer", offer.runtimeOfferId),
          runtimeOfferId: offer.runtimeOfferId,
          structuralFailureCount: 0,
        })),
        pools: [...uniquePools.values()],
        profiles: [...uniqueProfiles.values()],
      },
      now: now.toISOString(),
      offers,
      schedulerVersion,
    };
  }

  #snapshot(roomId: string): RoomSnapshot {
    const roomRow = this.#requireRoom(roomId);
    const members = this.#database
      .prepare(
        `SELECT principals.principal_id, principals.handle, principals.kind
         FROM memberships
         JOIN principals ON principals.principal_id = memberships.principal_id
         WHERE memberships.room_id = ?
         ORDER BY principals.handle`,
      )
      .all(roomId)
      .map((row) => principalProfile.fromRow(row));
    return {
      room: roomProjectionFromRow(roomRow),
      members,
    };
  }

  #requireRoom(roomId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM rooms WHERE room_id = ?")
      .get(roomId);
    if (!row) throw new NotFoundError(`room ${roomId} was not found`);
    return row;
  }

  #requirePrincipal(principalId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM principals WHERE principal_id = ?")
      .get(principalId);
    if (!row) {
      throw new NotFoundError(`principal ${principalId} was not found`);
    }
    return row;
  }

  #requireAuthenticatedActor(actor: AuthenticatedActorContext): string {
    return requireAuthenticatedActor(this.#database, actor);
  }

  #requireAuthenticatedHost(
    host: AuthenticatedHostContext,
  ): AuthenticatedHostContext {
    return requireAuthenticatedHost(this.#database, host);
  }

  #requireAuthenticatedHostCredential(
    host: AuthenticatedHostContext,
  ): AuthenticatedHostContext {
    return requireAuthenticatedHostCredential(this.#database, host);
  }

  #requireAuthenticatedWorkerExecution(
    execution: AuthenticatedWorkerExecutionContext,
  ): ActivationCredentialScope {
    if (!isIssuedWorkerExecutionContext(execution)) {
      throw new UnauthenticatedError("worker execution context is invalid");
    }
    const scope = ActivationCredentialScopeSchema.parse(execution.scope);
    const instance = this.#database
      .prepare(
        "SELECT credential_id, instance_id, state FROM agent_hosts WHERE host_id = ?",
      )
      .get(scope.hostId);
    if (
      !instance ||
      nullableText(instance, "credential_id") !== execution.hostCredentialId ||
      text(instance, "instance_id") !== execution.hostInstanceId ||
      text(instance, "state") === "offline"
    ) {
      throw new UnauthenticatedError("worker execution context is invalid");
    }
    const row = this.#database
      .prepare(
        "SELECT host_id, participant_ids_json FROM agent_host_credentials WHERE credential_id = ? AND revoked_at IS NULL",
      )
      .get(execution.hostCredentialId);
    if (
      !row ||
      text(row, "host_id") !== scope.hostId ||
      !stringArray(row, "participant_ids_json").includes(scope.participantId)
    ) {
      throw new UnauthenticatedError("worker execution context is invalid");
    }
    this.#assertWorkerExecutionScope(scope);
    return scope;
  }

  #assertWorkerGrantScope(scope: ActivationCredentialScope): {
    activation: Row;
    runAttempt: Row;
  } {
    const activation = this.#database
      .prepare("SELECT * FROM activations WHERE activation_id = ?")
      .get(scope.activationId);
    const runAttempt = this.#database
      .prepare("SELECT * FROM run_attempts WHERE run_attempt_id = ?")
      .get(scope.runAttemptId);
    const runState =
      runAttempt === undefined ? undefined : text(runAttempt, "state");
    if (
      activation !== undefined &&
      unresolvedActivationCancellation(this.#database, activation) !== undefined
    ) {
      throw new ExecutionFencedError(
        "worker execution was cancelled by its Task creator",
      );
    }
    if (
      activation === undefined ||
      runAttempt === undefined ||
      text(activation, "state") !== "leased" ||
      nullableText(activation, "lease_owner") !== scope.hostId ||
      (nullableInteger(activation, "lease_until_ms") ?? 0) <=
        this.#now().getTime() ||
      text(activation, "room_id") !== scope.roomId ||
      text(activation, "participant_id") !== scope.participantId ||
      integer(activation, "to_seq") !== scope.toSeq ||
      text(runAttempt, "activation_id") !== scope.activationId ||
      text(runAttempt, "room_id") !== scope.roomId ||
      text(runAttempt, "participant_id") !== scope.participantId ||
      text(runAttempt, "host_id") !== scope.hostId ||
      integer(runAttempt, "attempt_number") !==
        integer(activation, "attempt_count") ||
      (runState !== "starting" && runState !== "running")
    ) {
      throw new ExecutionFencedError();
    }
    return { activation, runAttempt };
  }

  #assertWorkerExecutionScope(scope: ActivationCredentialScope): void {
    const { runAttempt } = this.#assertWorkerGrantScope(scope);
    const runtimeProcess = this.#database
      .prepare("SELECT * FROM runtime_processes WHERE run_attempt_id = ?")
      .get(scope.runAttemptId);
    const runState = text(runAttempt, "state");
    const executionStateIsCurrent =
      (runState === "starting" &&
        runtimeProcess !== undefined &&
        text(runtimeProcess, "state") === "prepared") ||
      (runState === "running" &&
        runtimeProcess !== undefined &&
        text(runtimeProcess, "state") === "active" &&
        text(runtimeProcess, "runtime_run_id") ===
          nullableText(runAttempt, "runtime_run_id"));
    if (!executionStateIsCurrent) throw new ExecutionFencedError();
  }

  #requireHostParticipant(
    host: AuthenticatedHostContext,
    participantId: string,
  ): void {
    if (
      !authorizedHostParticipantIds(this.#database, host).includes(
        participantId,
      )
    ) {
      throw new ForbiddenError(
        `host ${host.hostId} is not authorized for participant ${participantId}`,
      );
    }
  }

  #assertFreshContext(
    roomId: string,
    actorId: string,
    basedOnRoomSeq: number | undefined,
  ): void {
    const actor = principalProfile.fromRow(this.#requirePrincipal(actorId));
    const room = this.#requireRoom(roomId);
    const latestRoomSeq = integer(room, "next_seq") - 1;
    if (basedOnRoomSeq === undefined) {
      if (actor.kind === "human") return;
      throw new StaleContextError(undefined, latestRoomSeq);
    }
    if (!Number.isInteger(basedOnRoomSeq) || basedOnRoomSeq < 0) {
      throw new Error("basedOnRoomSeq must be a non-negative integer");
    }
    if (basedOnRoomSeq !== latestRoomSeq) {
      throw new StaleContextError(basedOnRoomSeq, latestRoomSeq);
    }
  }

  #requireMember(roomId: string, principalId: string): void {
    requireRoomMember(this.#database, roomId, principalId);
  }

  #requireTaskRow(taskId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM tasks WHERE task_id = ?")
      .get(taskId);
    if (!row) throw new NotFoundError(`task ${taskId} was not found`);
    return row;
  }

  #requireInputRequestRow(inputRequestId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM input_requests WHERE input_request_id = ?")
      .get(inputRequestId);
    if (!row) {
      throw new NotFoundError(`InputRequest ${inputRequestId} was not found`);
    }
    return row;
  }

  #requireActivationRow(activationId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM activations WHERE activation_id = ?")
      .get(activationId);
    if (!row) {
      throw new NotFoundError(`activation ${activationId} was not found`);
    }
    return row;
  }

  #requireActivationLease(row: Row, hostId: string): void {
    if (
      text(row, "state") !== "leased" ||
      nullableText(row, "lease_owner") !== hostId ||
      (nullableInteger(row, "lease_until_ms") ?? 0) <= this.#now().getTime()
    ) {
      throw new LeaseConflictError(
        `host ${hostId} does not own a valid lease for ${text(row, "activation_id")}`,
      );
    }
  }

  #requireOutboxRow(outboxId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM outbox WHERE outbox_id = ?")
      .get(outboxId);
    if (!row) throw new NotFoundError(`outbox ${outboxId} was not found`);
    return row;
  }

  #requireHostRow(hostId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM agent_hosts WHERE host_id = ?")
      .get(hostId);
    if (!row) throw new NotFoundError(`host ${hostId} was not found`);
    return row;
  }

  #requireRunAttemptRow(runAttemptId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM run_attempts WHERE run_attempt_id = ?")
      .get(runAttemptId);
    if (!row) {
      throw new NotFoundError(`run attempt ${runAttemptId} was not found`);
    }
    return row;
  }

  #requireRuntimeProcessRow(runAttemptId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM runtime_processes WHERE run_attempt_id = ?")
      .get(runAttemptId);
    if (!row) {
      throw new NotFoundError(
        `runtime process for run attempt ${runAttemptId} was not found`,
      );
    }
    return row;
  }

  #requireRuntimeProcessById(runtimeProcessId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM runtime_processes WHERE runtime_process_id = ?")
      .get(runtimeProcessId);
    if (!row) {
      throw new NotFoundError(
        `runtime process ${runtimeProcessId} was not found`,
      );
    }
    return row;
  }

  #requireRunAttemptOwner(row: Row, hostId: string): void {
    if (text(row, "host_id") !== hostId) {
      throw new ForbiddenError(
        `host ${hostId} does not own run attempt ${text(row, "run_attempt_id")}`,
      );
    }
  }

  #requireRunAttemptHostGeneration(
    runAttempt: Row,
    host: AuthenticatedHostContext,
  ): void {
    const placementId = nullableText(runAttempt, "placement_id");
    if (placementId === null) return;
    const placement = this.#requirePlacementRow(placementId);
    if (
      text(placement, "host_id") !== host.hostId ||
      text(placement, "host_instance_id") !== host.instanceId
    ) {
      throw new ExecutionFencedError(
        `run attempt ${text(runAttempt, "run_attempt_id")} belongs to another Host generation`,
      );
    }
  }

  #requireActivationHostGeneration(
    activation: Row,
    host: AuthenticatedHostContext,
  ): void {
    const runAttempt = this.#database
      .prepare(
        "SELECT * FROM run_attempts WHERE activation_id = ? AND attempt_number = ? ORDER BY started_at DESC LIMIT 1",
      )
      .get(
        text(activation, "activation_id"),
        integer(activation, "attempt_count"),
      );
    if (runAttempt !== undefined) {
      this.#requireRunAttemptHostGeneration(runAttempt, host);
      return;
    }
    const placement = this.#database
      .prepare(
        "SELECT * FROM placements WHERE activation_id = ? AND activation_attempt_number = ? AND state IN ('reserved', 'consumed') ORDER BY created_at DESC, placement_id DESC LIMIT 1",
      )
      .get(
        text(activation, "activation_id"),
        integer(activation, "attempt_count"),
      );
    if (
      placement !== undefined &&
      (text(placement, "host_id") !== host.hostId ||
        text(placement, "host_instance_id") !== host.instanceId)
    ) {
      throw new ExecutionFencedError(
        `activation ${text(activation, "activation_id")} belongs to another Host generation`,
      );
    }
  }

  #requireOutboxLease(row: Row, dispatcherId: string): void {
    if (
      nullableText(row, "lease_owner") !== dispatcherId ||
      (nullableInteger(row, "lease_until_ms") ?? 0) <= this.#now().getTime()
    ) {
      throw new LeaseConflictError(
        `dispatcher ${dispatcherId} does not own an active lease for outbox ${text(row, "outbox_id")}`,
      );
    }
  }

  #eventFromRow(row: Row): RoomEvent {
    return this.#roomEvents.eventFromRow(row);
  }

  #taskFromRow(row: Row): Task {
    return taskProjectionFromRow(this.#database, row);
  }

  #runAttemptFromRow(row: Row): RunAttempt {
    return runAttemptProjectionFromRow(this.#database, row, (placementId) =>
      this.#placementFromRow(this.#requirePlacementRow(placementId)),
    );
  }

  #runtimeProcessFromRow(row: Row): RuntimeProcessRecord {
    return runtimeProcessProjectionFromRow(row);
  }

  #assertMatchingRuntimeTermination(
    row: Row,
    exit: { code: number | null; signal?: string },
  ): RuntimeProcessRecord {
    if (
      nullableInteger(row, "exit_code") === exit.code &&
      nullableText(row, "exit_signal") === (exit.signal ?? null)
    ) {
      return this.#runtimeProcessFromRow(row);
    }
    throw new ConflictError("runtime termination proof conflicts");
  }

  #persistRuntimeTermination(
    row: Row,
    exit: { code: number | null; signal?: string },
    authority: { hostId: string } | { recoveryHostId: string },
  ): RuntimeProcessRecord {
    const runtimeProcessId = text(row, "runtime_process_id");
    const runAttemptId = text(row, "run_attempt_id");
    const runAttempt = this.#requireRunAttemptRow(runAttemptId);
    const placementId = nullableText(runAttempt, "placement_id");
    const terminatedAt = this.#timestamp();
    this.#database
      .prepare(
        "UPDATE runtime_processes SET state = 'terminated', exit_code = ?, exit_signal = ?, recovery_lease_owner = NULL, recovery_lease_owner_instance_id = NULL, recovery_lease_until = NULL, recovery_lease_until_ms = NULL, terminated_at = ?, updated_at = ? WHERE runtime_process_id = ?",
      )
      .run(
        exit.code,
        exit.signal ?? null,
        terminatedAt,
        terminatedAt,
        runtimeProcessId,
      );
    if (placementId !== null) {
      const placement = this.#requirePlacementRow(placementId);
      if (text(placement, "state") !== "released") {
        this.#setPlacementState(
          placement,
          "released",
          "orphaned RuntimeProcess termination proven",
        );
        this.#releasePlacementResources(placementId);
      }
    }
    this.#appendEvent({
      actorId: SYSTEM_PRINCIPAL_ID,
      aggregateId: runAttemptId,
      aggregateType: "run_attempt",
      idempotencyKey: `run.termination:${runAttemptId}`,
      payload: {
        ...authority,
        runAttemptId,
        runtimeRunId: text(row, "runtime_run_id"),
        exitCode: exit.code,
        ...(placementId === null ? {} : { placementId }),
        ...(exit.signal === undefined ? {} : { exitSignal: exit.signal }),
      },
      roomId: text(row, "room_id"),
      type: "run.termination_proven",
    });
    return this.#runtimeProcessFromRow(
      this.#requireRuntimeProcessById(runtimeProcessId),
    );
  }

  #validateRunExit(exit: { code: number | null; signal?: string }): void {
    if (!Number.isInteger(exit.code) && exit.code !== null) {
      throw new Error("exit code must be an integer or null");
    }
    if (exit.code === null && exit.signal === undefined) {
      throw new Error("a signalled exit requires signal");
    }
  }

  #reconcileUnownedRuntimeProcesses(participantIds: string[], now: Date): void {
    if (participantIds.length === 0) return;
    const placeholders = participantIds.map(() => "?").join(", ");
    const unsafeActivations = this.#database
      .prepare(
        `SELECT DISTINCT activations.*
         FROM activations
         JOIN runtime_processes
           ON runtime_processes.activation_id = activations.activation_id
         WHERE activations.participant_id IN (${placeholders})
           AND runtime_processes.state <> 'terminated'
           AND NOT (
             activations.state = 'leased'
             AND activations.lease_until_ms > ?
           )
         ORDER BY activations.created_at, activations.activation_id`,
      )
      .all(...participantIds, now.getTime());

    for (const activation of unsafeActivations) {
      const activationId = text(activation, "activation_id");
      const runtimeProcesses = this.#database
        .prepare(
          "SELECT * FROM runtime_processes WHERE activation_id = ? AND state <> 'terminated' ORDER BY registered_at, runtime_process_id",
        )
        .all(activationId);
      const runAttemptIds = [
        ...new Set(
          runtimeProcesses.map((process) => text(process, "run_attempt_id")),
        ),
      ];
      const previousActivationState = text(activation, "state");
      const error = `Activation ${activationId} has ${String(runtimeProcesses.length)} RuntimeProcess record(s) without an owning live lease`;

      for (const runAttemptId of runAttemptIds) {
        const runAttempt = this.#requireRunAttemptRow(runAttemptId);
        if (text(runAttempt, "state") === "orphaned") continue;
        this.#database
          .prepare(
            "UPDATE run_attempts SET state = 'orphaned', error = ?, finished_at = ? WHERE run_attempt_id = ?",
          )
          .run(error, now.toISOString(), runAttemptId);
        this.#appendEvent({
          actorId: SYSTEM_PRINCIPAL_ID,
          aggregateId: runAttemptId,
          aggregateType: "run_attempt",
          idempotencyKey: `run.reconcile_orphan:${runAttemptId}`,
          payload: {
            activationId,
            error,
            previousActivationState,
            runAttemptId,
          },
          roomId: text(activation, "room_id"),
          type: "run.orphaned",
        });
      }
      this.#database
        .prepare(
          "UPDATE runtime_processes SET state = 'orphaned', updated_at = ? WHERE activation_id = ? AND state IN ('prepared', 'active')",
        )
        .run(now.toISOString(), activationId);

      if (
        previousActivationState !== "queued" &&
        previousActivationState !== "leased"
      ) {
        continue;
      }
      this.#database
        .prepare(
          "UPDATE activations SET state = 'quarantined', lease_owner = NULL, lease_until = NULL, lease_until_ms = NULL, last_error = ?, updated_at = ? WHERE activation_id = ?",
        )
        .run(error, now.toISOString(), activationId);
      this.#appendEvent({
        actorId: SYSTEM_PRINCIPAL_ID,
        aggregateId: activationId,
        aggregateType: "activation",
        idempotencyKey: `activation.runtime_ownership_reconciled:${activationId}:${integer(activation, "attempt_count")}`,
        payload: {
          activationId,
          error,
          previousActivationState,
          runAttemptIds,
        },
        roomId: text(activation, "room_id"),
        type: "activation.quarantined",
      });
    }
  }

  #reconcileProvenActivationQuarantines(participantIds: string[]): void {
    if (participantIds.length === 0) return;
    const placeholders = participantIds.map(() => "?").join(", ");
    const resolvable = this.#database
      .prepare(
        `SELECT activation.*
         FROM activations AS activation
         WHERE activation.participant_id IN (${placeholders})
           AND activation.state = 'quarantined'
           AND NOT EXISTS (
             SELECT 1 FROM activation_retry_fences
             WHERE activation_retry_fences.activation_id = activation.activation_id
               AND activation_retry_fences.state = 'blocked'
           )
           AND EXISTS (
             SELECT 1 FROM runtime_processes
             WHERE runtime_processes.activation_id = activation.activation_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM runtime_processes
             WHERE runtime_processes.activation_id = activation.activation_id
               AND runtime_processes.state <> 'terminated'
           )
         ORDER BY activation.created_at, activation.activation_id`,
      )
      .all(...participantIds);
    for (const activation of resolvable) {
      this.#resolveProvenActivationQuarantine(activation, {
        kernelReconciliation: true,
      });
    }
  }

  #resolveProvenActivationQuarantine(
    row: Row,
    resolution: { kernelReconciliation: true } | { resolverHostId: string },
  ): Activation {
    const activationId = text(row, "activation_id");
    if (text(row, "state") !== "quarantined") {
      throw new ConflictError(`activation ${activationId} is not quarantined`);
    }
    if (isActivationRetryBlocked(this.#database, activationId)) {
      throw new ConflictError(
        `activation ${activationId} is blocked after repeated identical Runtime errors; restart the Agent after fixing the Runtime or tooling issue`,
      );
    }
    const processes = this.#database
      .prepare(
        "SELECT * FROM runtime_processes WHERE activation_id = ? ORDER BY registered_at, runtime_process_id",
      )
      .all(activationId);
    if (
      processes.length === 0 ||
      processes.some((processRow) => text(processRow, "state") !== "terminated")
    ) {
      throw new ConflictError(
        `activation ${activationId} has unverified runtime termination`,
      );
    }

    const followUp = this.#database
      .prepare(
        "SELECT * FROM activations WHERE room_id = ? AND participant_id = ? AND state = 'queued' AND activation_id <> ?",
      )
      .get(text(row, "room_id"), text(row, "participant_id"), activationId);
    let fromSeq = integer(row, "from_seq");
    let toSeq = integer(row, "to_seq");
    let mergedActivationId: string | undefined;
    const resolvedAt = this.#now();
    if (followUp) {
      fromSeq = Math.min(fromSeq, integer(followUp, "from_seq"));
      toSeq = Math.max(toSeq, integer(followUp, "to_seq"));
      mergedActivationId = text(followUp, "activation_id");
      this.#database
        .prepare(
          "UPDATE activations SET state = 'cancelled', last_error = ?, updated_at = ? WHERE activation_id = ?",
        )
        .run(
          `merged into resolved quarantine ${activationId}`,
          resolvedAt.toISOString(),
          mergedActivationId,
        );
    }
    this.#database
      .prepare(
        "UPDATE activations SET state = 'queued', from_seq = ?, to_seq = ?, lease_owner = NULL, lease_until = NULL, lease_until_ms = NULL, available_at = ?, available_at_ms = ?, last_error = NULL, updated_at = ? WHERE activation_id = ?",
      )
      .run(
        fromSeq,
        toSeq,
        resolvedAt.toISOString(),
        resolvedAt.getTime(),
        resolvedAt.toISOString(),
        activationId,
      );
    resolveRecoveredActivationCancellation(
      this.#database,
      row,
      resolvedAt.toISOString(),
    );
    this.#appendEvent({
      actorId: SYSTEM_PRINCIPAL_ID,
      aggregateId: activationId,
      aggregateType: "activation",
      idempotencyKey: `activation.quarantine_resolved:${activationId}:${integer(row, "attempt_count")}`,
      payload: {
        activationId,
        ...resolution,
        ...(mergedActivationId === undefined ? {} : { mergedActivationId }),
      },
      roomId: text(row, "room_id"),
      type: "activation.quarantine_resolved",
    });
    return activationProjectionFromRow(
      this.#requireActivationRow(activationId),
    );
  }

  #quarantineExpiredActiveRuns(participantIds: string[], now: Date): void {
    if (participantIds.length === 0) return;
    const placeholders = participantIds.map(() => "?").join(", ");
    const expiredActivations = this.#database
      .prepare(
        `SELECT activation.*
         FROM activations AS activation
         WHERE activation.participant_id IN (${placeholders})
           AND activation.state = 'leased'
           AND activation.lease_until_ms <= ?
         ORDER BY activation.created_at, activation.activation_id`,
      )
      .all(...participantIds, now.getTime());

    for (const activation of expiredActivations) {
      const activationId = text(activation, "activation_id");
      const activeRunAttempts = this.#database
        .prepare(
          "SELECT * FROM run_attempts WHERE activation_id = ? AND state IN ('starting', 'running') ORDER BY attempt_number",
        )
        .all(activationId);
      const unprovenRuntimeProcesses = this.#database
        .prepare(
          "SELECT * FROM runtime_processes WHERE activation_id = ? AND state <> 'terminated' ORDER BY registered_at, runtime_process_id",
        )
        .all(activationId);
      if (
        activeRunAttempts.length === 0 &&
        unprovenRuntimeProcesses.length === 0
      ) {
        this.#recoverExpiredActivationLease(
          activation,
          now,
          "activation lease expired without an active RunAttempt",
          "settled",
        );
        continue;
      }
      const runtimeProcessesForActiveRuns = activeRunAttempts.map((run) =>
        this.#database
          .prepare("SELECT * FROM runtime_processes WHERE run_attempt_id = ?")
          .get(text(run, "run_attempt_id")),
      );
      if (
        activeRunAttempts.length > 0 &&
        runtimeProcessesForActiveRuns.every(
          (process) =>
            process !== undefined && text(process, "state") === "terminated",
        )
      ) {
        this.#recoverExpiredTerminalProofActivation(
          activation,
          activeRunAttempts,
          runtimeProcessesForActiveRuns as Row[],
          now,
        );
        continue;
      }
      const hasPreparedRuntime = activeRunAttempts.some((run) =>
        Boolean(
          this.#database
            .prepare(
              "SELECT 1 AS present FROM runtime_processes WHERE run_attempt_id = ?",
            )
            .get(text(run, "run_attempt_id")),
        ),
      );
      if (
        activeRunAttempts.length > 0 &&
        !hasPreparedRuntime &&
        unprovenRuntimeProcesses.length === 0
      ) {
        this.#recoverExpiredPrePrepareActivation(
          activation,
          activeRunAttempts,
          now,
        );
        continue;
      }
      const runAttemptIds = [
        ...new Set([
          ...activeRunAttempts.map((run) => text(run, "run_attempt_id")),
          ...unprovenRuntimeProcesses.map((process) =>
            text(process, "run_attempt_id"),
          ),
        ]),
      ];
      const error = `activation lease expired with ${String(runAttemptIds.length)} RunAttempt(s) whose runtime state cannot be safely released`;

      for (const runAttemptId of runAttemptIds) {
        const run = this.#requireRunAttemptRow(runAttemptId);
        if (text(run, "state") === "orphaned") continue;
        this.#database
          .prepare(
            "UPDATE run_attempts SET state = 'orphaned', error = ?, finished_at = ? WHERE run_attempt_id = ?",
          )
          .run(error, now.toISOString(), runAttemptId);
        this.#appendEvent({
          actorId: SYSTEM_PRINCIPAL_ID,
          aggregateId: runAttemptId,
          aggregateType: "run_attempt",
          idempotencyKey: `run.orphan:${runAttemptId}`,
          payload: {
            activationId,
            previousHostId: text(run, "host_id"),
            runAttemptId,
          },
          roomId: text(activation, "room_id"),
          type: "run.orphaned",
        });
      }

      this.#database
        .prepare(
          "UPDATE activations SET state = 'quarantined', lease_owner = NULL, lease_until = NULL, lease_until_ms = NULL, last_error = ?, updated_at = ? WHERE activation_id = ? AND state = 'leased'",
        )
        .run(error, now.toISOString(), activationId);
      this.#database
        .prepare(
          "UPDATE runtime_processes SET state = 'orphaned', updated_at = ? WHERE activation_id = ? AND state IN ('prepared', 'active')",
        )
        .run(now.toISOString(), activationId);
      this.#appendEvent({
        actorId: SYSTEM_PRINCIPAL_ID,
        aggregateId: activationId,
        aggregateType: "activation",
        idempotencyKey: `activation.quarantine:${activationId}:${integer(activation, "attempt_count")}`,
        payload: {
          activationId,
          error,
          previousHostId: nullableText(activation, "lease_owner"),
          runAttemptIds,
        },
        roomId: text(activation, "room_id"),
        type: "activation.quarantined",
      });
    }
  }

  #recoverExpiredTerminalProofActivation(
    activation: Row,
    runAttempts: Row[],
    runtimeProcesses: Row[],
    now: Date,
  ): void {
    const activationId = text(activation, "activation_id");
    const error =
      "activation lease expired after runtime termination was proven but before RunAttempt bookkeeping completed";
    for (const [index, runAttempt] of runAttempts.entries()) {
      const runtimeProcess = runtimeProcesses[index]!;
      const runAttemptId = text(runAttempt, "run_attempt_id");
      const exitCode = nullableInteger(runtimeProcess, "exit_code");
      const exitSignal = nullableText(runtimeProcess, "exit_signal");
      const state = exitCode === 0 ? "exited" : "failed";
      this.#database
        .prepare(
          "UPDATE run_attempts SET state = ?, exit_code = ?, exit_signal = ?, error = ?, finished_at = ? WHERE run_attempt_id = ? AND state IN ('starting', 'running')",
        )
        .run(
          state,
          exitCode,
          exitSignal,
          state === "exited" ? null : error,
          nullableText(runtimeProcess, "terminated_at") ?? now.toISOString(),
          runAttemptId,
        );
      const placementId = nullableText(runAttempt, "placement_id");
      if (placementId !== null) {
        const placement = this.#requirePlacementRow(placementId);
        if (text(placement, "state") !== "released") {
          this.#setPlacementState(placement, "released", error);
          this.#releasePlacementResources(placementId);
        }
      }
      this.#appendEvent({
        actorId: SYSTEM_PRINCIPAL_ID,
        aggregateId: runAttemptId,
        aggregateType: "run_attempt",
        idempotencyKey: `run.finish:${runAttemptId}`,
        payload: {
          activationId,
          ...(placementId === null ? {} : { placementId }),
          runAttemptId,
          state,
          terminalProofReconciled: true,
        },
        roomId: text(activation, "room_id"),
        type: "run.finished",
      });
    }
    this.#recoverExpiredActivationLease(
      activation,
      now,
      error,
      "terminal_proof",
    );
  }

  #recoverExpiredPrePrepareActivation(
    activation: Row,
    runAttempts: Row[],
    now: Date,
  ): void {
    const activationId = text(activation, "activation_id");
    const error =
      "activation lease expired before any RuntimeProcess was durably prepared";
    for (const runAttempt of runAttempts) {
      const runAttemptId = text(runAttempt, "run_attempt_id");
      this.#database
        .prepare(
          "UPDATE run_attempts SET state = 'failed', error = ?, finished_at = ? WHERE run_attempt_id = ? AND state IN ('starting', 'running')",
        )
        .run(error, now.toISOString(), runAttemptId);
      const placementId = nullableText(runAttempt, "placement_id");
      if (placementId !== null) {
        const placement = this.#requirePlacementRow(placementId);
        if (text(placement, "state") !== "released") {
          this.#setPlacementState(placement, "released", error);
          this.#releasePlacementResources(placementId);
        }
      }
      this.#appendEvent({
        actorId: SYSTEM_PRINCIPAL_ID,
        aggregateId: runAttemptId,
        aggregateType: "run_attempt",
        idempotencyKey: `run.finish:${runAttemptId}`,
        payload: {
          activationId,
          error,
          ...(placementId === null ? {} : { placementId }),
          runAttemptId,
          state: "failed",
        },
        roomId: text(activation, "room_id"),
        type: "run.finished",
      });
    }
    this.#recoverExpiredActivationLease(activation, now, error, "pre_prepare");
  }

  #recoverExpiredActivationLease(
    activation: Row,
    now: Date,
    error: string,
    recoveryKind: "pre_prepare" | "settled" | "terminal_proof",
  ): void {
    const activationId = text(activation, "activation_id");
    const activePlacements = this.#database
      .prepare(
        "SELECT * FROM placements WHERE activation_id = ? AND state IN ('reserved', 'consumed') ORDER BY created_at, placement_id",
      )
      .all(activationId);
    for (const placement of activePlacements) {
      const placementId = text(placement, "placement_id");
      this.#setPlacementState(placement, "released", error);
      this.#releasePlacementResources(placementId);
    }
    const followUp = this.#database
      .prepare(
        "SELECT * FROM activations WHERE room_id = ? AND participant_id = ? AND state = 'queued' AND activation_id <> ?",
      )
      .get(
        text(activation, "room_id"),
        text(activation, "participant_id"),
        activationId,
      );
    let fromSeq = integer(activation, "from_seq");
    let toSeq = integer(activation, "to_seq");
    let mergedActivationId: string | undefined;
    if (followUp !== undefined) {
      fromSeq = Math.min(fromSeq, integer(followUp, "from_seq"));
      toSeq = Math.max(toSeq, integer(followUp, "to_seq"));
      mergedActivationId = text(followUp, "activation_id");
      this.#database
        .prepare(
          "UPDATE activations SET state = 'cancelled', last_error = ?, updated_at = ? WHERE activation_id = ?",
        )
        .run(
          `merged into ${recoveryKind} recovery ${activationId}`,
          now.toISOString(),
          mergedActivationId,
        );
    }
    this.#database
      .prepare(
        "UPDATE activations SET state = 'queued', from_seq = ?, to_seq = ?, lease_owner = NULL, lease_until = NULL, lease_until_ms = NULL, available_at = ?, available_at_ms = ?, last_error = ?, updated_at = ? WHERE activation_id = ?",
      )
      .run(
        fromSeq,
        toSeq,
        now.toISOString(),
        now.getTime(),
        error,
        now.toISOString(),
        activationId,
      );
    resolveRecoveredActivationCancellation(
      this.#database,
      activation,
      now.toISOString(),
    );
    this.#appendEvent({
      actorId: SYSTEM_PRINCIPAL_ID,
      aggregateId: activationId,
      aggregateType: "activation",
      idempotencyKey: `activation.${recoveryKind}_recover:${activationId}:${integer(activation, "attempt_count")}`,
      payload: {
        activationId,
        error,
        recoveryKind,
        ...(mergedActivationId === undefined ? {} : { mergedActivationId }),
      },
      roomId: text(activation, "room_id"),
      type: "activation.recovered",
    });
  }

  #createRunAttemptInTransaction(
    authenticatedHost: AuthenticatedHostContext,
    activationId: string,
  ): RunAttempt {
    const hostId = authenticatedHost.hostId;
    const activation = this.#requireActivationRow(activationId);
    this.#requireHostParticipant(
      authenticatedHost,
      text(activation, "participant_id"),
    );
    assertAgentUnfenced(this.#database, text(activation, "participant_id"));
    this.#requireActivationLease(activation, hostId);
    const placementRow = prepareRunPlacement(
      this.#database,
      activation,
      authenticatedHost,
      this.#timestamp(),
    );
    const attemptNumber = integer(activation, "attempt_count");
    const existing = this.#database
      .prepare(
        "SELECT * FROM run_attempts WHERE activation_id = ? AND attempt_number = ?",
      )
      .get(activationId, attemptNumber);
    if (existing) return this.#runAttemptFromRow(existing);

    const placementId =
      placementRow === undefined ? null : text(placementRow, "placement_id");
    if (
      placementRow !== undefined &&
      text(placementRow, "state") === "reserved"
    ) {
      this.#setPlacementState(placementRow, "consumed");
    }

    const runAttemptId = this.#createId("run");
    const startedAt = this.#timestamp();
    this.#database
      .prepare(
        "INSERT INTO run_attempts(run_attempt_id, placement_id, activation_id, room_id, participant_id, host_id, attempt_number, state, started_at) VALUES(?, ?, ?, ?, ?, ?, ?, 'starting', ?)",
      )
      .run(
        runAttemptId,
        placementId,
        activationId,
        text(activation, "room_id"),
        text(activation, "participant_id"),
        hostId,
        attemptNumber,
        startedAt,
      );
    const contextManifest = persistContextManifest(this.#database, {
      activation: activationProjectionFromRow(activation),
      ...(placementRow === undefined
        ? {}
        : {
            agentContext: agentRuntimeContextFromPlacement(
              this.#database,
              placementRow,
            ),
            placement: this.#placementFromRow(placementRow),
          }),
      contextManifestId: this.#createId("context_manifest"),
      createdAt: startedAt,
      runAttemptId,
    });
    this.#appendEvent({
      actorId: SYSTEM_PRINCIPAL_ID,
      aggregateId: runAttemptId,
      aggregateType: "run_attempt",
      idempotencyKey: `run.create:${runAttemptId}`,
      payload: {
        activationId,
        attemptNumber,
        hostId,
        contextManifestId: contextManifest.contextManifestId,
        runAttemptId,
        ...(placementId === null ? {} : { placementId }),
      },
      roomId: text(activation, "room_id"),
      type: "run.created",
    });
    return this.#runAttemptFromRow(this.#requireRunAttemptRow(runAttemptId));
  }
  #timestamp(): string {
    return this.#now().toISOString();
  }
  #transaction<T>(operation: () => T): T {
    return inImmediateTransaction(this.#database, operation);
  }
}
