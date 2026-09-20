import type { DatabaseSync } from "node:sqlite";
import {
  AgentDefinitionRevisionSchema,
  type ActivationCredentialScope,
  type AgentDefinitionRevision,
  type RoomEvent,
  isUploadedProfileImageKey,
} from "@rah-os/protocol";
import * as P from "@rah-os/protocol";
import type { AuthenticatedWorkerExecutionContext } from "./auth.ts";
import { canonicalDigest } from "./canonical-digest.ts";
import {
  ForbiddenError,
  IdempotencyConflictError,
  StaleContextError,
} from "./errors.ts";
import type { ProfileImageLifecycleService } from "./profile-image-lifecycle.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { integer, jsonObject, text } from "./sqlite-row.ts";
import { deriveWorkerCommandIdempotencyKey } from "./worker-message-identity.ts";
import { requireWorkerRoomVisibility } from "./worker-task-scope.ts";
import { readAgentDefinition } from "./workspace-agent-management.ts";
import { updateAgentProfilePatch } from "./workspace-agent-profile.ts";

type Context = {
  database: DatabaseSync;
  createId: (prefix: string) => string;
  now: () => Date;
  events: RoomEventWriter;
  profileImages: ProfileImageLifecycleService;
  requireWorker: (
    execution: AuthenticatedWorkerExecutionContext,
  ) => ActivationCredentialScope;
  transaction: <T>(operation: () => T) => T;
};
/**
 * The revision of its own profile a Run has actually been shown. Raft's client
 * holds this in the tool; RAH keeps it on the Kernel side so `profile-update`
 * needs no Agent-carried expected revision and still fails when somebody else
 * committed a profile change after this Run observed one.
 */
export function migrateWorkerSelfProfileObservations(
  database: DatabaseSync,
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS worker_self_profile_observations (
      participant_id TEXT NOT NULL REFERENCES principals(principal_id),
      run_attempt_id TEXT NOT NULL,
      agent_definition_id TEXT NOT NULL,
      observed_revision_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (participant_id, run_attempt_id, agent_definition_id)
    ) STRICT;
  `);
}

/** Bound Agent metadata only. Profile control-Room causality never enters the
 * execution's work-Room read/ACK frontier or its frozen runtime manifest. */
export class WorkerSelfProfileService {
  readonly #context: Context;
  constructor(context: Context) {
    this.#context = context;
  }
  get(
    execution: AuthenticatedWorkerExecutionContext,
    raw: Record<string, unknown>,
  ): P.WorkerSelfProfileResponse {
    P.WorkerSelfProfileGetRequestSchema.parse(raw);
    return this.#context.transaction(() => {
      const scope = this.#authorize(execution),
        record = this.#self(scope);
      this.#observe(scope, record);
      return this.#response(
        record.currentRevision,
        scope.participantId,
        record.definition.controlRoomId,
        this.#head(record.definition.controlRoomId),
      );
    });
  }
  update(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerSelfProfileUpdateRequest,
  ): P.WorkerSelfProfileUpdateResponse {
    const presented = P.WorkerSelfProfileUpdateRequestSchema.parse(raw);
    return this.#context.transaction(() => {
      const scope = this.#authorize(execution),
        record = this.#self(scope),
        controlRoomId = record.definition.controlRoomId;
      if (
        presented.writeContext?.controlRoomId !== undefined &&
        presented.writeContext.controlRoomId !== controlRoomId
      )
        throw new ForbiddenError(
          "profile control Room is outside this bound Agent scope",
        );
      // Raft's `profile update` carries no write context: the daemon granted
      // this Activation and already knows the control Room, its sequence, and
      // the revision this Run was shown. Optimistic concurrency is unchanged —
      // the expected revision is the observed one, so a profile committed by
      // anyone else since this Run read it still conflicts.
      const input = {
        ...presented,
        writeContext: {
          controlRoomId,
          controlRoomSeq:
            presented.writeContext?.controlRoomSeq ?? this.#head(controlRoomId),
          expectedRevisionId:
            presented.writeContext?.expectedRevisionId ??
            this.#observedRevisionId(scope, record) ??
            record.currentRevision.agentDefinitionRevisionId,
        },
        idempotencyKey:
          presented.idempotencyKey ??
          deriveWorkerCommandIdempotencyKey({
            participantId: scope.participantId,
            activationId: scope.activationId,
            roomId: controlRoomId,
            operation: "profile-update",
            subjectId: record.definition.agentId,
            content: [
              presented.patch.displayName ?? null,
              presented.patch.description ?? null,
              presented.patch.avatarKey ?? null,
              presented.patch.avatarUploadIntentId ?? null,
            ],
          }),
      };
      // The digest identifies the REQUEST, so only what the caller actually
      // presented enters it. A server-derived write context moves as soon as
      // this very update commits — a new control-Room event, a new revision —
      // so folding it in would make an honest retry look like a different
      // mutation under the same key.
      const digest = canonicalDigest({
        domain: "rah/worker-self-profile/v1",
        participantId: scope.participantId,
        sourceRoomId: scope.roomId,
        idempotencyKey: input.idempotencyKey,
        patch: input.patch,
        writeContext: presented.writeContext ?? null,
      });
      const previous = this.#context.database
        .prepare(
          "SELECT * FROM room_events WHERE room_id=? AND idempotency_key=?",
        )
        .get(controlRoomId, input.idempotencyKey);
      if (previous) {
        const event = this.#context.events.eventFromRow(previous);
        if (
          event.type !== "agent.profile_updated" ||
          event.actorId !== scope.participantId ||
          event.aggregateId !== record.definition.agentId ||
          event.payload.requestDigest !== digest
        )
          throw new IdempotencyConflictError(
            "idempotency key was already used for another profile mutation",
          );
        return this.#result(event, scope.participantId, true);
      }
      const head = this.#head(controlRoomId);
      if (input.writeContext.controlRoomSeq !== head)
        throw new StaleContextError(input.writeContext.controlRoomSeq, head);
      const { avatarUploadIntentId } = input.patch;
      const patch = {
        ...(input.patch.displayName === undefined
          ? {}
          : { displayName: input.patch.displayName }),
        ...(input.patch.description === undefined
          ? {}
          : { description: input.patch.description }),
        ...(input.patch.avatarKey === undefined
          ? {}
          : { avatarKey: input.patch.avatarKey }),
      };
      if (
        patch.avatarKey !== undefined &&
        isUploadedProfileImageKey(patch.avatarKey) &&
        patch.avatarKey !== record.currentRevision.avatarKey
      )
        this.#context.profileImages.bindOwnedReference(
          scope.participantId,
          patch.avatarKey,
          avatarUploadIntentId,
        );
      const event = updateAgentProfilePatch(
        { ...this.#context, actorId: scope.participantId },
        {
          agentId: record.definition.agentId,
          expectedRevisionId: input.writeContext.expectedRevisionId,
          basedOnRoomSeq: input.writeContext.controlRoomSeq,
          idempotencyKey: input.idempotencyKey,
          patch,
          eventMetadata: {
            sourceRoomId: scope.roomId,
            runAttemptId: scope.runAttemptId,
            metadataOnly: true,
            changedFields: Object.keys(patch),
          },
        },
        digest,
      );
      if (patch.avatarKey !== undefined)
        this.#context.profileImages.releaseReference(
          record.currentRevision.avatarKey,
          patch.avatarKey,
        );
      // What this Run has now been shown: a second update in the same Run
      // builds on its own result rather than conflicting with it.
      this.#recordObservation(
        scope,
        record.definition.agentId,
        String(event.payload.agentDefinitionRevisionId),
      );
      return this.#result(event, scope.participantId, false);
    });
  }
  recordAvatarUpload(
    execution: AuthenticatedWorkerExecutionContext,
    input: { avatarKey: string },
  ): { uploadIntentId: string } {
    const scope = this.#authorize(execution);
    this.#self(scope);
    return this.#context.profileImages.recordAuthorizedUpload(
      scope.participantId,
      input,
    );
  }
  assertAvatarUploadAllowed(
    execution: AuthenticatedWorkerExecutionContext,
  ): void {
    this.#self(this.#authorize(execution));
  }
  #observe(
    scope: ActivationCredentialScope,
    record: ReturnType<typeof readAgentDefinition>,
  ): void {
    this.#recordObservation(
      scope,
      record.definition.agentId,
      record.currentRevision.agentDefinitionRevisionId,
    );
  }
  #recordObservation(
    scope: ActivationCredentialScope,
    agentId: string,
    revisionId: string,
  ): void {
    this.#context.database
      .prepare(
        `INSERT INTO worker_self_profile_observations(
           participant_id, run_attempt_id, agent_definition_id,
           observed_revision_id, updated_at
         ) VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(participant_id, run_attempt_id, agent_definition_id)
         DO UPDATE SET observed_revision_id = excluded.observed_revision_id,
                       updated_at = excluded.updated_at`,
      )
      .run(
        scope.participantId,
        scope.runAttemptId,
        agentId,
        revisionId,
        this.#context.now().toISOString(),
      );
  }
  #observedRevisionId(
    scope: ActivationCredentialScope,
    record: ReturnType<typeof readAgentDefinition>,
  ): string | undefined {
    const row = this.#context.database
      .prepare(
        `SELECT observed_revision_id FROM worker_self_profile_observations
         WHERE participant_id=? AND run_attempt_id=? AND agent_definition_id=?`,
      )
      .get(scope.participantId, scope.runAttemptId, record.definition.agentId);
    return row === undefined ? undefined : text(row, "observed_revision_id");
  }
  #authorize(execution: AuthenticatedWorkerExecutionContext) {
    const scope = this.#context.requireWorker(execution);
    requireWorkerRoomVisibility(this.#context.database, scope);
    return scope;
  }
  #self(scope: ActivationCredentialScope) {
    const row = this.#context.database
      .prepare(
        "SELECT agent_definition_id FROM agent_definitions WHERE participant_id=? AND state='enabled'",
      )
      .get(scope.participantId);
    if (!row)
      throw new ForbiddenError(
        "self profile requires a current enabled Agent definition",
      );
    return readAgentDefinition(
      this.#context.database,
      text(row, "agent_definition_id"),
    );
  }
  #head(roomId: string) {
    return integer(
      this.#context.database
        .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
        .get(roomId)!,
      "n",
    );
  }
  #result(
    event: RoomEvent,
    participantId: string,
    deduplicated: boolean,
  ): P.WorkerSelfProfileUpdateResponse {
    const row = this.#context.database
      .prepare(
        "SELECT definition_json FROM agent_definition_revisions WHERE agent_definition_revision_id=?",
      )
      .get(String(event.payload.agentDefinitionRevisionId))!;
    const revision = AgentDefinitionRevisionSchema.parse(
      jsonObject(row, "definition_json"),
    );
    return {
      ...this.#response(revision, participantId, event.roomId, event.roomSeq),
      deduplicated,
    };
  }
  #response(
    revision: AgentDefinitionRevision,
    participantId: string,
    controlRoomId: string,
    controlRoomSeq: number,
  ): P.WorkerSelfProfileResponse {
    return P.WorkerSelfProfileResponseSchema.parse({
      profile: {
        participantId,
        agentId: revision.agentId,
        displayName:
          revision.displayName ??
          text(
            this.#context.database
              .prepare("SELECT handle FROM principals WHERE principal_id=?")
              .get(participantId)!,
            "handle",
          ),
        ...(revision.description === undefined
          ? {}
          : { description: revision.description }),
        ...(revision.avatarKey === undefined
          ? {}
          : { avatarKey: revision.avatarKey }),
      },
      writeContext: {
        controlRoomId,
        controlRoomSeq,
        expectedRevisionId: revision.agentDefinitionRevisionId,
      },
    });
  }
}
