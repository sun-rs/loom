import { threadViewerSummaries } from "./thread-viewer-summary.ts";
import { peerReplyReturn } from "./peer-reply-return.ts";
import { latestBlockingReplyMessageSeq } from "./reply-message-freshness.ts";
import { assertNoUnresolvedRuntimeCleanup } from "./runtime-process-cleanup.ts";
import {
  requireActiveInstancePrivateBox,
  requireRoleInstanceMembershipEntry,
} from "./instance-worker-scope.ts";
import { agentGreetingEnabled, firstRunReplay } from "./agent-first-run.ts";
import { heldDraftRecoveryTarget } from "./held-draft-recovery.ts";
import { recordWorkerTargetReadPosition } from "./worker-target-read-position.ts";
import type { DatabaseSync } from "node:sqlite";
import type {
  ChannelPrimaryDirectoryPreparer,
  PreparedChannelPrimaryDirectory,
} from "./room-kernel-options.ts";

import {
  ActivationReasonSchema,
  ChannelAttachedDirectoriesSchema,
  ChannelAttachedDirectorySchema,
  ClientWorkspaceUpdateRequestSchema,
  MembershipRoleSchema,
  ParticipantKindSchema,
  RoomSchema,
  RoomVisibilitySchema,
  WorkspaceSchema,
  type ActivationReason,
  type Attachment,
  type ChannelWorkspace,
  type MembershipRole,
  type Room,
  type RoomMembership,
  type Thread,
  type Workspace,
} from "@rah-os/protocol";

import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
  StaleContextError,
} from "./errors.ts";
import {
  requireHumanRoomOwner,
  requireRoomManager,
  requireRoomMember,
  requireRoomOwner,
} from "./collaboration-policy.ts";
import {
  newLegacyRoom,
  messageProjectionFromRow,
  roomMembershipProjectionFromRow,
  roomProjectionFromRow,
  threadProjectionFromRow,
  workspaceProjectionFromRow,
} from "./collaboration-projection.ts";
import { agentSharesVisibleRoom } from "./worker-read-targets.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import {
  followAgentThreadParticipants,
  listFollowingAgentThreadRecipients,
} from "./agent-thread-subscriptions.ts";
import {
  CONTINUE_ANYWAY_REHOLD_THRESHOLD,
  HELD_MESSAGE_DRAFT_TTL_MS,
  findActiveHeldMessageDraftForTarget,
  requireActiveHeldMessageDraft,
  resolveHeldMessageDrafts,
  resolveOneHeldMessageDraft,
} from "./held-message-drafts.ts";
import {
  freshnessHoldContext,
  NOT_SYSTEM_NOTICE_SQL,
} from "./freshness-hold-context.ts";
import { integer, nullableText, text, type Row } from "./sqlite-row.ts";
import { assertNoActiveRoomWork } from "./room-lifecycle-policy.ts";
import { workspaceRoomSlugIsAvailable } from "./message-reference-identity.ts";
import type {
  MessageMutationResult,
  MessagePage,
  Principal,
  RoomMutationResult,
  RoomMembershipMutationResult,
  RoomMembershipRemovalResult,
  ThreadMutationResult,
  WorkerMessagePostResult,
  WorkspaceMutationResult,
} from "./types.ts";

export type MessageRecipient = {
  participantId: string;
  reason: ActivationReason;
};

export type WorkspaceRoomCreateInput = {
  steerEnabled?: boolean | undefined;
  allowInstanceTaskCreation?: boolean | undefined;
  basedOnControlRoomSeq: number;
  description?: string | undefined;
  idempotencyKey: string;
  initialAgentParticipantIds?: string[] | undefined;
  kind: "channel";
  name: string;
  slug: string;
  visibility?: "public" | "private" | undefined;
  workspaceId: string;
  /** Owner 2026-09-26: fixed at creation; there is no later mutation. */
  additionalDirectories?: readonly string[] | undefined;
};

export type WorkspaceRoomUpdateInput = {
  steerEnabled?: boolean | undefined;
  allowInstanceTaskCreation?: boolean | undefined;
  basedOnRoomSeq: number;
  description?: string | undefined;
  idempotencyKey: string;
  name: string;
  roomId: string;
  visibility: "public" | "private";
};

export type WorkspaceRoomLifecycleInput = {
  basedOnRoomSeq: number;
  idempotencyKey: string;
  roomId: string;
};

export type DirectRoomOpenInput = {
  basedOnControlRoomSeq: number;
  idempotencyKey: string;
  peerPrincipalId: string;
  workspaceId: string;
};

export class CollaborationService {
  readonly #attachedDirectoryValidator:
    ((paths: readonly string[]) => void) | undefined;
  readonly #channelPrimaryDirectoryPreparer:
    ChannelPrimaryDirectoryPreparer | undefined;
  readonly #transaction: <T>(operation: () => T) => T;
  readonly #createId: (prefix: string) => string;
  readonly #database: DatabaseSync;
  readonly #events: RoomEventWriter;
  readonly #now: () => Date;

  constructor(input: {
    attachedDirectoryValidator?: (paths: readonly string[]) => void;
    channelPrimaryDirectoryPreparer?:
      ChannelPrimaryDirectoryPreparer | undefined;
    createId: (prefix: string) => string;
    database: DatabaseSync;
    events: RoomEventWriter;
    now: () => Date;
    transaction?: <T>(operation: () => T) => T;
  }) {
    this.#attachedDirectoryValidator = input.attachedDirectoryValidator;
    this.#channelPrimaryDirectoryPreparer =
      input.channelPrimaryDirectoryPreparer;
    this.#transaction = input.transaction ?? ((operation) => operation());
    this.#createId = input.createId;
    this.#database = input.database;
    this.#events = input.events;
    this.#now = input.now;
  }

  requireSameWorkspace(leftRoomId: string, rightRoomId: string): void {
    const leftWorkspaceId = text(this.#requireRoom(leftRoomId), "workspace_id");
    const rightWorkspaceId = text(
      this.#requireRoom(rightRoomId),
      "workspace_id",
    );
    if (leftWorkspaceId !== rightWorkspaceId) {
      throw new ForbiddenError(
        `Room ${rightRoomId} belongs to Workspace ${rightWorkspaceId}, not Workspace ${leftWorkspaceId}`,
      );
    }
  }

  createRoom(actor: Principal, input: { name: string; slug: string }): Room {
    requireHumanRoomOwner(actor);
    const room = newLegacyRoom(
      this.#createId("room"),
      input,
      this.#timestamp(),
    );
    this.#database
      .prepare(
        "INSERT INTO rooms(room_id, workspace_id, kind, slug, name, next_seq, created_at) VALUES(?, ?, ?, ?, ?, 1, ?)",
      )
      .run(
        room.roomId,
        room.workspaceId,
        room.kind,
        room.slug,
        room.name,
        room.createdAt,
      );
    this.#database
      .prepare(
        "INSERT INTO memberships(room_id, principal_id, role, joined_at) VALUES(?, ?, 'owner', ?)",
      )
      .run(room.roomId, actor.principalId, room.createdAt);
    this.#events.append({
      actorId: actor.principalId,
      aggregateId: room.roomId,
      aggregateType: "room",
      idempotencyKey: `room.create:${room.roomId}`,
      payload: {
        kind: room.kind,
        name: room.name,
        slug: room.slug,
        workspaceId: room.workspaceId,
      },
      roomId: room.roomId,
      type: "room.created",
    });
    return room;
  }

  createWorkspace(
    actor: Principal,
    input: { idempotencyKey: string; name: string; slug: string },
  ): WorkspaceMutationResult {
    if (actor.kind !== "human") {
      throw new ForbiddenError("only Human principals can create Workspaces");
    }
    const name = this.#requiredLabel(input.name, "workspace name");
    const slug = this.#requiredLabel(input.slug, "workspace slug");
    const idempotencyKey = this.#requiredLabel(
      input.idempotencyKey,
      "idempotencyKey",
    );
    const previous = this.#database
      .prepare(
        `SELECT * FROM room_events
         WHERE actor_id = ? AND idempotency_key = ?
         ORDER BY created_at, event_id
         LIMIT 1`,
      )
      .get(actor.principalId, idempotencyKey);
    if (previous !== undefined) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== "workspace.created" ||
        event.aggregateType !== "workspace" ||
        event.payload.name !== name ||
        event.payload.slug !== slug
      ) {
        throw this.#idempotencyConflict(idempotencyKey);
      }
      const workspace = this.#workspaceFromId(event.aggregateId);
      if (workspace.controlRoomId === undefined) {
        throw new ConflictError(
          `Workspace ${workspace.workspaceId} has no control Room`,
        );
      }
      return {
        controlRoom: this.#roomFromId(workspace.controlRoomId),
        deduplicated: true,
        event,
        workspace,
      };
    }
    if (
      this.#database
        .prepare("SELECT 1 AS present FROM workspaces WHERE slug = ?")
        .get(slug) !== undefined
    ) {
      throw new ConflictError(`Workspace slug ${slug} is already in use`);
    }

    const createdAt = this.#timestamp();
    const workspaceId = this.#createId("workspace");
    const controlRoomId = this.#createId("room");
    this.#database
      .prepare(
        "INSERT INTO workspaces(workspace_id, slug, name, state, created_at) VALUES(?, ?, ?, 'active', ?)",
      )
      .run(workspaceId, slug, name, createdAt);
    this.#database
      .prepare(
        "INSERT INTO rooms(room_id, workspace_id, kind, slug, name, next_seq, created_at) VALUES(?, ?, 'control', 'control', ?, 1, ?)",
      )
      .run(controlRoomId, workspaceId, `${name} Control`, createdAt);
    this.#database
      .prepare(
        "INSERT INTO memberships(room_id, principal_id, role, joined_at) VALUES(?, ?, 'owner', ?)",
      )
      .run(controlRoomId, actor.principalId, createdAt);
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: workspaceId,
      aggregateType: "workspace",
      idempotencyKey,
      payload: { controlRoomId, name, slug },
      roomId: controlRoomId,
      type: "workspace.created",
    });
    return {
      controlRoom: this.#roomFromId(controlRoomId),
      deduplicated: false,
      event,
      workspace: this.#workspaceFromId(workspaceId),
    };
  }

  updateWorkspace(
    actor: Principal,
    rawInput: import("@rah-os/protocol").ClientWorkspaceUpdateRequest,
  ): WorkspaceMutationResult {
    const input = ClientWorkspaceUpdateRequestSchema.parse(rawInput);
    requireHumanRoomOwner(actor);
    const workspace = this.#workspaceFromId(input.workspaceId);
    if (workspace.state !== "active" || !workspace.controlRoomId)
      throw new ConflictError("Workspace is not active or has no control Room");
    const roomId = workspace.controlRoomId;
    requireRoomManager(this.#database, roomId, actor.principalId);
    const previous = this.#findEvent(roomId, input.idempotencyKey);
    if (previous !== undefined) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== "workspace.updated" ||
        event.actorId !== actor.principalId ||
        event.aggregateId !== input.workspaceId ||
        event.payload.name !== input.name ||
        event.payload.avatarKey !== input.avatarKey ||
        event.payload.agentAllChannelGreetingEnabled !==
          input.agentAllChannelGreetingEnabled
      )
        throw this.#idempotencyConflict(input.idempotencyKey);
      return {
        controlRoom: this.#roomFromId(roomId),
        deduplicated: true,
        event,
        workspace,
      };
    }
    this.#assertFreshContext(roomId, actor, input.basedOnControlRoomSeq);
    this.#database
      .prepare(
        "UPDATE workspaces SET name = ?, avatar_key = ? WHERE workspace_id = ?",
      )
      .run(input.name, input.avatarKey, input.workspaceId);
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: input.workspaceId,
      aggregateType: "workspace",
      idempotencyKey: input.idempotencyKey,
      payload: {
        name: input.name,
        avatarKey: input.avatarKey,
        ...(input.agentAllChannelGreetingEnabled === undefined
          ? {}
          : {
              agentAllChannelGreetingEnabled:
                input.agentAllChannelGreetingEnabled,
            }),
      },
      roomId,
      type: "workspace.updated",
    });
    return {
      controlRoom: this.#roomFromId(roomId),
      deduplicated: false,
      event,
      workspace: this.#workspaceFromId(input.workspaceId),
    };
  }

  /**
   * One transaction; P2-2 option A: a primary directory the Host prepared
   * inside it is rolled back when the transaction does not commit.
   */
  createWorkspaceRoomAtomically(
    actor: () => Principal,
    input: WorkspaceRoomCreateInput,
  ): RoomMutationResult {
    let prepared: PreparedChannelPrimaryDirectory | undefined;
    try {
      return this.#transaction(() =>
        this.createWorkspaceRoom(actor(), input, (directory) => {
          prepared = directory;
        }),
      );
    } catch (error) {
      try {
        prepared?.rollback();
      } catch {
        // The creation error is the diagnosis; an unremovable directory is
        // left in place (its room id is never reused).
      }
      throw error;
    }
  }

  createWorkspaceRoom(
    actor: Principal,
    input: WorkspaceRoomCreateInput,
    onPrimaryDirectoryPrepared?: (
      prepared: PreparedChannelPrimaryDirectory,
    ) => void,
  ): RoomMutationResult {
    if (actor.kind !== "human") {
      throw new ForbiddenError("only Human principals can create Rooms");
    }
    const workspace = this.#workspaceFromId(input.workspaceId);
    if (workspace.state !== "active") {
      throw new ConflictError(`Workspace ${input.workspaceId} is archived`);
    }
    if (workspace.controlRoomId === undefined) {
      throw new ConflictError(
        `Workspace ${input.workspaceId} is not managed by a control Room`,
      );
    }
    requireRoomManager(
      this.#database,
      workspace.controlRoomId,
      actor.principalId,
    );
    if (input.kind !== "channel") {
      throw new Error("initial managed Room creation only supports channel");
    }
    const name = this.#requiredLabel(input.name, "room name");
    const slug = this.#requiredLabel(input.slug, "room slug");
    const description = input.description?.trim() || undefined;
    const visibility = RoomVisibilitySchema.parse(
      input.visibility ?? "private",
    );
    const initialAgentParticipantIds = [
      ...new Set(input.initialAgentParticipantIds ?? []),
    ].sort();
    for (const principalId of initialAgentParticipantIds) {
      // A new channel is always another channel for an existing instance.
      if (
        this.#database
          .prepare("SELECT 1 FROM role_instances WHERE instance_id=?")
          .get(principalId)
      )
        throw new ForbiddenError("Role instance cannot join another channel");
      const principal = this.#requirePrincipalRow(principalId);
      if (ParticipantKindSchema.parse(principal.kind) !== "agent") {
        throw new ForbiddenError(
          `initial Channel participant ${principalId} is not an Agent`,
        );
      }
      requireRoomMember(this.#database, workspace.controlRoomId, principalId);
    }
    const attached = ChannelAttachedDirectoriesSchema.safeParse([
      ...(input.additionalDirectories ?? []),
    ]);
    if (!attached.success)
      throw new ConflictError(
        `Attached directories are invalid: ${attached.error.issues[0]?.message ?? "invalid"}`,
      );
    const channelWorkspace: ChannelWorkspace = {
      kind: "channel_home",
      additionalDirectories: attached.data,
    };
    const idempotencyKey = this.#requiredLabel(
      input.idempotencyKey,
      "idempotencyKey",
    );
    const previous = this.#findEvent(workspace.controlRoomId, idempotencyKey);
    if (previous !== undefined) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== "workspace.room_created" ||
        event.actorId !== actor.principalId ||
        event.aggregateType !== "room" ||
        event.payload.workspaceId !== input.workspaceId ||
        event.payload.kind !== input.kind ||
        event.payload.name !== name ||
        event.payload.slug !== slug ||
        event.payload.description !== description ||
        event.payload.visibility !== visibility ||
        (event.payload.steerEnabled ?? true) !== (input.steerEnabled ?? true) ||
        (event.payload.allowInstanceTaskCreation ?? false) !==
          (input.allowInstanceTaskCreation ?? false) ||
        JSON.stringify(event.payload.initialAgentParticipantIds) !==
          JSON.stringify(initialAgentParticipantIds) ||
        JSON.stringify(
          (event.payload.channelWorkspace as ChannelWorkspace | undefined)
            ?.additionalDirectories ?? [],
        ) !== JSON.stringify(channelWorkspace.additionalDirectories)
      ) {
        throw this.#idempotencyConflict(idempotencyKey);
      }
      return {
        deduplicated: true,
        event,
        room: this.#roomFromId(event.aggregateId),
      };
    }
    this.#assertFreshContext(
      workspace.controlRoomId,
      actor,
      input.basedOnControlRoomSeq,
    );
    if (channelWorkspace.additionalDirectories.length > 0) {
      // Host filesystem facts are checked only for a new mutation; a replay
      // returns the recorded result even if a directory later disappeared.
      if (this.#attachedDirectoryValidator === undefined)
        throw new ConflictError(
          "Attached Channel directories are unavailable on this Core",
        );
      try {
        this.#attachedDirectoryValidator(
          channelWorkspace.additionalDirectories,
        );
      } catch (error) {
        throw new ConflictError(
          `Attached directory rejected: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (
      !workspaceRoomSlugIsAvailable(this.#database, input.workspaceId, slug)
    ) {
      throw new ConflictError(
        `Room slug ${slug} is already in use in Workspace ${input.workspaceId}`,
      );
    }

    const roomId = this.#createId("room");
    const createdAt = this.#timestamp();
    // P2-2 option A: the Host creates the primary directory now, after every
    // Kernel check passed. Its path is recorded and never re-derived; a
    // failure leaves no Channel. Without a Host preparer (tests, a Core with
    // no Host) the Host creates it lazily at the first binding.
    let recordedWorkspace: ChannelWorkspace = channelWorkspace;
    if (this.#channelPrimaryDirectoryPreparer !== undefined) {
      let prepared: PreparedChannelPrimaryDirectory;
      try {
        prepared = this.#channelPrimaryDirectoryPreparer(
          roomId,
          channelWorkspace.additionalDirectories,
        );
      } catch (error) {
        throw new ConflictError(
          `Channel primary directory could not be created: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      onPrimaryDirectoryPrepared?.(prepared);
      const primaryDirectory = ChannelAttachedDirectorySchema.safeParse(
        prepared.primaryDirectory,
      );
      if (
        !primaryDirectory.success ||
        !primaryDirectory.data.endsWith(`/${roomId}`)
      )
        throw new ConflictError(
          "Channel primary directory is not an absolute path for this Channel",
        );
      recordedWorkspace = {
        ...channelWorkspace,
        primaryDirectory: primaryDirectory.data,
      };
    }
    this.#database
      .prepare(
        "INSERT INTO rooms(room_id, workspace_id, kind, slug, name, description, visibility, next_seq, created_at, channel_workspace_json, channel_workspace_state_json, channel_steer_enabled, allow_instance_task_creation) VALUES(?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)",
      )
      .run(
        roomId,
        input.workspaceId,
        input.kind,
        slug,
        name,
        description ?? null,
        visibility,
        createdAt,
        JSON.stringify(recordedWorkspace),
        // The Host's successful preparation is its readiness receipt.
        recordedWorkspace.primaryDirectory === undefined
          ? null
          : JSON.stringify({ state: "ready", updatedAt: createdAt }),
        input.steerEnabled === false ? 0 : 1,
        input.allowInstanceTaskCreation === true ? 1 : 0,
      );
    this.#database
      .prepare(
        "INSERT INTO memberships(room_id, principal_id, role, joined_at) VALUES(?, ?, 'owner', ?)",
      )
      .run(roomId, actor.principalId, createdAt);
    this.#events.append({
      actorId: actor.principalId,
      aggregateId: roomId,
      aggregateType: "room",
      idempotencyKey: `room.bootstrap:${idempotencyKey}`,
      payload: {
        steerEnabled: input.steerEnabled ?? true,
        allowInstanceTaskCreation: input.allowInstanceTaskCreation ?? false,
        channelWorkspace: recordedWorkspace,
        ...(description === undefined ? {} : { description }),
        initialAgentParticipantIds,
        kind: input.kind,
        name,
        slug,
        visibility,
        workspaceId: input.workspaceId,
      },
      roomId,
      type: "room.created",
    });
    const initialMemberIds = new Set(initialAgentParticipantIds);
    if (visibility === "public") {
      const workspaceHumans = this.#database
        .prepare(
          `SELECT principals.principal_id
           FROM memberships
           JOIN principals
             ON principals.principal_id = memberships.principal_id
           WHERE memberships.room_id = ?
             AND principals.kind = 'human'`,
        )
        .all(workspace.controlRoomId);
      for (const row of workspaceHumans) {
        const principalId = text(row, "principal_id");
        if (principalId !== actor.principalId)
          initialMemberIds.add(principalId);
      }
    }
    for (const principalId of [...initialMemberIds].sort()) {
      this.#database
        .prepare(
          "INSERT INTO memberships(room_id, principal_id, role, joined_at) VALUES(?, ?, 'member', ?)",
        )
        .run(roomId, principalId, createdAt);
      this.#events.append({
        actorId: actor.principalId,
        aggregateId: principalId,
        aggregateType: "membership",
        idempotencyKey: `${idempotencyKey}:initial:${principalId}`,
        payload: { participantId: principalId, role: "member" },
        roomId,
        type: "membership.added",
      });
    }
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: roomId,
      aggregateType: "room",
      idempotencyKey,
      payload: {
        basedOnControlRoomSeq: input.basedOnControlRoomSeq,
        steerEnabled: input.steerEnabled ?? true,
        allowInstanceTaskCreation: input.allowInstanceTaskCreation ?? false,
        channelWorkspace: recordedWorkspace,
        ...(description === undefined ? {} : { description }),
        initialAgentParticipantIds,
        kind: input.kind,
        name,
        slug,
        visibility,
        workspaceId: input.workspaceId,
      },
      roomId: workspace.controlRoomId,
      type: "workspace.room_created",
    });
    return {
      deduplicated: false,
      event,
      room: this.#roomFromId(roomId),
    };
  }

  updateWorkspaceRoom(
    actor: Principal,
    input: WorkspaceRoomUpdateInput,
  ): RoomMutationResult {
    if (actor.kind !== "human") {
      throw new ForbiddenError("only Human principals can update Rooms");
    }
    const existing = this.#requireRoom(input.roomId);
    if (text(existing, "kind") !== "channel") {
      throw new ConflictError("only managed Channels have editable settings");
    }
    requireRoomManager(this.#database, input.roomId, actor.principalId);
    const name = this.#requiredLabel(input.name, "room name");
    const description = input.description?.trim() || undefined;
    const visibility = RoomVisibilitySchema.parse(input.visibility);
    const idempotencyKey = this.#requiredLabel(
      input.idempotencyKey,
      "idempotencyKey",
    );
    const previous = this.#findEvent(input.roomId, idempotencyKey);
    if (previous !== undefined) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== "room.updated" ||
        event.actorId !== actor.principalId ||
        event.aggregateType !== "room" ||
        event.aggregateId !== input.roomId ||
        event.payload.name !== name ||
        event.payload.description !== description ||
        event.payload.visibility !== visibility ||
        event.payload.steerEnabled !== input.steerEnabled ||
        event.payload.allowInstanceTaskCreation !==
          input.allowInstanceTaskCreation
      ) {
        throw this.#idempotencyConflict(idempotencyKey);
      }
      return {
        deduplicated: true,
        event,
        room: this.#roomFromId(input.roomId),
      };
    }
    this.#assertFreshContext(input.roomId, actor, input.basedOnRoomSeq);
    const previousName = text(existing, "name");
    const previousDescription =
      existing.description === null || existing.description === undefined
        ? undefined
        : text(existing, "description");
    const previousVisibility = RoomVisibilitySchema.parse(
      text(existing, "visibility"),
    );
    this.#database
      .prepare(
        "UPDATE rooms SET name = ?, description = ?, visibility = ?, channel_steer_enabled = COALESCE(?, channel_steer_enabled), allow_instance_task_creation = COALESCE(?, allow_instance_task_creation) WHERE room_id = ?",
      )
      .run(
        name,
        description ?? null,
        visibility,
        input.steerEnabled === undefined ? null : Number(input.steerEnabled),
        input.allowInstanceTaskCreation === undefined
          ? null
          : Number(input.allowInstanceTaskCreation),
        input.roomId,
      );

    const addedHumanParticipantIds: string[] = [];
    if (previousVisibility !== "public" && visibility === "public") {
      const workspace = this.#workspaceFromId(text(existing, "workspace_id"));
      if (workspace.controlRoomId === undefined) {
        throw new ConflictError(
          `Workspace ${workspace.workspaceId} has no control Room`,
        );
      }
      const workspaceHumans = this.#database
        .prepare(
          `SELECT principals.principal_id
           FROM memberships
           JOIN principals
             ON principals.principal_id = memberships.principal_id
           WHERE memberships.room_id = ?
             AND principals.kind = 'human'
             AND NOT EXISTS (
               SELECT 1
               FROM memberships AS channel_memberships
               WHERE channel_memberships.room_id = ?
                 AND channel_memberships.principal_id = principals.principal_id
             )
           ORDER BY principals.principal_id`,
        )
        .all(workspace.controlRoomId, input.roomId);
      const joinedAt = this.#timestamp();
      for (const row of workspaceHumans) {
        const principalId = text(row, "principal_id");
        this.#database
          .prepare(
            "INSERT INTO memberships(room_id, principal_id, role, joined_at) VALUES(?, ?, 'member', ?)",
          )
          .run(input.roomId, principalId, joinedAt);
        this.#events.append({
          actorId: actor.principalId,
          aggregateId: principalId,
          aggregateType: "membership",
          idempotencyKey: `${idempotencyKey}:public:${principalId}`,
          payload: {
            participantId: principalId,
            reason: "channel_became_public",
            role: "member",
          },
          roomId: input.roomId,
          type: "membership.added",
        });
        addedHumanParticipantIds.push(principalId);
      }
    }
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: input.roomId,
      aggregateType: "room",
      idempotencyKey,
      payload: {
        addedHumanParticipantIds,
        basedOnRoomSeq: input.basedOnRoomSeq,
        ...(description === undefined ? {} : { description }),
        name,
        ...(previousDescription === undefined ? {} : { previousDescription }),
        previousName,
        previousVisibility,
        ...(input.allowInstanceTaskCreation === undefined
          ? {}
          : { allowInstanceTaskCreation: input.allowInstanceTaskCreation }),
        ...(input.steerEnabled === undefined
          ? {}
          : { steerEnabled: input.steerEnabled }),
        visibility,
      },
      roomId: input.roomId,
      type: "room.updated",
    });
    return {
      deduplicated: false,
      event,
      room: this.#roomFromId(input.roomId),
    };
  }

  archiveWorkspaceRoom(
    actor: Principal,
    input: WorkspaceRoomLifecycleInput,
  ): RoomMutationResult {
    return this.#changeWorkspaceRoomArchiveState(actor, input, true);
  }

  unarchiveWorkspaceRoom(
    actor: Principal,
    input: WorkspaceRoomLifecycleInput,
  ): RoomMutationResult {
    return this.#changeWorkspaceRoomArchiveState(actor, input, false);
  }

  #changeWorkspaceRoomArchiveState(
    actor: Principal,
    input: WorkspaceRoomLifecycleInput,
    archive: boolean,
  ): RoomMutationResult {
    if (actor.kind !== "human") {
      throw new ForbiddenError("only Human principals can archive Rooms");
    }
    const existing = this.#requireRoom(input.roomId);
    if (text(existing, "kind") !== "channel") {
      throw new ConflictError("only managed Channels can be archived");
    }
    requireRoomManager(this.#database, input.roomId, actor.principalId);
    const idempotencyKey = this.#requiredLabel(
      input.idempotencyKey,
      "idempotencyKey",
    );
    const expectedType = archive ? "room.archived" : "room.unarchived";
    const previous = this.#findEvent(input.roomId, idempotencyKey);
    if (previous !== undefined) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== expectedType ||
        event.actorId !== actor.principalId ||
        event.aggregateType !== "room" ||
        event.aggregateId !== input.roomId
      ) {
        throw this.#idempotencyConflict(idempotencyKey);
      }
      return {
        deduplicated: true,
        event,
        room: this.#roomFromId(input.roomId),
      };
    }
    const archivedAt = nullableText(existing, "archived_at");
    if (archive ? archivedAt !== null : archivedAt === null) {
      throw new ConflictError(
        `Room ${input.roomId} is already ${archive ? "archived" : "active"}`,
      );
    }
    this.#assertFreshContext(input.roomId, actor, input.basedOnRoomSeq);
    const changedAt = this.#timestamp();
    if (archive) {
      assertNoActiveRoomWork(this.#database, input.roomId);
    } else {
      this.#database
        .prepare("UPDATE rooms SET archived_at = NULL WHERE room_id = ?")
        .run(input.roomId);
    }
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: input.roomId,
      aggregateType: "room",
      idempotencyKey,
      payload: {
        basedOnRoomSeq: input.basedOnRoomSeq,
        changedAt,
      },
      roomId: input.roomId,
      type: expectedType,
    });
    if (archive) {
      this.#database
        .prepare("UPDATE rooms SET archived_at = ? WHERE room_id = ?")
        .run(changedAt, input.roomId);
    }
    return {
      deduplicated: false,
      event,
      room: this.#roomFromId(input.roomId),
    };
  }

  openDirectRoom(actor: Principal, input: DirectRoomOpenInput): Room {
    // A non-Human opener is fenced by the directory it can already see and
    // address — the `memberships` predicate behind `profile-show --target
    // @HANDLE`, `room-members` and `@mention` handle resolution. Humans keep
    // the Workspace-wide reach the control-Room fences below already give them.
    if (
      actor.kind !== "human" &&
      !agentSharesVisibleRoom(
        this.#database,
        actor.principalId,
        input.peerPrincipalId,
      )
    ) {
      throw new ForbiddenError(
        `${actor.principalId} shares no visible Room with Direct Room peer ${input.peerPrincipalId}`,
      );
    }
    if (input.peerPrincipalId === actor.principalId) {
      throw new ConflictError(
        "a principal cannot open a Direct Room with itself",
      );
    }
    const workspace = this.#workspaceFromId(input.workspaceId);
    if (workspace.state !== "active") {
      throw new ConflictError(`Workspace ${input.workspaceId} is archived`);
    }
    if (workspace.controlRoomId === undefined) {
      throw new ConflictError(
        `Workspace ${input.workspaceId} is not managed by a control Room`,
      );
    }
    requireRoomMember(
      this.#database,
      workspace.controlRoomId,
      actor.principalId,
    );
    const peer = this.#requirePrincipalRow(input.peerPrincipalId);
    const instance = this.#database
      .prepare("SELECT channel_id FROM role_instances WHERE instance_id=?")
      .get(input.peerPrincipalId);
    const actorIsInstance = this.#database
      .prepare("SELECT 1 FROM role_instances WHERE instance_id=?")
      .get(actor.principalId);
    if (actorIsInstance || (instance && actor.kind !== "human"))
      throw new ForbiddenError("Only a Human can open an instance private box");
    if (instance) {
      requireRoomMember(
        this.#database,
        text(instance, "channel_id"),
        actor.principalId,
      );
      requireRoomMember(
        this.#database,
        text(instance, "channel_id"),
        input.peerPrincipalId,
      );
    }
    if (
      this.#membershipRow(workspace.controlRoomId, input.peerPrincipalId) ===
      undefined
    ) {
      throw new ForbiddenError(
        `Direct Room peer ${input.peerPrincipalId} must belong to the same Workspace`,
      );
    }
    const idempotencyKey = this.#requiredLabel(
      input.idempotencyKey,
      "idempotencyKey",
    );
    const previous = this.#findEvent(workspace.controlRoomId, idempotencyKey);
    if (previous !== undefined) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== "workspace.direct_opened" ||
        event.actorId !== actor.principalId ||
        event.aggregateType !== "room" ||
        event.payload.peerPrincipalId !== input.peerPrincipalId ||
        event.payload.workspaceId !== input.workspaceId
      ) {
        throw this.#idempotencyConflict(idempotencyKey);
      }
      return this.#roomFromId(event.aggregateId);
    }

    const actorSortsFirst =
      actor.principalId.localeCompare(input.peerPrincipalId) < 0;
    const leftPrincipalId = actorSortsFirst
      ? actor.principalId
      : input.peerPrincipalId;
    const rightPrincipalId = actorSortsFirst
      ? input.peerPrincipalId
      : actor.principalId;
    const existingPair = this.#database
      .prepare(
        `SELECT room_id FROM direct_room_pairs
         WHERE workspace_id = ?
           AND left_principal_id = ?
           AND right_principal_id = ?`,
      )
      .get(input.workspaceId, leftPrincipalId, rightPrincipalId);
    if (existingPair !== undefined) {
      return this.#roomFromId(text(existingPair, "room_id"));
    }

    this.#assertFreshContext(
      workspace.controlRoomId,
      actor,
      input.basedOnControlRoomSeq,
    );
    const roomId = this.#createId("room");
    const createdAt = this.#timestamp();
    const peerIdentity = this.#database
      .prepare(
        `SELECT COALESCE(
           json_extract(agent_revision.definition_json, '$.displayName'),
           principals.handle
         ) AS display_name
         FROM principals
         LEFT JOIN agent_definitions
           ON agent_definitions.participant_id = principals.principal_id
          AND agent_definitions.control_room_id = ?
         LEFT JOIN agent_definition_revisions AS agent_revision
           ON agent_revision.agent_definition_revision_id =
              agent_definitions.current_revision_id
         WHERE principals.principal_id = ?`,
      )
      .get(workspace.controlRoomId, input.peerPrincipalId);
    const name = this.#requiredLabel(
      peerIdentity === undefined
        ? text(peer, "handle")
        : text(peerIdentity, "display_name"),
      "peer display name",
    );
    const slug = `dm-${roomId}`;
    this.#database
      .prepare(
        "INSERT INTO rooms(room_id, workspace_id, kind, slug, name, next_seq, created_at) VALUES(?, ?, 'direct', ?, ?, 1, ?)",
      )
      .run(roomId, input.workspaceId, slug, name, createdAt);
    const insertMembership = this.#database.prepare(
      "INSERT INTO memberships(room_id, principal_id, role, joined_at) VALUES(?, ?, 'member', ?)",
    );
    insertMembership.run(roomId, actor.principalId, createdAt);
    insertMembership.run(roomId, input.peerPrincipalId, createdAt);
    this.#database
      .prepare(
        "INSERT INTO direct_room_pairs(workspace_id, left_principal_id, right_principal_id, room_id) VALUES(?, ?, ?, ?)",
      )
      .run(input.workspaceId, leftPrincipalId, rightPrincipalId, roomId);
    this.#events.append({
      actorId: actor.principalId,
      aggregateId: roomId,
      aggregateType: "room",
      idempotencyKey: `room.bootstrap:${idempotencyKey}`,
      payload: {
        kind: "direct",
        name,
        participantIds: [leftPrincipalId, rightPrincipalId],
        slug,
        workspaceId: input.workspaceId,
      },
      roomId,
      type: "room.created",
    });
    this.#events.append({
      actorId: actor.principalId,
      aggregateId: roomId,
      aggregateType: "room",
      idempotencyKey,
      payload: {
        basedOnControlRoomSeq: input.basedOnControlRoomSeq,
        peerPrincipalId: input.peerPrincipalId,
        workspaceId: input.workspaceId,
      },
      roomId: workspace.controlRoomId,
      type: "workspace.direct_opened",
    });
    return this.#roomFromId(roomId);
  }

  addMember(
    actorId: string,
    input: { principalId: string; roomId: string },
  ): void {
    requireRoleInstanceMembershipEntry(
      this.#database,
      input.principalId,
      input.roomId,
    );
    this.#assertMutableMembershipRoom(input.roomId);
    requireRoomManager(this.#database, input.roomId, actorId);
    this.#requirePrincipal(input.principalId);
    const joinedAt = this.#timestamp();
    const result = this.#database
      .prepare(
        "INSERT OR IGNORE INTO memberships(room_id, principal_id, role, joined_at) VALUES(?, ?, 'member', ?)",
      )
      .run(input.roomId, input.principalId, joinedAt);
    if (Number(result.changes) === 0) return;
    this.#events.append({
      actorId,
      aggregateId: input.principalId,
      aggregateType: "membership",
      idempotencyKey: `membership.add:${input.principalId}`,
      payload: { participantId: input.principalId },
      roomId: input.roomId,
      type: "membership.added",
    });
  }

  listWorkspaces(actorId: string): Workspace[] {
    return this.#database
      .prepare(
        `SELECT DISTINCT
           workspaces.workspace_id,
           workspaces.slug AS workspace_slug,
           workspaces.name AS workspace_name,
           workspaces.avatar_key AS workspace_avatar_key,
           workspaces.state AS workspace_state,
           workspaces.created_at AS workspace_created_at,
           workspaces.archived_at AS workspace_archived_at,
           control_room.room_id AS workspace_control_room_id
         FROM workspaces
         JOIN rooms ON rooms.workspace_id = workspaces.workspace_id
         JOIN memberships ON memberships.room_id = rooms.room_id
         LEFT JOIN rooms AS control_room
           ON control_room.workspace_id = workspaces.workspace_id
          AND control_room.kind = 'control'
         WHERE memberships.principal_id = ?
         ORDER BY workspaces.slug, workspaces.workspace_id`,
      )
      .all(actorId)
      .map((row) => ({
        ...workspaceProjectionFromRow(row),
        agentAllChannelGreetingEnabled: agentGreetingEnabled(
          this.#database,
          typeof row.workspace_control_room_id === "string"
            ? row.workspace_control_room_id
            : undefined,
        ),
      }));
  }

  listRooms(actorId: string, input: { workspaceId?: string } = {}): Room[] {
    return this.#database
      .prepare(
        `SELECT rooms.*, direct_room_pairs.left_principal_id, direct_room_pairs.right_principal_id
         FROM rooms
         JOIN memberships ON memberships.room_id = rooms.room_id
         LEFT JOIN direct_room_pairs ON direct_room_pairs.room_id = rooms.room_id
         WHERE memberships.principal_id = ? AND rooms.system_hidden=0
           AND (? IS NULL OR rooms.workspace_id = ?)
         ORDER BY rooms.slug, rooms.room_id`,
      )
      .all(actorId, input.workspaceId ?? null, input.workspaceId ?? null)
      .map((row) => roomProjectionFromRow(row));
  }

  listRoomMemberships(actorId: string, roomId: string): RoomMembership[] {
    requireRoomMember(this.#database, roomId, actorId);
    return this.#database
      .prepare(
        "SELECT * FROM memberships WHERE room_id = ? ORDER BY role, principal_id",
      )
      .all(roomId)
      .map((row) => roomMembershipProjectionFromRow(row));
  }

  addRoomMember(
    actor: Principal,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      principalId: string;
      role: MembershipRole;
      roomId: string;
    },
  ): RoomMembershipMutationResult {
    requireRoleInstanceMembershipEntry(
      this.#database,
      input.principalId,
      input.roomId,
    );
    this.#assertMutableMembershipRoom(input.roomId);
    const actorRole = requireRoomManager(
      this.#database,
      input.roomId,
      actor.principalId,
    );
    const role = MembershipRoleSchema.parse(input.role);
    if (role !== "member" && actorRole !== "owner") {
      throw new ForbiddenError("only a Room owner can grant elevated roles");
    }
    this.#requireRolePrincipal(input.principalId, role);
    const replay = this.#membershipReplay(actor.principalId, input, {
      eventType: "membership.added",
      payload: { participantId: input.principalId, role },
    });
    if (replay !== null) return replay;
    this.#assertFreshContext(input.roomId, actor, input.basedOnRoomSeq);
    if (this.#membershipRow(input.roomId, input.principalId) !== undefined) {
      throw new ConflictError(
        `principal ${input.principalId} is already a member of Room ${input.roomId}`,
      );
    }
    const joinedAt = this.#timestamp();
    this.#database
      .prepare(
        "INSERT INTO memberships(room_id, principal_id, role, joined_at) VALUES(?, ?, ?, ?)",
      )
      .run(input.roomId, input.principalId, role, joinedAt);
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: input.principalId,
      aggregateType: "membership",
      idempotencyKey: input.idempotencyKey,
      payload: {
        basedOnRoomSeq: input.basedOnRoomSeq,
        participantId: input.principalId,
        role,
      },
      roomId: input.roomId,
      type: "membership.added",
    });
    return {
      deduplicated: false,
      event,
      membership: this.#membershipFromIds(input.roomId, input.principalId),
    };
  }

  setRoomMemberRole(
    actor: Principal,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      principalId: string;
      role: MembershipRole;
      roomId: string;
    },
  ): RoomMembershipMutationResult {
    this.#assertMutableMembershipRoom(input.roomId);
    requireRoomOwner(this.#database, input.roomId, actor.principalId);
    const role = MembershipRoleSchema.parse(input.role);
    this.#requireRolePrincipal(input.principalId, role);
    const replay = this.#membershipReplay(actor.principalId, input, {
      eventType: "membership.role_changed",
      payload: { participantId: input.principalId, role },
    });
    if (replay !== null) return replay;
    this.#assertFreshContext(input.roomId, actor, input.basedOnRoomSeq);
    const membership = this.#membershipFromIds(input.roomId, input.principalId);
    if (membership.role === "owner" && role !== "owner") {
      const ownerCount = this.#database
        .prepare(
          "SELECT COUNT(*) AS count FROM memberships WHERE room_id = ? AND role = 'owner'",
        )
        .get(input.roomId);
      if (integer(ownerCount!, "count") <= 1) {
        throw new ConflictError("cannot demote the last owner of a Room");
      }
    }
    this.#database
      .prepare(
        "UPDATE memberships SET role = ? WHERE room_id = ? AND principal_id = ?",
      )
      .run(role, input.roomId, input.principalId);
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: input.principalId,
      aggregateType: "membership",
      idempotencyKey: input.idempotencyKey,
      payload: {
        basedOnRoomSeq: input.basedOnRoomSeq,
        participantId: input.principalId,
        previousRole: membership.role,
        role,
      },
      roomId: input.roomId,
      type: "membership.role_changed",
    });
    return {
      deduplicated: false,
      event,
      membership: this.#membershipFromIds(input.roomId, input.principalId),
    };
  }

  removeRoomMember(
    actor: Principal,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      principalId: string;
      roomId: string;
    },
  ): RoomMembershipRemovalResult {
    this.#assertMutableMembershipRoom(input.roomId);
    const previous = this.#findEvent(input.roomId, input.idempotencyKey);
    if (previous !== undefined) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== "membership.removed" ||
        event.actorId !== actor.principalId ||
        event.aggregateType !== "membership" ||
        event.aggregateId !== input.principalId ||
        event.payload.participantId !== input.principalId
      ) {
        throw this.#idempotencyConflict(input.idempotencyKey);
      }
      return {
        deduplicated: true,
        event,
        removedPrincipalId: input.principalId,
      };
    }

    const actorRole = requireRoomManager(
      this.#database,
      input.roomId,
      actor.principalId,
    );
    this.#assertFreshContext(input.roomId, actor, input.basedOnRoomSeq);
    const membership = this.#membershipFromIds(input.roomId, input.principalId);
    if (membership.role !== "member" && actorRole !== "owner") {
      throw new ForbiddenError(
        "only a Room owner can remove an owner or admin",
      );
    }
    if (membership.role === "owner") {
      const ownerCount = this.#database
        .prepare(
          "SELECT COUNT(*) AS count FROM memberships WHERE room_id = ? AND role = 'owner'",
        )
        .get(input.roomId);
      if (integer(ownerCount!, "count") <= 1) {
        throw new ConflictError("cannot remove the last owner of a Room");
      }
    }
    this.#assertNoActiveMembershipWork(input.roomId, input.principalId);
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: input.principalId,
      aggregateType: "membership",
      idempotencyKey: input.idempotencyKey,
      payload: {
        basedOnRoomSeq: input.basedOnRoomSeq,
        participantId: input.principalId,
        previousRole: membership.role,
      },
      roomId: input.roomId,
      type: "membership.removed",
    });
    this.#database
      .prepare("DELETE FROM memberships WHERE room_id = ? AND principal_id = ?")
      .run(input.roomId, input.principalId);
    return {
      deduplicated: false,
      event,
      removedPrincipalId: input.principalId,
    };
  }

  leaveRoom(
    actor: Principal,
    input: WorkspaceRoomLifecycleInput,
  ): RoomMembershipRemovalResult {
    if (actor.kind !== "human") {
      throw new ForbiddenError("only Human principals can leave Channels");
    }
    const room = this.#requireRoom(input.roomId);
    if (text(room, "kind") !== "channel") {
      throw new ConflictError("only regular Channels can be left");
    }
    const idempotencyKey = this.#requiredLabel(
      input.idempotencyKey,
      "idempotencyKey",
    );
    const previous = this.#findEvent(input.roomId, idempotencyKey);
    if (previous !== undefined) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== "membership.removed" ||
        event.actorId !== actor.principalId ||
        event.aggregateType !== "membership" ||
        event.aggregateId !== actor.principalId ||
        event.payload.participantId !== actor.principalId
      ) {
        throw this.#idempotencyConflict(idempotencyKey);
      }
      return {
        deduplicated: true,
        event,
        removedPrincipalId: actor.principalId,
      };
    }

    const membership = this.#membershipFromIds(input.roomId, actor.principalId);
    this.#assertFreshContext(input.roomId, actor, input.basedOnRoomSeq);
    if (membership.role === "owner") {
      const ownerCount = this.#database
        .prepare(
          "SELECT COUNT(*) AS count FROM memberships WHERE room_id = ? AND role = 'owner'",
        )
        .get(input.roomId);
      if (integer(ownerCount!, "count") <= 1) {
        throw new ConflictError("cannot leave as the last owner of a Room");
      }
    }
    this.#assertNoActiveMembershipWork(input.roomId, actor.principalId);
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: actor.principalId,
      aggregateType: "membership",
      idempotencyKey,
      payload: {
        basedOnRoomSeq: input.basedOnRoomSeq,
        participantId: actor.principalId,
        previousRole: membership.role,
      },
      roomId: input.roomId,
      type: "membership.removed",
    });
    this.#database
      .prepare("DELETE FROM memberships WHERE room_id = ? AND principal_id = ?")
      .run(input.roomId, actor.principalId);
    return {
      deduplicated: false,
      event,
      removedPrincipalId: actor.principalId,
    };
  }

  listThreads(actorId: string, roomId: string): Thread[] {
    requireRoomMember(this.#database, roomId, actorId);
    const summaries = threadViewerSummaries(this.#database, roomId, actorId);
    return this.#database
      .prepare(
        "SELECT * FROM threads WHERE room_id = ? ORDER BY created_at, thread_id",
      )
      .all(roomId)
      .map((row) => {
        const thread = threadProjectionFromRow(row);
        return {
          ...thread,
          viewerSummary: summaries.get(thread.threadId) ?? {
            participantIds: [],
            unreadCount: 0,
            firstUnreadMessageId: null,
          },
        };
      });
  }

  listMessages(
    actorId: string,
    input: {
      afterSeq?: number;
      beforeSeq?: number;
      limit?: number;
      roomId: string;
      threadId?: string;
    },
  ): MessagePage {
    requireRoomMember(this.#database, input.roomId, actorId);
    const limit = input.limit ?? 100;
    if (
      input.afterSeq !== undefined &&
      (!Number.isInteger(input.afterSeq) || input.afterSeq < 0)
    ) {
      throw new Error("afterSeq must be a non-negative integer");
    }
    if (
      input.beforeSeq !== undefined &&
      (!Number.isInteger(input.beforeSeq) || input.beforeSeq <= 0)
    ) {
      throw new Error("beforeSeq must be a positive integer");
    }
    if (input.afterSeq !== undefined && input.beforeSeq !== undefined) {
      throw new Error(
        "message pagination accepts either afterSeq or beforeSeq",
      );
    }
    if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
      throw new Error("limit must be between 1 and 500");
    }
    const projectionSql = `WITH projected_messages AS (
         SELECT messages.*, room_events.room_seq FROM messages
         JOIN room_events
           ON room_events.room_id = messages.room_id
          AND (
            room_events.aggregate_type = 'message'
            AND room_events.aggregate_id = messages.message_id
            AND room_events.type = 'message.posted'
            OR room_events.aggregate_type = 'task'
            AND room_events.type = 'task.created'
            AND NOT EXISTS (
              SELECT 1 FROM room_events AS source_message_events
              WHERE source_message_events.room_id = messages.room_id
                AND source_message_events.aggregate_type = 'message'
                AND source_message_events.aggregate_id = messages.message_id
                AND source_message_events.type = 'message.posted'
            )
            AND EXISTS (
              SELECT 1 FROM tasks
              WHERE tasks.task_id = room_events.aggregate_id
                AND tasks.source_message_id = messages.message_id
            )
            OR room_events.aggregate_type = 'task'
            AND room_events.type IN ('task.progressed', 'task.submitted')
            AND json_extract(room_events.payload_json, '$.messageId') =
              messages.message_id
            OR room_events.aggregate_type = 'review'
            AND room_events.type = 'review.submitted'
            AND json_extract(room_events.payload_json, '$.messageId') =
              messages.message_id
          )
         WHERE messages.room_id = ?
           AND (? IS NULL OR messages.thread_id = ?)
       )`;
    const parameters = [
      input.roomId,
      input.threadId ?? null,
      input.threadId ?? null,
    ];
    const direction =
      input.beforeSeq !== undefined
        ? "before"
        : input.afterSeq !== undefined
          ? "after"
          : "latest";
    const boundarySql =
      direction === "before"
        ? "WHERE room_seq < ?"
        : direction === "after"
          ? "WHERE room_seq > ?"
          : "";
    const boundaryParameters =
      direction === "before"
        ? [input.beforeSeq!]
        : direction === "after"
          ? [input.afterSeq!]
          : [];
    const descending = direction !== "after";
    const rows = this.#database
      .prepare(
        `${projectionSql}
         SELECT * FROM projected_messages
         ${boundarySql}
         ORDER BY room_seq ${descending ? "DESC" : "ASC"},
                  message_id ${descending ? "DESC" : "ASC"}
         LIMIT ?`,
      )
      .all(...parameters, ...boundaryParameters, limit + 1);
    const pageRows = rows.slice(0, limit);
    if (descending) pageRows.reverse();
    const messages = pageRows.map((row) => messageProjectionFromRow(row));
    const requestBoundary = input.beforeSeq ?? input.afterSeq ?? 0;
    const cursorBefore = messages.at(0)?.roomSeq ?? requestBoundary;
    const cursorAfter = messages.at(-1)?.roomSeq ?? requestBoundary;
    const hasMessageAcrossBoundary = (
      comparator: "<" | ">",
      boundary: number,
    ): boolean =>
      this.#database
        .prepare(
          `${projectionSql}
           SELECT 1 AS present FROM projected_messages
           WHERE room_seq ${comparator} ?
           LIMIT 1`,
        )
        .get(...parameters, boundary) !== undefined;
    return {
      cursorAfter,
      cursorBefore,
      hasMoreAfter: hasMessageAcrossBoundary(">", cursorAfter),
      hasMoreBefore: hasMessageAcrossBoundary("<", cursorBefore),
      messages,
    };
  }

  createThread(
    actor: Principal,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      recipientIds: string[];
      roomId: string;
      rootMessageId: string;
    },
  ): ThreadMutationResult {
    requireRoomMember(this.#database, input.roomId, actor.principalId);
    const recipientIds = this.#normalizeRecipientIds(
      input.roomId,
      actor.principalId,
      input.recipientIds,
    );
    const previous = this.#findEvent(input.roomId, input.idempotencyKey);
    if (previous !== undefined) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== "thread.created" ||
        event.actorId !== actor.principalId ||
        event.payload.rootMessageId !== input.rootMessageId ||
        JSON.stringify(event.payload.recipientIds) !==
          JSON.stringify(recipientIds)
      ) {
        throw this.#idempotencyConflict(input.idempotencyKey);
      }
      return {
        activationIds: [],
        deduplicated: true,
        event,
        thread: this.#threadFromId(event.aggregateId),
      };
    }
    requireActiveInstancePrivateBox(this.#database, input.roomId);
    this.#assertFreshContext(input.roomId, actor, input.basedOnRoomSeq);
    const root = this.#database
      .prepare("SELECT * FROM messages WHERE message_id = ? AND room_id = ?")
      .get(input.rootMessageId, input.roomId);
    if (root === undefined) {
      throw new NotFoundError(
        `root Message ${input.rootMessageId} was not found in Room ${input.roomId}`,
      );
    }
    if (
      this.#database
        .prepare("SELECT 1 FROM threads WHERE root_message_id = ?")
        .get(input.rootMessageId)
    ) {
      throw new ConflictError(
        `Message ${input.rootMessageId} already has a Thread`,
      );
    }
    const threadId = this.#createId("thread");
    const createdAt = this.#timestamp();
    this.#database
      .prepare(
        "INSERT INTO threads(thread_id, room_id, root_message_id, created_by, reply_count, created_at) VALUES(?, ?, ?, ?, 0, ?)",
      )
      .run(
        threadId,
        input.roomId,
        input.rootMessageId,
        actor.principalId,
        createdAt,
      );
    followAgentThreadParticipants(this.#database, {
      participantIds: recipientIds,
      source: "mention",
      threadId,
      updatedAt: createdAt,
    });
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: threadId,
      aggregateType: "thread",
      idempotencyKey: input.idempotencyKey,
      payload: {
        basedOnRoomSeq: input.basedOnRoomSeq,
        recipientIds,
        rootMessageId: input.rootMessageId,
        threadId,
      },
      roomId: input.roomId,
      type: "thread.created",
    });
    return {
      activationIds: this.#events.deriveAttention(
        event,
        recipientIds.map((participantId) => ({
          participantId,
          reason: "thread_subscription",
        })),
        createdAt,
      ),
      deduplicated: false,
      event,
      thread: this.#threadFromId(threadId),
    };
  }

  replyThread(
    actor: Principal,
    input: {
      attachmentComment?: { attachmentId: string; anchor: unknown };
      attachments?: Attachment[];
      basedOnRoomSeq: number;
      body: string;
      idempotencyKey: string;
      recipientIds: string[];
      roomId: string;
      threadId: string;
    },
  ): MessageMutationResult {
    requireRoomMember(this.#database, input.roomId, actor.principalId);
    const body = input.body.trim();
    const attachments = input.attachments ?? [];
    if (body.length === 0 && attachments.length === 0)
      throw new Error("message body or attachment is required");
    const requestedRecipientIds = this.#normalizeRecipientIds(
      input.roomId,
      actor.principalId,
      input.recipientIds,
    );
    const previous = this.#findEvent(input.roomId, input.idempotencyKey);
    if (previous !== undefined) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== "message.posted" ||
        event.actorId !== actor.principalId ||
        event.payload.body !== body ||
        JSON.stringify(event.payload.attachmentComment) !==
          JSON.stringify(input.attachmentComment) ||
        event.payload.threadId !== input.threadId ||
        JSON.stringify(event.payload.attachments ?? []) !==
          JSON.stringify(attachments) ||
        JSON.stringify(
          event.payload.requestedRecipientIds ?? event.payload.recipientIds,
        ) !== JSON.stringify(requestedRecipientIds)
      ) {
        throw this.#idempotencyConflict(input.idempotencyKey);
      }
      return { activationIds: [], deduplicated: true, event };
    }
    requireActiveInstancePrivateBox(this.#database, input.roomId);
    this.#assertFreshContext(input.roomId, actor, input.basedOnRoomSeq);
    this.#threadFromRoom(input.threadId, input.roomId);
    const messageId = this.#createId("message");
    const createdAt = this.#timestamp();
    followAgentThreadParticipants(this.#database, {
      participantIds: requestedRecipientIds,
      source: "mention",
      threadId: input.threadId,
      updatedAt: createdAt,
    });
    if (actor.kind === "agent") {
      followAgentThreadParticipants(this.#database, {
        participantIds: [actor.principalId],
        source: "participation",
        threadId: input.threadId,
        updatedAt: createdAt,
      });
    }
    const recipientsByParticipant = new Map<string, MessageRecipient>();
    for (const recipient of listFollowingAgentThreadRecipients(this.#database, {
      excludedParticipantId: actor.principalId,
      roomId: input.roomId,
      threadId: input.threadId,
    })) {
      recipientsByParticipant.set(recipient.participantId, recipient);
    }
    for (const participantId of requestedRecipientIds) {
      recipientsByParticipant.set(participantId, {
        participantId,
        reason: "thread_subscription",
      });
    }
    const recipients = [...recipientsByParticipant.values()].sort(
      (left, right) => left.participantId.localeCompare(right.participantId),
    );
    const recipientIds = recipients.map(({ participantId }) => participantId);
    this.#database
      .prepare(
        "INSERT INTO messages(message_id, room_id, actor_id, thread_id, body, created_at, attachments_json) VALUES(?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        messageId,
        input.roomId,
        actor.principalId,
        input.threadId,
        body,
        createdAt,
        JSON.stringify(attachments),
      );
    this.#database
      .prepare(
        "UPDATE threads SET reply_count = reply_count + 1, last_reply_at = ? WHERE thread_id = ?",
      )
      .run(createdAt, input.threadId);
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: messageId,
      aggregateType: "message",
      idempotencyKey: input.idempotencyKey,
      payload: {
        basedOnRoomSeq: input.basedOnRoomSeq,
        body,
        ...(attachments.length ? { attachments } : {}),
        messageId,
        ...(input.attachmentComment
          ? { attachmentComment: input.attachmentComment }
          : {}),
        requestedRecipientIds,
        recipientIds,
        recipients,
        threadId: input.threadId,
      },
      roomId: input.roomId,
      type: "message.posted",
    });
    return {
      activationIds: this.#events.deriveAttention(event, recipients, createdAt),
      deduplicated: false,
      event,
    };
  }

  postMessage(
    actor: Principal,
    input: {
      attachments?: Attachment[];
      basedOnRoomSeq?: number;
      body: string;
      idempotencyKey: string;
      recipients: MessageRecipient[];
      roomId: string;
    },
  ): MessageMutationResult {
    requireRoomMember(this.#database, input.roomId, actor.principalId);
    const body = input.body.trim();
    const attachments = input.attachments ?? [];
    if (body.length === 0 && attachments.length === 0)
      throw new Error("message body or attachment is required");
    if (input.idempotencyKey.trim().length === 0) {
      throw new Error("idempotencyKey is required");
    }
    // The replay decision compares only what the caller authored — body, target
    // and attachments. The recipient set is derived from Room membership at
    // append time, so a join or a leave between the original post and an
    // identical retry must replay the original event, not raise a conflict.
    const previous = this.#database
      .prepare(
        "SELECT * FROM room_events WHERE room_id = ? AND idempotency_key = ?",
      )
      .get(input.roomId, input.idempotencyKey);
    if (previous) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== "message.posted" ||
        event.actorId !== actor.principalId ||
        event.payload.threadId !== undefined ||
        event.payload.body !== body ||
        JSON.stringify(event.payload.attachments ?? []) !==
          JSON.stringify(attachments)
      ) {
        throw new IdempotencyConflictError(
          `idempotency key ${input.idempotencyKey} was already used for another mutation`,
        );
      }
      return { activationIds: [], deduplicated: true, event };
    }
    requireActiveInstancePrivateBox(this.#database, input.roomId);
    const recipients = this.#normalizeRecipients(
      input.roomId,
      actor.principalId,
      input.recipients,
    );
    const recipientPayload = recipients.map((recipient) => ({
      participantId: recipient.participantId,
      reason: recipient.reason,
    }));
    this.#assertFreshContext(input.roomId, actor, input.basedOnRoomSeq);
    const messageId = this.#createId("message");
    const createdAt = this.#timestamp();
    this.#database
      .prepare(
        "INSERT INTO messages(message_id, room_id, actor_id, body, created_at, attachments_json) VALUES(?, ?, ?, ?, ?, ?)",
      )
      .run(
        messageId,
        input.roomId,
        actor.principalId,
        body,
        createdAt,
        JSON.stringify(attachments),
      );
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: messageId,
      aggregateType: "message",
      idempotencyKey: input.idempotencyKey,
      payload: {
        body,
        messageId,
        ...(attachments.length ? { attachments } : {}),
        ...(input.basedOnRoomSeq === undefined
          ? {}
          : { basedOnRoomSeq: input.basedOnRoomSeq }),
        recipientIds: recipients.map((recipient) => recipient.participantId),
        recipients: recipientPayload,
      },
      roomId: input.roomId,
      type: "message.posted",
    });
    return {
      activationIds: this.#events.deriveAttention(event, recipients, createdAt),
      deduplicated: false,
      event,
    };
  }

  postActivationMessage(
    actor: Principal,
    input: {
      attachmentComment?: { attachmentId: string; anchor: null };
      attachments?: Attachment[];
      activationId: string;
      basedOnRoomSeq: number;
      body?: string;
      revisedBody?: string;
      continueAnyway?: boolean;
      freshnessFloorSeq?: number;
      finalOutputRunAttemptId?: string;
      replyReturnRunAttemptId?: string;
      heldDraftId?: string;
      idempotencyKey: string;
      recipients: MessageRecipient[];
      roomId: string;
      threadId?: string;
    },
  ): WorkerMessagePostResult {
    requireRoomMember(this.#database, input.roomId, actor.principalId);
    if (actor.kind !== "agent") {
      throw new ForbiddenError(
        "Activation-scoped Room replies require an Agent principal",
      );
    }
    if (input.idempotencyKey.trim().length === 0) {
      throw new Error("idempotencyKey is required");
    }
    if (input.activationId.trim().length === 0) {
      throw new Error("activationId is required");
    }
    if (!Number.isInteger(input.basedOnRoomSeq) || input.basedOnRoomSeq < 0) {
      throw new Error("basedOnRoomSeq must be a non-negative integer");
    }
    // The freshness floor is "what this participant had already seen in this
    // target". It equals basedOnRoomSeq for every client-presented context, and
    // differs only on the server-derived route, where basedOnRoomSeq must stay
    // stable across an identical retry while the floor may include the
    // participant's own already-published messages in the same target.
    const freshnessFloorSeq = input.freshnessFloorSeq ?? input.basedOnRoomSeq;
    if (!Number.isInteger(freshnessFloorSeq) || freshnessFloorSeq < 0) {
      throw new Error("freshnessFloorSeq must be a non-negative integer");
    }
    const greetingReplay = firstRunReplay(
      this.#database,
      {
        participantId: actor.principalId,
        roomId: input.roomId,
        activationId: input.activationId,
      },
      input.idempotencyKey,
      input.threadId,
      (row) => this.#events.eventFromRow(row),
    );
    if (greetingReplay)
      return { activationIds: [], deduplicated: true, event: greetingReplay };
    const attachments = input.attachments ?? [];
    const createdAt = this.#timestamp();
    if (input.threadId !== undefined) {
      this.#threadFromRoom(input.threadId, input.roomId);
    }
    const previous = this.#database
      .prepare(
        "SELECT * FROM room_events WHERE room_id = ? AND idempotency_key = ?",
      )
      .get(input.roomId, input.idempotencyKey);
    if (previous) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== "message.posted" ||
        event.actorId !== actor.principalId ||
        event.payload.threadId !== input.threadId ||
        JSON.stringify(event.payload.attachmentComment ?? null) !==
          JSON.stringify(input.attachmentComment ?? null) ||
        event.payload.activationId !== input.activationId ||
        event.payload.basedOnRoomSeq !== input.basedOnRoomSeq ||
        ((input.heldDraftId === undefined || input.revisedBody !== undefined) &&
          event.payload.body !== (input.revisedBody ?? input.body)?.trim()) ||
        JSON.stringify(event.payload.attachments ?? []) !==
          JSON.stringify(attachments) ||
        event.payload.revisedDraft !==
          (input.revisedBody === undefined ? undefined : true) ||
        event.payload.heldDraftId !== input.heldDraftId ||
        event.payload.continueAnyway !==
          (input.continueAnyway === true ? true : undefined)
      ) {
        throw new IdempotencyConflictError(
          `idempotency key ${input.idempotencyKey} was already used for another mutation`,
        );
      }
      return { activationIds: [], deduplicated: true, event };
    }
    const previousHeld = this.#database
      .prepare(
        "SELECT * FROM held_message_drafts WHERE room_id = ? AND idempotency_key = ?",
      )
      .get(input.roomId, input.idempotencyKey);
    if (previousHeld !== undefined) {
      if (
        text(previousHeld, "attachment_comment_json") !==
          JSON.stringify(input.attachmentComment ?? null) ||
        text(previousHeld, "attachments_json") !==
          JSON.stringify(attachments) ||
        input.continueAnyway === true ||
        text(previousHeld, "participant_id") !== actor.principalId ||
        text(previousHeld, "activation_id") !== input.activationId ||
        (nullableText(previousHeld, "thread_id") ?? undefined) !==
          input.threadId ||
        ((input.heldDraftId === undefined || input.revisedBody !== undefined) &&
          text(previousHeld, "body") !==
            (input.revisedBody ?? input.body)?.trim()) ||
        integer(previousHeld, "based_on_room_seq") !== freshnessFloorSeq ||
        (nullableText(previousHeld, "source_held_draft_id") ?? undefined) !==
          input.heldDraftId
      ) {
        throw new IdempotencyConflictError(
          `idempotency key ${input.idempotencyKey} was already used for another mutation`,
        );
      }
      return this.#heldMessageDraftResult(
        previousHeld,
        input.finalOutputRunAttemptId === undefined,
      );
    }

    const recipients = this.#normalizeRecipients(
      input.roomId,
      actor.principalId,
      input.recipients,
    );
    const recipientPayload = recipients.map((recipient) => ({
      participantId: recipient.participantId,
      reason: recipient.reason,
    }));
    const sourceHeldDraft =
      input.heldDraftId === undefined
        ? undefined
        : requireActiveHeldMessageDraft(this.#database, {
            heldDraftId: input.heldDraftId,
            nowMs: Date.parse(createdAt),
          });
    if (
      sourceHeldDraft !== undefined &&
      (text(sourceHeldDraft, "room_id") !== input.roomId ||
        text(sourceHeldDraft, "participant_id") !== actor.principalId ||
        (nullableText(sourceHeldDraft, "thread_id") ?? undefined) !==
          input.threadId)
    ) {
      throw new ForbiddenError(
        `Held draft ${input.heldDraftId} does not belong to this Agent reply target`,
      );
    }
    if (input.continueAnyway === true && sourceHeldDraft === undefined) {
      throw new ConflictError("continueAnyway requires an active held draft");
    }
    /**
     * Raft's `handleMessageSend` compose branch: before a normal send it reads
     * `getSavedDraft(agentId, target)` and, when that draft has content, warns
     * that the previous body is now discarded. One draft is kept per target, so
     * this composition replaces it. Only the server knows the previous body, so
     * it is reported here and rendered by the CLI. `--send-draft` resends the
     * saved draft rather than replacing it and never reports one.
     */
    const replacedDraftBody =
      input.heldDraftId === undefined
        ? (() => {
            const existing = findActiveHeldMessageDraftForTarget(
              this.#database,
              {
                participantId: actor.principalId,
                roomId: input.roomId,
                ...(input.threadId === undefined
                  ? {}
                  : { threadId: input.threadId }),
                nowMs: Date.parse(createdAt),
              },
            );
            const previous =
              existing === undefined ? "" : text(existing, "body");
            return previous.trim().length > 0 ? previous : undefined;
          })()
        : undefined;
    const replacedDraft =
      replacedDraftBody === undefined
        ? {}
        : { replacedDraft: { body: replacedDraftBody } };
    if (
      input.continueAnyway === true &&
      integer(sourceHeldDraft!, "rehold_count") <
        CONTINUE_ANYWAY_REHOLD_THRESHOLD
    ) {
      throw new ConflictError(
        "A held draft can be sent anyway only after it has been held repeatedly",
      );
    }
    const body =
      sourceHeldDraft === undefined
        ? input.body?.trim()
        : (input.revisedBody?.trim() ?? text(sourceHeldDraft, "body"));
    if (body === undefined || (body.length === 0 && attachments.length === 0)) {
      throw new Error("message body or attachment is required");
    }

    const latestTargetSeq = latestBlockingReplyMessageSeq(this.#database, {
      roomId: input.roomId,
      threadId: input.threadId,
      actorId: actor.principalId,
      afterSeq: freshnessFloorSeq,
      finalOutputRunAttemptId: input.finalOutputRunAttemptId,
      ordinaryReply: attachments.length === 0 && !input.attachmentComment,
    });
    if (latestTargetSeq > freshnessFloorSeq && input.continueAnyway !== true) {
      const heldDraftId = this.#createId("held_draft");
      const reholdCount =
        sourceHeldDraft === undefined
          ? 1
          : integer(sourceHeldDraft, "rehold_count") + 1;
      this.#database
        .prepare(
          `INSERT INTO held_message_drafts(
             held_draft_id, room_id, participant_id, activation_id, thread_id,
             body, attachments_json, based_on_room_seq, seen_up_to_seq, idempotency_key, state,
             source_held_draft_id, rehold_count, expires_at_ms,
             created_at, updated_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'held', ?, ?, ?, ?, ?)`,
        )
        .run(
          heldDraftId,
          input.roomId,
          actor.principalId,
          input.activationId,
          input.threadId ?? null,
          body,
          JSON.stringify(attachments),
          freshnessFloorSeq,
          latestTargetSeq,
          input.idempotencyKey,
          input.heldDraftId ?? null,
          reholdCount,
          Date.parse(createdAt) + HELD_MESSAGE_DRAFT_TTL_MS,
          createdAt,
          createdAt,
        );
      if (input.heldDraftId !== undefined) {
        resolveOneHeldMessageDraft(this.#database, {
          heldDraftId: input.heldDraftId,
          resolution: "reheld",
          timestamp: createdAt,
        });
      }
      return {
        ...this.#heldMessageDraftResult(
          this.#database
            .prepare(
              "SELECT * FROM held_message_drafts WHERE held_draft_id = ?",
            )
            .get(heldDraftId)!,
          input.finalOutputRunAttemptId === undefined,
        ),
        ...replacedDraft,
      };
    }

    if (input.threadId !== undefined) {
      followAgentThreadParticipants(this.#database, {
        participantIds: [actor.principalId],
        source: "participation",
        threadId: input.threadId,
        updatedAt: createdAt,
      });
      // A mention subscribes the mentioned Agent to the Thread, exactly as a
      // Human mention does when a Thread reply requests recipients.
      followAgentThreadParticipants(this.#database, {
        participantIds: recipients
          .filter((recipient) => recipient.reason === "mention")
          .map((recipient) => recipient.participantId),
        source: "mention",
        threadId: input.threadId,
        updatedAt: createdAt,
      });
    }

    const messageId = this.#createId("message");
    this.#database
      .prepare(
        "INSERT INTO messages(message_id, room_id, actor_id, thread_id, body, created_at, attachments_json) VALUES(?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        messageId,
        input.roomId,
        actor.principalId,
        input.threadId ?? null,
        body,
        createdAt,
        JSON.stringify(attachments),
      );
    if (input.threadId !== undefined) {
      this.#database
        .prepare(
          "UPDATE threads SET reply_count = reply_count + 1, last_reply_at = ? WHERE thread_id = ?",
        )
        .run(createdAt, input.threadId);
    }
    const replyReturn = peerReplyReturn(this.#database, {
      runAttemptId: input.replyReturnRunAttemptId,
      activationId: input.activationId,
      participantId: actor.principalId,
      roomId: input.roomId,
      messageId,
    });
    if (replyReturn) {
      recipients.push({
        participantId: replyReturn.participantId,
        reason: "reply",
      });
      recipientPayload.push({
        participantId: replyReturn.participantId,
        reason: "reply",
      });
    }
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: messageId,
      aggregateType: "message",
      idempotencyKey: input.idempotencyKey,
      payload: {
        activationId: input.activationId,
        ...(replyReturn ? { replyReturn } : {}),
        basedOnRoomSeq: input.basedOnRoomSeq,
        body,
        ...(attachments.length ? { attachments } : {}),
        ...(input.attachmentComment
          ? { attachmentComment: input.attachmentComment }
          : {}),
        ...(input.revisedBody === undefined ? {} : { revisedDraft: true }),
        ...(input.heldDraftId === undefined
          ? {}
          : {
              heldDraftId: input.heldDraftId,
              continueAnyway: input.continueAnyway === true ? true : undefined,
            }),
        messageId,
        recipientIds: recipients.map((recipient) => recipient.participantId),
        recipients: recipientPayload,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      },
      roomId: input.roomId,
      type: "message.posted",
    });
    resolveHeldMessageDrafts(this.#database, {
      participantId: actor.principalId,
      resolution:
        input.heldDraftId === undefined || input.revisedBody !== undefined
          ? "revised"
          : input.continueAnyway === true
            ? "sent_anyway"
            : "sent_unchanged",
      roomId: input.roomId,
      ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      timestamp: createdAt,
    });
    return {
      activationIds: this.#events.deriveAttention(event, recipients, createdAt),
      deduplicated: false,
      event,
      ...replacedDraft,
    };
  }

  #heldMessageDraftResult(
    row: Row,
    presentsContextToWorker: boolean,
  ): Extract<WorkerMessagePostResult, { state: "held" }> {
    const roomId = text(row, "room_id");
    const threadId = nullableText(row, "thread_id") ?? undefined;
    const basedOnRoomSeq = integer(row, "based_on_room_seq");
    const seenUpToSeq = integer(row, "seen_up_to_seq");
    const holdContext = freshnessHoldContext(this.#database, {
      basedOnRoomSeq,
      eventFromRow: (row) => this.#events.eventFromRow(row as Row),
      roomId,
      seenUpToSeq,
      ...(threadId === undefined ? {} : { threadId }),
    });
    // Raft records the consumed sequence on a hold as well as on a read
    // (`handleMessageSend`, held branch): the hold showed this participant the
    // messages it had not seen, so the target's read position advances here —
    // and only here — as part of sending.
    // A Host-settled final returns only a status to the Host: its newer
    // messages never reached the model. Do not suppress them on the next wake.
    if (presentsContextToWorker)
      recordWorkerTargetReadPosition(this.#database, {
        messageSeqs: holdContext.newerMessages.map((event) => event.roomSeq),
        participantId: text(row, "participant_id"),
        roomId,
        ...(threadId === undefined ? {} : { threadId }),
        throughRoomSeq: seenUpToSeq,
        updatedAt: this.#timestamp(),
      });
    const recoveryTarget = heldDraftRecoveryTarget(this.#database, row);
    return {
      activationIds: [],
      basedOnRoomSeq,
      heldDraftId: text(row, "held_draft_id"),
      ...(recoveryTarget === undefined ? {} : { recoveryTarget }),
      newMessageCount: holdContext.newMessageCount,
      newerMessages: holdContext.newerMessages,
      omittedMessageCount: holdContext.omittedMessageCount,
      reason: "newer_messages_available",
      reholdCount: integer(row, "rehold_count"),
      shownMessageCount: holdContext.shownMessageCount,
      continueAnywaySuggested:
        integer(row, "rehold_count") >= CONTINUE_ANYWAY_REHOLD_THRESHOLD,
      seenUpToSeq,
      state: "held",
    };
  }

  hasNewerTargetMessages(
    roomId: string,
    threadId: string | undefined,
    afterSeq: number,
  ): boolean {
    return this.#latestTargetMessageSeq(roomId, threadId) > afterSeq;
  }

  #latestTargetMessageSeq(roomId: string, threadId?: string): number {
    const row = this.#database
      .prepare(
        `SELECT room_events.room_seq
         FROM messages
         JOIN room_events
           ON room_events.room_id = messages.room_id
          AND room_events.aggregate_id = messages.message_id
          AND room_events.type = 'message.posted'
         WHERE messages.room_id = ? AND messages.thread_id IS ?
           AND ${NOT_SYSTEM_NOTICE_SQL}
         ORDER BY room_events.room_seq DESC
         LIMIT 1`,
      )
      .get(roomId, threadId ?? null);
    return row === undefined ? 0 : integer(row, "room_seq");
  }

  #findEvent(roomId: string, idempotencyKey: string): Row | undefined {
    return this.#database
      .prepare(
        "SELECT * FROM room_events WHERE room_id = ? AND idempotency_key = ?",
      )
      .get(roomId, idempotencyKey);
  }

  #roomFromId(roomId: string): Room {
    const room = this.#database
      .prepare(
        `SELECT rooms.*, direct_room_pairs.left_principal_id, direct_room_pairs.right_principal_id
        FROM rooms LEFT JOIN direct_room_pairs ON direct_room_pairs.room_id = rooms.room_id
        WHERE rooms.room_id = ?`,
      )
      .get(roomId);
    if (room === undefined) {
      throw new NotFoundError(`Room ${roomId} was not found`);
    }
    return RoomSchema.parse(roomProjectionFromRow(room));
  }

  #workspaceFromId(workspaceId: string): Workspace {
    const row = this.#database
      .prepare(
        `SELECT
           workspaces.workspace_id,
           workspaces.slug AS workspace_slug,
           workspaces.name AS workspace_name,
           workspaces.avatar_key AS workspace_avatar_key,
           workspaces.state AS workspace_state,
           workspaces.created_at AS workspace_created_at,
           workspaces.archived_at AS workspace_archived_at,
           control_room.room_id AS workspace_control_room_id
         FROM workspaces
         LEFT JOIN rooms AS control_room
           ON control_room.workspace_id = workspaces.workspace_id
          AND control_room.kind = 'control'
         WHERE workspaces.workspace_id = ?`,
      )
      .get(workspaceId);
    if (row === undefined) {
      throw new NotFoundError(`Workspace ${workspaceId} was not found`);
    }
    return WorkspaceSchema.parse({
      ...workspaceProjectionFromRow(row),
      agentAllChannelGreetingEnabled: agentGreetingEnabled(
        this.#database,
        typeof row.workspace_control_room_id === "string"
          ? row.workspace_control_room_id
          : undefined,
      ),
    });
  }

  #requiredLabel(value: string, field: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new Error(`${field} is required`);
    return normalized;
  }

  #idempotencyConflict(idempotencyKey: string): IdempotencyConflictError {
    return new IdempotencyConflictError(
      `idempotency key ${idempotencyKey} was already used for another mutation`,
    );
  }

  #membershipFromIds(roomId: string, principalId: string): RoomMembership {
    const membership = this.#membershipRow(roomId, principalId);
    if (membership === undefined) {
      throw new NotFoundError(
        `principal ${principalId} is not a member of Room ${roomId}`,
      );
    }
    return roomMembershipProjectionFromRow(membership);
  }

  #membershipReplay(
    actorId: string,
    input: {
      idempotencyKey: string;
      principalId: string;
      roomId: string;
    },
    expected: {
      eventType: "membership.added" | "membership.role_changed";
      payload: { participantId: string; role: MembershipRole };
    },
  ): RoomMembershipMutationResult | null {
    const previous = this.#findEvent(input.roomId, input.idempotencyKey);
    if (previous === undefined) return null;
    const event = this.#events.eventFromRow(previous);
    if (
      event.type !== expected.eventType ||
      event.actorId !== actorId ||
      event.aggregateType !== "membership" ||
      event.aggregateId !== input.principalId ||
      event.payload.participantId !== expected.payload.participantId ||
      event.payload.role !== expected.payload.role
    ) {
      throw this.#idempotencyConflict(input.idempotencyKey);
    }
    return {
      deduplicated: true,
      event,
      membership: this.#membershipFromIds(input.roomId, input.principalId),
    };
  }

  #membershipRow(roomId: string, principalId: string): Row | undefined {
    return this.#database
      .prepare(
        "SELECT * FROM memberships WHERE room_id = ? AND principal_id = ?",
      )
      .get(roomId, principalId);
  }

  #normalizeRecipientIds(
    roomId: string,
    actorId: string,
    recipientIds: string[],
  ): string[] {
    const normalized = [...new Set(recipientIds)]
      .filter((participantId) => participantId !== actorId)
      .sort();
    for (const participantId of normalized) {
      requireRoomMember(this.#database, roomId, participantId);
    }
    return normalized;
  }

  #requireRolePrincipal(principalId: string, role: MembershipRole): void {
    const principal = this.#requirePrincipalRow(principalId);
    const kind = ParticipantKindSchema.parse(principal.kind);
    if (role !== "member" && kind !== "human") {
      throw new ForbiddenError("elevated Room roles require a Human principal");
    }
  }

  #threadFromId(threadId: string): Thread {
    const thread = this.#database
      .prepare("SELECT * FROM threads WHERE thread_id = ?")
      .get(threadId);
    if (thread === undefined) {
      throw new NotFoundError(`Thread ${threadId} was not found`);
    }
    return threadProjectionFromRow(thread);
  }

  #threadFromRoom(threadId: string, roomId: string): Thread {
    const thread = this.#database
      .prepare("SELECT * FROM threads WHERE thread_id = ? AND room_id = ?")
      .get(threadId, roomId);
    if (thread === undefined) {
      throw new NotFoundError(
        `Thread ${threadId} was not found in Room ${roomId}`,
      );
    }
    return threadProjectionFromRow(thread);
  }

  #assertFreshContext(
    roomId: string,
    actor: Principal,
    basedOnRoomSeq: number | undefined,
  ): void {
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

  #assertMutableMembershipRoom(roomId: string): void {
    if (text(this.#requireRoom(roomId), "kind") === "direct") {
      throw new ConflictError("Direct Room membership is immutable");
    }
  }

  #assertNoActiveMembershipWork(roomId: string, principalId: string): void {
    // A Role instance's scheduled reminder is future private work: it would
    // fire into a box the removal is about to deactivate.
    const activeReminder = this.#database
      .prepare(
        `SELECT 1 FROM reminders rm
         JOIN role_instances ri ON ri.instance_id = rm.owner_participant_id
         WHERE rm.owner_participant_id = ? AND rm.status = 'scheduled'
           AND (rm.target_room_id = ? OR rm.room_id = ?)
         LIMIT 1`,
      )
      .get(principalId, roomId, roomId);
    if (activeReminder !== undefined)
      throw new ConflictError(
        `principal ${principalId} has active collaboration work in Room ${roomId}: scheduled reminder`,
      );
    const privateBoxes = this.#database
      .prepare(
        `
      SELECT DISTINCT peer.room_id, i.instance_id FROM role_instances i
      JOIN memberships peer ON peer.principal_id=i.instance_id
      JOIN rooms r ON r.room_id=peer.room_id AND r.kind='direct'
      JOIN memberships actor ON actor.room_id=r.room_id AND actor.principal_id=?
      WHERE i.channel_id=?
    `,
      )
      .all(principalId, roomId);
    for (const box of privateBoxes)
      this.#assertNoActiveMembershipWork(
        text(box, "room_id"),
        text(box, "instance_id"),
      );
    const activeTask = this.#database
      .prepare(
        `SELECT 1 AS present FROM tasks
         WHERE room_id = ?
           AND workflow_status NOT IN ('done', 'closed')
           AND (assignee_id = ? OR claimed_by = ?)
         LIMIT 1`,
      )
      .get(roomId, principalId, principalId);
    const activeInput = this.#database
      .prepare(
        `SELECT 1 AS present FROM input_requests
         WHERE room_id = ? AND state = 'pending'
           AND (requester_id = ? OR responder_id = ?)
         LIMIT 1`,
      )
      .get(roomId, principalId, principalId);
    const activeActivation = this.#database
      .prepare(
        `SELECT 1 AS present FROM activations
         WHERE room_id = ? AND participant_id = ?
           AND state IN ('queued', 'leased', 'quarantined')
         LIMIT 1`,
      )
      .get(roomId, principalId);
    const activeProcess = this.#database
      .prepare(
        `SELECT 1 AS present FROM runtime_processes
         WHERE room_id = ? AND participant_id = ?
           AND state IN ('prepared', 'active', 'orphaned')
         LIMIT 1`,
      )
      .get(roomId, principalId);
    if (
      activeTask !== undefined ||
      activeInput !== undefined ||
      activeActivation !== undefined ||
      activeProcess !== undefined
    ) {
      throw new ConflictError(
        `principal ${principalId} has active collaboration work in Room ${roomId}`,
      );
    }
    assertNoUnresolvedRuntimeCleanup(this.#database, principalId);
  }

  #normalizeRecipients(
    roomId: string,
    actorId: string,
    recipients: MessageRecipient[],
  ): MessageRecipient[] {
    const normalized = new Map<string, MessageRecipient>();
    for (const recipient of recipients) {
      if (recipient.participantId === actorId) continue;
      requireRoomMember(this.#database, roomId, recipient.participantId);
      normalized.set(recipient.participantId, {
        participantId: recipient.participantId,
        reason: ActivationReasonSchema.parse(recipient.reason),
      });
    }
    return [...normalized.values()].sort((left, right) =>
      left.participantId.localeCompare(right.participantId),
    );
  }

  #requirePrincipal(principalId: string): void {
    this.#requirePrincipalRow(principalId);
  }

  #requirePrincipalRow(principalId: string): Row {
    const principal = this.#database
      .prepare("SELECT * FROM principals WHERE principal_id = ?")
      .get(principalId);
    if (principal === undefined) {
      throw new NotFoundError(`principal ${principalId} was not found`);
    }
    return principal;
  }

  #requireRoom(roomId: string): Row {
    const room = this.#database
      .prepare("SELECT * FROM rooms WHERE room_id = ?")
      .get(roomId);
    if (room === undefined) {
      throw new NotFoundError(`room ${roomId} was not found`);
    }
    return room;
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }
}
