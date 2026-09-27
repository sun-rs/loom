import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import * as P from "@rah-os/protocol";

import type {
  AuthenticatedActorContext,
  AuthenticatedWorkerExecutionContext,
} from "./auth.ts";
import { canonicalDigest } from "./canonical-digest.ts";
import {
  memoryOverride,
  memoryPolicyState,
  effectiveMemorySwitches,
  hasMemoryAccess,
  requireMemoryAccess,
} from "./channel-memory-access.ts";
import { clearPresentedMemoryDescription } from "./channel-memory-index.ts";
import { requireRoomManager } from "./collaboration-policy.ts";
import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
} from "./errors.ts";
import { instanceSessionState } from "./instance-session.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import {
  integer,
  nullableInteger,
  nullableText,
  text,
  type Row,
} from "./sqlite-row.ts";

type Context = {
  createId(prefix: string): string;
  database: DatabaseSync;
  events: RoomEventWriter;
  now(): Date;
  requireActor(actor: AuthenticatedActorContext): string;
  requireWorker(
    worker: AuthenticatedWorkerExecutionContext,
  ): P.ActivationCredentialScope;
  transaction<T>(operation: () => T): T;
};

type Snapshot = {
  body: string | null;
  description: string;
  name: string;
  pinned: boolean;
  state: P.MemoryEntryState;
  type: P.MemoryEntryType;
};

const ENTRY_EVENT = "memory.entry_changed";
const POLICY_EVENT = "memory.policy_changed";
const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 20;

/**
 * evo S6 batch A: channel memory owned by the Kernel. Every accepted change
 * updates the projection, writes one immutable revision and appends one
 * metadata-only Room event to the channel in a single transaction, and is
 * deduplicated by its idempotency key. Access is decided before any list or
 * retrieval: a Worker reaches only its own instance's channel, filtered by
 * the channel switches; a Human must manage the channel. Provenance comes
 * from the authenticated context, never from a request field.
 */
export class ChannelMemoryService {
  readonly #c: Context;

  constructor(context: Context) {
    this.#c = context;
  }

  // Worker facade (the scope is derived from the credential).

  write(
    worker: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerMemoryWriteRequest,
  ): P.WorkerMemoryMutationReceipt {
    const input = P.WorkerMemoryWriteRequestSchema.parse(raw);
    return this.#c.transaction(() => {
      const scope = this.#c.requireWorker(worker);
      const channelId = requireMemoryAccess(this.#c.database, scope, "write");
      const digest = canonicalDigest({
        op: "create",
        ...input,
        idempotencyKey: null,
      });
      const prior = this.#replay(
        channelId,
        scope.participantId,
        input.idempotencyKey,
        ENTRY_EVENT,
        digest,
      );
      if (prior) return workerReceipt(prior);
      const existing = this.#entryByName(channelId, input.name);
      if (existing)
        throw new ConflictError(
          `memory '${input.name}' already exists (revision ${integer(existing, "revision")}, ${text(existing, "state")}); read it, then update or restore it with --expected-revision ${integer(existing, "revision")}`,
        );
      return workerReceipt(
        this.#commit({
          actorId: scope.participantId,
          channelId,
          digest,
          key: input.idempotencyKey,
          next: {
            body: input.body,
            description: input.description,
            name: input.name,
            pinned: false,
            state: "active",
            type: input.type,
          },
          op: "create",
          provenance: this.#workerProvenance(scope),
          reason: null,
        }),
      );
    });
  }

  update(
    worker: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerMemoryUpdateRequest,
  ): P.WorkerMemoryMutationReceipt {
    const input = P.WorkerMemoryUpdateRequestSchema.parse(raw);
    return this.#workerChange(worker, input, "update", (current, readable) => {
      if (current.state !== "active")
        throw new ConflictError(
          `memory '${current.name}' is ${current.state}; restore it before updating`,
        );
      const next = {
        ...current,
        ...(input.type === undefined ? {} : { type: input.type }),
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(input.body === undefined ? {} : { body: input.body }),
      };
      // Refusing an unchanged update would tell a write-only instance that
      // its guess equals the stored content, so only a reader is refused.
      if (
        readable &&
        next.type === current.type &&
        next.description === current.description &&
        next.body === current.body
      )
        throw new ConflictError(
          `memory update changes nothing in '${current.name}'`,
        );
      return { next, reason: null };
    });
  }

  invalidate(
    worker: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerMemoryInvalidateRequest,
  ): P.WorkerMemoryMutationReceipt {
    const input = P.WorkerMemoryInvalidateRequestSchema.parse(raw);
    return this.#workerChange(worker, input, "invalidate", (current) =>
      invalidation(current, input.reason),
    );
  }

  restore(
    worker: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerMemoryRestoreRequest,
  ): P.WorkerMemoryMutationReceipt {
    const input = P.WorkerMemoryRestoreRequestSchema.parse(raw);
    return this.#workerChange(worker, input, "restore", restoration);
  }

  list(
    worker: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerMemoryListRequest,
  ): P.MemoryListResponse {
    const input = P.WorkerMemoryListRequestSchema.parse(raw);
    const channelId = this.#workerRead(worker);
    return this.#list(
      channelId,
      input.includeInvalidated === true
        ? ["active", "invalidated"]
        : ["active"],
      input.limit ?? DEFAULT_LIST_LIMIT,
    );
  }

  read(
    worker: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerMemoryReadRequest,
  ): P.MemoryReadResponse {
    const input = P.WorkerMemoryReadRequestSchema.parse(raw);
    const channelId = this.#workerRead(worker);
    return { entry: this.#detail(this.#requireByName(channelId, input.name)) };
  }

  search(
    worker: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerMemorySearchRequest,
  ): P.MemorySearchResponse {
    const input = P.WorkerMemorySearchRequestSchema.parse(raw);
    const channelId = this.#workerRead(worker);
    return this.#search(
      channelId,
      input.query,
      input.limit ?? DEFAULT_SEARCH_LIMIT,
    );
  }

  history(
    worker: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerMemoryHistoryRequest,
  ): P.MemoryHistoryResponse {
    const input = P.WorkerMemoryHistoryRequestSchema.parse(raw);
    const channelId = this.#workerRead(worker);
    return this.#history(this.#requireByName(channelId, input.name));
  }

  // Human facade (a Human who manages the channel).

  humanList(
    actor: AuthenticatedActorContext,
    raw: P.ClientMemoryListRequest,
  ): P.MemoryListResponse {
    const input = P.ClientMemoryListRequestSchema.parse(raw);
    this.#requireHumanManager(actor, input.channelId);
    const states: P.MemoryEntryState[] = ["active"];
    if (input.includeInvalidated === true) states.push("invalidated");
    if (input.includeDeleted === true) states.push("deleted");
    return this.#list(
      input.channelId,
      states,
      input.limit ?? DEFAULT_LIST_LIMIT,
    );
  }

  humanRead(
    actor: AuthenticatedActorContext,
    raw: P.ClientMemoryEntryRequest,
  ): P.MemoryReadResponse {
    const input = P.ClientMemoryEntryRequestSchema.parse(raw);
    return { entry: this.#detail(this.#humanEntry(actor, input.entryId).row) };
  }

  humanSearch(
    actor: AuthenticatedActorContext,
    raw: P.ClientMemorySearchRequest,
  ): P.MemorySearchResponse {
    const input = P.ClientMemorySearchRequestSchema.parse(raw);
    this.#requireHumanManager(actor, input.channelId);
    return this.#search(
      input.channelId,
      input.query,
      input.limit ?? DEFAULT_SEARCH_LIMIT,
    );
  }

  humanHistory(
    actor: AuthenticatedActorContext,
    raw: P.ClientMemoryEntryRequest,
  ): P.MemoryHistoryResponse {
    const input = P.ClientMemoryEntryRequestSchema.parse(raw);
    return this.#history(this.#humanEntry(actor, input.entryId).row);
  }

  humanInvalidate(
    actor: AuthenticatedActorContext,
    raw: P.ClientMemoryInvalidateRequest,
  ): P.MemoryMutationResponse {
    const input = P.ClientMemoryInvalidateRequestSchema.parse(raw);
    return this.#humanChange(actor, input, "invalidate", (current) =>
      invalidation(current, input.reason),
    );
  }

  humanRestore(
    actor: AuthenticatedActorContext,
    raw: P.ClientMemoryRestoreRequest,
  ): P.MemoryMutationResponse {
    const input = P.ClientMemoryRestoreRequestSchema.parse(raw);
    return this.#humanChange(actor, input, "restore", restoration);
  }

  /**
   * Human-only privacy delete: every revision body and description is
   * cleared (owner ruling 2026-09-27); the tombstone keeps name, time,
   * reason and metadata.
   */
  humanDelete(
    actor: AuthenticatedActorContext,
    raw: P.ClientMemoryDeleteRequest,
  ): P.MemoryMutationResponse {
    const input = P.ClientMemoryDeleteRequestSchema.parse(raw);
    return this.#humanChange(actor, input, "delete", (current) => ({
      next: { ...current, body: null, description: "", state: "deleted" },
      reason: input.reason,
    }));
  }

  humanPin(
    actor: AuthenticatedActorContext,
    raw: P.ClientMemoryPinRequest,
  ): P.MemoryMutationResponse {
    const input = P.ClientMemoryPinRequestSchema.parse(raw);
    return this.#humanChange(
      actor,
      input,
      input.pinned ? "pin" : "unpin",
      (current) => {
        if (current.pinned === input.pinned)
          throw new ConflictError(
            `memory '${current.name}' is already ${input.pinned ? "pinned" : "unpinned"}`,
          );
        return { next: { ...current, pinned: input.pinned }, reason: null };
      },
    );
  }

  /**
   * S6 batch B: a Human imports an instance's legacy per-instance memory
   * (the server read `files` from the Host; the legacy directory is left
   * untouched). One entry per file, or one `whole` entry. Idempotent by the
   * import source: a file already imported from that instance is reported as
   * existing, whatever idempotency key the request carries.
   */
  humanImportLegacy(
    actor: AuthenticatedActorContext,
    raw: P.ClientMemoryImportLegacyRequest,
    files: readonly P.LegacyMemoryFile[],
  ): P.MemoryImportLegacyResponse {
    const input = P.ClientMemoryImportLegacyRequestSchema.parse(raw);
    return this.#c.transaction(() => {
      const { actorId, handle } = this.#importTarget(actor, input);
      const owner = slugPart(handle) || "instance";
      const selected =
        input.relativePaths === undefined
          ? files
          : files.filter((file) =>
              input.relativePaths!.includes(file.relativePath),
            );
      const items =
        input.mode === "whole"
          ? [wholeImport(owner, selected)]
          : selected.map((file) => fileImport(owner, file));
      return {
        channelId: input.channelId,
        instanceId: input.instanceId,
        results: items.map((item) => this.#importOne(actorId, input, item)),
      };
    });
  }

  /**
   * Review P2-4: the authorization an import needs, checked before the server
   * touches the Host's legacy directory — a manager of the channel, and an
   * instance of that channel. Reads nothing and changes nothing.
   */
  humanAuthorizeImportLegacy(
    actor: AuthenticatedActorContext,
    raw: P.ClientMemoryImportLegacyRequest,
  ): void {
    const input = P.ClientMemoryImportLegacyRequestSchema.parse(raw);
    this.#c.transaction(() => this.#importTarget(actor, input));
  }

  #importTarget(
    actor: AuthenticatedActorContext,
    input: { channelId: string; instanceId: string },
  ): { actorId: string; handle: string } {
    const actorId = this.#requireHumanManager(actor, input.channelId);
    const instance = this.#c.database
      .prepare(
        `SELECT p.handle FROM role_instances i JOIN principals p ON p.principal_id=i.instance_id
          WHERE i.instance_id=? AND i.channel_id=?`,
      )
      .get(input.instanceId, input.channelId);
    if (instance === undefined)
      throw new NotFoundError(
        `instance ${input.instanceId} is not an instance of this channel`,
      );
    return { actorId, handle: text(instance, "handle") };
  }

  readPolicy(
    actor: AuthenticatedActorContext,
    raw: P.ClientMemoryPolicyReadRequest,
  ): P.MemoryPolicy {
    const input = P.ClientMemoryPolicyReadRequestSchema.parse(raw);
    this.#requireHumanManager(actor, input.channelId);
    return this.#policy(input.channelId);
  }

  updatePolicy(
    actor: AuthenticatedActorContext,
    raw: P.ClientMemoryPolicyUpdateRequest,
  ): P.MemoryPolicyUpdateResponse {
    const input = P.ClientMemoryPolicyUpdateRequestSchema.parse(raw);
    const c = this.#c;
    return c.transaction(() => {
      const actorId = this.#requireHumanManager(actor, input.channelId);
      const digest = canonicalDigest({ ...input, idempotencyKey: null });
      const priorRow = this.#priorEvent(
        input.channelId,
        actorId,
        input.idempotencyKey,
        POLICY_EVENT,
        digest,
      );
      if (priorRow)
        return {
          policy: this.#policy(input.channelId),
          event: priorRow,
          deduplicated: true,
        };
      const current = memoryPolicyState(c.database, input.channelId);
      if (current.revision !== input.expectedRevision)
        throw new ConflictError(
          `channel memory policy is at revision ${current.revision}; read it again before changing it`,
        );
      for (const override of input.overrides ?? []) {
        const member = c.database
          .prepare(
            `SELECT 1 FROM role_instances i JOIN memberships m
               ON m.room_id=i.channel_id AND m.principal_id=i.instance_id
             WHERE i.instance_id=? AND i.channel_id=?`,
          )
          .get(override.instanceId, input.channelId);
        if (member === undefined)
          throw new NotFoundError(
            `instance ${override.instanceId} is not a member of this channel`,
          );
      }
      const now = c.now().toISOString();
      const revision = current.revision + 1;
      const readDefault = input.readDefault ?? current.readDefault;
      const writeDefault = input.writeDefault ?? current.writeDefault;
      c.database
        .prepare(
          `INSERT INTO memory_access_policies(room_id,read_default,write_default,revision,updated_by,updated_at)
           VALUES(?,?,?,?,?,?)
           ON CONFLICT(room_id) DO UPDATE SET read_default=excluded.read_default,
             write_default=excluded.write_default, revision=excluded.revision,
             updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
        )
        .run(
          input.channelId,
          readDefault ? 1 : 0,
          writeDefault ? 1 : 0,
          revision,
          actorId,
          now,
        );
      for (const override of input.overrides ?? []) {
        if (override.read === null && override.write === null) {
          c.database
            .prepare(
              "DELETE FROM memory_access_overrides WHERE room_id=? AND instance_id=?",
            )
            .run(input.channelId, override.instanceId);
          continue;
        }
        const flag = (value: boolean | null) =>
          value === null ? null : value ? 1 : 0;
        c.database
          .prepare(
            `INSERT INTO memory_access_overrides(room_id,instance_id,read_enabled,write_enabled,updated_at)
             VALUES(?,?,?,?,?)
             ON CONFLICT(room_id,instance_id) DO UPDATE SET read_enabled=excluded.read_enabled,
               write_enabled=excluded.write_enabled, updated_at=excluded.updated_at`,
          )
          .run(
            input.channelId,
            override.instanceId,
            flag(override.read),
            flag(override.write),
            now,
          );
      }
      const event = c.events.append({
        actorId,
        aggregateId: input.channelId,
        aggregateType: "memory_policy",
        idempotencyKey: eventKey(actorId, input.idempotencyKey),
        payload: {
          overrides: input.overrides ?? [],
          readDefault,
          requestDigest: digest,
          revision,
          writeDefault,
        },
        roomId: input.channelId,
        type: POLICY_EVENT,
      });
      return {
        policy: this.#policy(input.channelId),
        event,
        deduplicated: false,
      };
    });
  }

  // Internals.

  #importOne(
    actorId: string,
    input: P.ClientMemoryImportLegacyRequest,
    item: LegacyImport,
  ): P.MemoryImportLegacyResponse["results"][number] {
    const database = this.#c.database;
    const prior = database
      .prepare(
        `SELECT e.entry_id, e.name, e.state FROM memory_entries e
           JOIN memory_revisions r ON r.entry_id=e.entry_id AND r.revision=1
          WHERE e.scope_room_id=? AND r.import_instance_id=? AND r.import_path=?`,
      )
      .get(input.channelId, input.instanceId, item.path);
    if (prior !== undefined)
      return {
        path: item.path,
        status: "existing",
        entryId: text(prior, "entry_id"),
        name: P.MemoryEntryNameSchema.parse(text(prior, "name")),
        ...(text(prior, "state") === "active"
          ? {}
          : { reason: `already imported; now ${text(prior, "state")}` }),
      };
    const body = P.MemoryBodySchema.safeParse(item.body);
    if (!body.success)
      return {
        path: item.path,
        status: "skipped",
        reason: body.error.issues[0]?.message ?? "invalid memory body",
      };
    const taken = this.#entryByName(input.channelId, item.name);
    if (taken !== undefined)
      return {
        path: item.path,
        status: "skipped",
        name: P.MemoryEntryNameSchema.parse(item.name),
        reason: `memory name '${item.name}' is already used in this channel`,
      };
    const digest = canonicalDigest({
      op: "import",
      channelId: input.channelId,
      instanceId: input.instanceId,
      path: item.path,
    });
    const key = `${input.idempotencyKey}:${item.path}`;
    const replay = this.#replay(
      input.channelId,
      actorId,
      key,
      ENTRY_EVENT,
      digest,
    );
    const committed =
      replay ??
      this.#commit({
        actorId,
        channelId: input.channelId,
        digest,
        key,
        next: {
          body: body.data,
          description: item.description,
          name: item.name,
          pinned: false,
          state: "active",
          type: "reference",
        },
        op: "create",
        provenance: {
          ...humanProvenance(actorId, this.#c.now()),
          importedFrom: { instanceId: input.instanceId, path: item.path },
        },
        reason: null,
      });
    return {
      path: item.path,
      status: replay === undefined ? "created" : "existing",
      entryId: committed.entry.entryId,
      name: committed.entry.name,
    };
  }

  #workerRead(worker: AuthenticatedWorkerExecutionContext): string {
    const scope = this.#c.requireWorker(worker);
    return requireMemoryAccess(this.#c.database, scope, "read");
  }

  #workerChange(
    worker: AuthenticatedWorkerExecutionContext,
    input: { expectedRevision: number; idempotencyKey: string; name: string },
    op: P.MemoryRevisionOperation,
    change: (
      current: Snapshot,
      readable: boolean,
    ) => { next: Snapshot; reason: string | null },
  ): P.WorkerMemoryMutationReceipt {
    return this.#c.transaction(() => {
      const scope = this.#c.requireWorker(worker);
      const channelId = requireMemoryAccess(this.#c.database, scope, "write");
      const digest = canonicalDigest({ op, ...input, idempotencyKey: null });
      const prior = this.#replay(
        channelId,
        scope.participantId,
        input.idempotencyKey,
        ENTRY_EVENT,
        digest,
      );
      if (prior) return workerReceipt(prior);
      const row = this.#requireByName(channelId, input.name);
      requireRevision(row, input.expectedRevision);
      const { next, reason } = change(
        snapshot(row),
        hasMemoryAccess(this.#c.database, scope, "read"),
      );
      return workerReceipt(
        this.#commit({
          actorId: scope.participantId,
          channelId,
          digest,
          entry: row,
          key: input.idempotencyKey,
          next,
          op,
          provenance: this.#workerProvenance(scope),
          reason,
        }),
      );
    });
  }

  #humanChange(
    actor: AuthenticatedActorContext,
    input: {
      entryId: string;
      expectedRevision: number;
      idempotencyKey: string;
    },
    op: P.MemoryRevisionOperation,
    change: (current: Snapshot) => { next: Snapshot; reason: string | null },
  ): P.MemoryMutationResponse {
    return this.#c.transaction(() => {
      const { actorId, channelId, row } = this.#humanEntry(
        actor,
        input.entryId,
      );
      const digest = canonicalDigest({ op, ...input, idempotencyKey: null });
      const prior = this.#replay(
        channelId,
        actorId,
        input.idempotencyKey,
        ENTRY_EVENT,
        digest,
      );
      if (prior) return prior;
      if (text(row, "state") === "deleted")
        throw new ConflictError("memory entry was deleted");
      requireRevision(row, input.expectedRevision);
      const { next, reason } = change(snapshot(row));
      return this.#commit({
        actorId,
        channelId,
        digest,
        entry: row,
        key: input.idempotencyKey,
        next,
        op,
        provenance: humanProvenance(actorId, this.#c.now()),
        reason,
      });
    });
  }

  #commit(input: {
    actorId: string;
    channelId: string;
    digest: string;
    entry?: Row;
    key: string;
    next: Snapshot;
    op: P.MemoryRevisionOperation;
    provenance: P.MemoryProvenance;
    reason: string | null;
  }): P.MemoryMutationResponse {
    const c = this.#c;
    const entryId = input.entry
      ? text(input.entry, "entry_id")
      : c.createId("memory");
    const revision = input.entry ? integer(input.entry, "revision") + 1 : 1;
    const at = input.provenance.recordedAt;
    const { next } = input;
    const event = c.events.append({
      actorId: input.actorId,
      aggregateId: entryId,
      aggregateType: "memory_entry",
      idempotencyKey: eventKey(input.actorId, input.key),
      payload: {
        entryId,
        name: next.name,
        op: input.op,
        pinned: next.pinned,
        requestDigest: input.digest,
        revision,
        state: next.state,
        type: next.type,
      },
      roomId: input.channelId,
      type: ENTRY_EVENT,
    });
    if (input.entry === undefined)
      c.database
        .prepare(
          `INSERT INTO memory_entries(entry_id,scope_room_id,name,type,description,body,pinned,state,revision,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          entryId,
          input.channelId,
          next.name,
          next.type,
          next.description,
          next.body,
          next.pinned ? 1 : 0,
          next.state,
          revision,
          at,
          at,
        );
    else
      c.database
        .prepare(
          `UPDATE memory_entries SET type=?,description=?,body=?,pinned=?,state=?,revision=?,updated_at=?
           WHERE entry_id=?`,
        )
        .run(
          next.type,
          next.description,
          next.body,
          next.pinned ? 1 : 0,
          next.state,
          revision,
          at,
          entryId,
        );
    if (next.state === "deleted") {
      // Owner ruling 2026-09-27: the tombstone keeps only the delete's own
      // reason; earlier invalidation/restore reasons are free text that can
      // restate the body (full review 2 P2-3).
      c.database
        .prepare(
          `UPDATE memory_revisions SET body=NULL, body_sha256=NULL, description='',
             reason=CASE WHEN op='delete' THEN reason ELSE NULL END
           WHERE entry_id=?`,
        )
        .run(entryId);
      clearPresentedMemoryDescription(c.database, input.channelId, {
        entryId,
        name: next.name,
      });
    }
    const p = input.provenance;
    c.database
      .prepare(
        `INSERT INTO memory_revisions(entry_id,revision,op,name,type,description,body,body_sha256,pinned,state,reason,
           actor_principal_id,actor_kind,role_id,role_revision_id,instance_id,model_binding_id,model_reasoning,
           session_generation,run_attempt_id,via_room_id,based_on_room_seq,idempotency_key,event_id,created_at,
           import_instance_id,import_path)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        entryId,
        revision,
        input.op,
        next.name,
        next.type,
        next.description,
        next.body,
        next.body === null ? null : sha256(next.body),
        next.pinned ? 1 : 0,
        next.state,
        input.reason,
        p.actorPrincipalId,
        p.actorKind,
        p.roleId,
        p.roleRevisionId,
        p.instanceId,
        p.modelBindingId,
        p.modelReasoning,
        p.sessionGeneration,
        p.runAttemptId,
        p.viaRoomId,
        p.basedOnRoomSeq,
        input.key,
        event.eventId,
        at,
        p.importedFrom?.instanceId ?? null,
        p.importedFrom?.path ?? null,
      );
    c.database
      .prepare("DELETE FROM memory_entries_fts WHERE entry_id=?")
      .run(entryId);
    if (next.state === "active")
      c.database
        .prepare(
          "INSERT INTO memory_entries_fts(entry_id,name,description,body) VALUES(?,?,?,?)",
        )
        .run(entryId, next.name, next.description, next.body ?? "");
    return {
      entry: this.#detailAt(entryId, revision),
      event,
      deduplicated: false,
    };
  }

  #priorEvent(
    channelId: string,
    actorId: string,
    key: string,
    type: string,
    digest: string,
  ): P.RoomEvent | undefined {
    const row = this.#c.database
      .prepare(
        "SELECT * FROM room_events WHERE room_id=? AND idempotency_key=?",
      )
      .get(channelId, eventKey(actorId, key));
    if (row === undefined) return undefined;
    const event = this.#c.events.eventFromRow(row);
    if (
      event.actorId !== actorId ||
      event.type !== type ||
      event.payload.requestDigest !== digest
    )
      throw new IdempotencyConflictError(
        "memory idempotency key was already used for a different request",
      );
    return event;
  }

  #replay(
    channelId: string,
    actorId: string,
    key: string,
    type: string,
    digest: string,
  ): P.MemoryMutationResponse | undefined {
    const event = this.#priorEvent(channelId, actorId, key, type, digest);
    if (event === undefined) return undefined;
    return {
      entry: this.#detailAt(
        String(event.payload.entryId),
        Number(event.payload.revision),
      ),
      event,
      deduplicated: true,
    };
  }

  #workerProvenance(scope: P.ActivationCredentialScope): P.MemoryProvenance {
    const database = this.#c.database;
    const instance = database
      .prepare(
        "SELECT role_id, role_revision_id FROM role_instances WHERE instance_id=?",
      )
      .get(scope.participantId);
    if (instance === undefined)
      throw new ForbiddenError(
        "channel memory is available to Role instances only",
      );
    const placement = database
      .prepare(
        `SELECT json_extract(p.decision_json,'$.resolvedModel') AS resolved_model
         FROM run_attempts r LEFT JOIN placements p USING(placement_id)
         WHERE r.run_attempt_id=?`,
      )
      .get(scope.runAttemptId);
    const raw =
      placement === undefined
        ? null
        : nullableText(placement, "resolved_model");
    const parsed =
      raw === null
        ? undefined
        : P.ResolvedModelSchema.safeParse(JSON.parse(raw));
    const model = parsed?.success ? parsed.data : undefined;
    return {
      actorPrincipalId: scope.participantId,
      actorKind: "instance",
      roleId: text(instance, "role_id"),
      roleRevisionId: text(instance, "role_revision_id"),
      instanceId: scope.participantId,
      modelBindingId:
        model?.source === "explicit_binding"
          ? model.modelBindingId
          : model?.source === "custom_model"
            ? `custom:${model.modelId}`
            : null,
      modelReasoning:
        model !== undefined && model.source !== "runtime_default"
          ? (model.reasoning ?? null)
          : null,
      sessionGeneration: instanceSessionState(database, scope.participantId)
        .generation,
      runAttemptId: scope.runAttemptId,
      viaRoomId: scope.roomId,
      basedOnRoomSeq: scope.toSeq,
      recordedAt: this.#c.now().toISOString(),
    };
  }

  #requireHumanManager(
    actor: AuthenticatedActorContext,
    channelId: string,
  ): string {
    const actorId = this.#c.requireActor(actor);
    const principal = this.#c.database
      .prepare("SELECT kind FROM principals WHERE principal_id=?")
      .get(actorId);
    if (principal === undefined || text(principal, "kind") !== "human")
      throw new ForbiddenError(
        "channel memory administration requires a Human",
      );
    const room = this.#c.database
      .prepare("SELECT kind FROM rooms WHERE room_id=?")
      .get(channelId);
    if (room === undefined || text(room, "kind") !== "channel")
      throw new NotFoundError("channel memory exists only for channels");
    requireRoomManager(this.#c.database, channelId, actorId);
    return actorId;
  }

  #humanEntry(
    actor: AuthenticatedActorContext,
    entryId: string,
  ): { actorId: string; channelId: string; row: Row } {
    const row = this.#c.database
      .prepare("SELECT * FROM memory_entries WHERE entry_id=?")
      .get(entryId);
    if (row === undefined) {
      this.#c.requireActor(actor);
      throw new NotFoundError("memory entry was not found");
    }
    const channelId = text(row, "scope_room_id");
    return {
      actorId: this.#requireHumanManager(actor, channelId),
      channelId,
      row,
    };
  }

  #entryByName(channelId: string, name: string): Row | undefined {
    return this.#c.database
      .prepare(
        "SELECT * FROM memory_entries WHERE scope_room_id=? AND name=? AND state<>'deleted'",
      )
      .get(channelId, name);
  }

  #requireByName(channelId: string, name: string): Row {
    const row = this.#entryByName(channelId, name);
    if (row === undefined)
      throw new NotFoundError(
        `memory '${name}' was not found in this channel; use memory list or memory search`,
      );
    return row;
  }

  #list(
    channelId: string,
    states: readonly P.MemoryEntryState[],
    limit: number,
  ): P.MemoryListResponse {
    const placeholders = states.map(() => "?").join(",");
    const rows = this.#c.database
      .prepare(
        `SELECT * FROM memory_entries WHERE scope_room_id=? AND state IN (${placeholders})
         ORDER BY pinned DESC, updated_at DESC, entry_id LIMIT ?`,
      )
      .all(channelId, ...states, limit);
    const total = integer(
      this.#c.database
        .prepare(
          `SELECT count(*) AS n FROM memory_entries WHERE scope_room_id=? AND state IN (${placeholders})`,
        )
        .get(channelId, ...states)!,
      "n",
    );
    return {
      channelId,
      entries: rows.map(indexRow),
      total,
      truncated: total > rows.length,
    };
  }

  #search(
    channelId: string,
    query: string,
    limit: number,
  ): P.MemorySearchResponse {
    const terms = query.split(/\s+/u).filter((term) => term.length > 0);
    // The trigram index needs three characters per term; shorter terms use
    // a LIKE scan over the same, already permitted, channel scope.
    const useIndex = terms.every((term) => [...term].length >= 3);
    const rows = useIndex
      ? this.#c.database
          .prepare(
            `SELECT e.* FROM memory_entries_fts f JOIN memory_entries e ON e.entry_id=f.entry_id
             WHERE e.scope_room_id=? AND e.state='active' AND memory_entries_fts MATCH ?
             ORDER BY bm25(memory_entries_fts), e.pinned DESC, e.updated_at DESC LIMIT ?`,
          )
          .all(
            channelId,
            terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" "),
            limit + 1,
          )
      : this.#c.database
          .prepare(
            `SELECT e.* FROM memory_entries e WHERE e.scope_room_id=? AND e.state='active' AND ${terms
              .map(
                () =>
                  "(e.name LIKE ? ESCAPE '\\' OR e.description LIKE ? ESCAPE '\\' OR e.body LIKE ? ESCAPE '\\')",
              )
              .join(" AND ")}
             ORDER BY e.pinned DESC, e.updated_at DESC LIMIT ?`,
          )
          .all(
            channelId,
            ...terms.flatMap((term) => {
              const pattern = `%${term.replace(/[\\%_]/gu, (match) => `\\${match}`)}%`;
              return [pattern, pattern, pattern];
            }),
            limit + 1,
          );
    return {
      channelId,
      query,
      entries: rows.slice(0, limit).map(indexRow),
      truncated: rows.length > limit,
    };
  }

  #history(row: Row): P.MemoryHistoryResponse {
    const revisions = this.#c.database
      .prepare(
        "SELECT * FROM memory_revisions WHERE entry_id=? ORDER BY revision DESC LIMIT ?",
      )
      .all(text(row, "entry_id"), P.MEMORY_HISTORY_MAX_REVISIONS + 1);
    return {
      entry: indexRow(row),
      revisions: revisions
        .slice(0, P.MEMORY_HISTORY_MAX_REVISIONS)
        .map(revisionFromRow),
      truncated: revisions.length > P.MEMORY_HISTORY_MAX_REVISIONS,
    };
  }

  #detail(row: Row): P.MemoryEntryDetail {
    return this.#detailAt(text(row, "entry_id"), integer(row, "revision"));
  }

  /** The entry as it stood at one revision (a delete leaves bodies null, descriptions empty). */
  #detailAt(entryId: string, revision: number): P.MemoryEntryDetail {
    const entry = this.#c.database
      .prepare("SELECT * FROM memory_entries WHERE entry_id=?")
      .get(entryId);
    const at = this.#c.database
      .prepare("SELECT * FROM memory_revisions WHERE entry_id=? AND revision=?")
      .get(entryId, revision);
    if (entry === undefined || at === undefined)
      throw new NotFoundError("memory revision was not found");
    const version = revisionFromRow(at);
    return P.MemoryEntryDetailSchema.parse({
      entryId,
      channelId: text(entry, "scope_room_id"),
      name: version.name,
      type: version.type,
      description: version.description,
      pinned: version.pinned,
      state: version.state,
      revision,
      createdAt: text(entry, "created_at"),
      updatedAt: version.provenance.recordedAt,
      body: version.body,
      provenance: version.provenance,
    });
  }

  #policy(channelId: string): P.MemoryPolicy {
    const database = this.#c.database;
    const state = memoryPolicyState(database, channelId);
    const members = database
      .prepare(
        `SELECT i.instance_id FROM role_instances i JOIN memberships m
           ON m.room_id=i.channel_id AND m.principal_id=i.instance_id
         WHERE i.channel_id=? ORDER BY i.instance_id`,
      )
      .all(channelId)
      .map((row) => text(row, "instance_id"));
    const overrides = database
      .prepare(
        "SELECT instance_id FROM memory_access_overrides WHERE room_id=? ORDER BY instance_id",
      )
      .all(channelId)
      .map((row) => {
        const instanceId = text(row, "instance_id");
        return {
          instanceId,
          ...memoryOverride(database, channelId, instanceId),
        };
      });
    return P.MemoryPolicySchema.parse({
      channelId,
      revision: state.revision,
      readDefault: state.readDefault,
      writeDefault: state.writeDefault,
      overrides,
      members: members.map((instanceId) => ({
        instanceId,
        ...effectiveMemorySwitches(database, channelId, instanceId),
      })),
    });
  }
}

function invalidation(
  current: Snapshot,
  reason: string,
): { next: Snapshot; reason: string } {
  if (current.state !== "active")
    throw new ConflictError(`memory '${current.name}' is not active`);
  return { next: { ...current, state: "invalidated" }, reason };
}

function restoration(current: Snapshot): {
  next: Snapshot;
  reason: null;
} {
  if (current.state !== "invalidated")
    throw new ConflictError(`memory '${current.name}' is not invalidated`);
  return { next: { ...current, state: "active" }, reason: null };
}

/**
 * The Worker receipt of a change or its replay, taken from the metadata-only
 * Room event: never the body, description or provenance (see
 * WorkerMemoryMutationReceiptSchema).
 */
function workerReceipt(
  response: P.MemoryMutationResponse,
): P.WorkerMemoryMutationReceipt {
  const payload = response.event.payload;
  return {
    entryId: String(payload.entryId),
    name: P.MemoryEntryNameSchema.parse(payload.name),
    revision: Number(payload.revision),
    op: P.MemoryRevisionOperationSchema.parse(payload.op),
    state: P.MemoryEntryStateSchema.parse(payload.state),
    deduplicated: response.deduplicated,
  };
}

function requireRevision(row: Row, expected: number): void {
  const revision = integer(row, "revision");
  if (revision !== expected)
    throw new ConflictError(
      `memory '${text(row, "name")}' is at revision ${revision}, not ${expected}; read it again before changing it`,
    );
}

function snapshot(row: Row): Snapshot {
  return {
    body: nullableText(row, "body"),
    description: text(row, "description"),
    name: text(row, "name"),
    pinned: integer(row, "pinned") === 1,
    state: P.MemoryEntryStateSchema.parse(text(row, "state")),
    type: P.MemoryEntryTypeSchema.parse(text(row, "type")),
  };
}

function indexRow(row: Row): P.MemoryEntry {
  return P.MemoryEntrySchema.parse({
    entryId: text(row, "entry_id"),
    channelId: text(row, "scope_room_id"),
    name: text(row, "name"),
    type: text(row, "type"),
    description: text(row, "description"),
    pinned: integer(row, "pinned") === 1,
    state: text(row, "state"),
    revision: integer(row, "revision"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  });
}

function revisionFromRow(row: Row): P.MemoryRevision {
  return P.MemoryRevisionSchema.parse({
    entryId: text(row, "entry_id"),
    revision: integer(row, "revision"),
    op: text(row, "op"),
    name: text(row, "name"),
    type: text(row, "type"),
    description: text(row, "description"),
    body: nullableText(row, "body"),
    pinned: integer(row, "pinned") === 1,
    state: text(row, "state"),
    reason: nullableText(row, "reason"),
    provenance: {
      actorPrincipalId: text(row, "actor_principal_id"),
      actorKind: text(row, "actor_kind"),
      roleId: nullableText(row, "role_id"),
      roleRevisionId: nullableText(row, "role_revision_id"),
      instanceId: nullableText(row, "instance_id"),
      modelBindingId: nullableText(row, "model_binding_id"),
      modelReasoning: nullableText(row, "model_reasoning"),
      sessionGeneration: nullableInteger(row, "session_generation"),
      runAttemptId: nullableText(row, "run_attempt_id"),
      viaRoomId: nullableText(row, "via_room_id"),
      basedOnRoomSeq: nullableInteger(row, "based_on_room_seq"),
      recordedAt: text(row, "created_at"),
      ...(nullableText(row, "import_instance_id") === null
        ? {}
        : {
            importedFrom: {
              instanceId: text(row, "import_instance_id"),
              path: text(row, "import_path"),
            },
          }),
    },
  });
}

function humanProvenance(actorId: string, now: Date): P.MemoryProvenance {
  return {
    actorPrincipalId: actorId,
    actorKind: "human",
    roleId: null,
    roleRevisionId: null,
    instanceId: null,
    modelBindingId: null,
    modelReasoning: null,
    sessionGeneration: null,
    runAttemptId: null,
    viaRoomId: null,
    basedOnRoomSeq: null,
    recordedAt: now.toISOString(),
  };
}

function eventKey(actorId: string, key: string): string {
  return `memory:${actorId}:${key}`;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

type LegacyImport = {
  body: string;
  description: string;
  name: string;
  path: string;
};

/** The source label of a `whole` import. */
const WHOLE_IMPORT_PATH = "MEMORY.md + notes/";

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.md$/u, "")
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, "");
}

function importName(owner: string, part: string): string {
  const name = `legacy-${owner}${part === "" ? "" : `-${part}`}`
    .slice(0, 64)
    .replace(/[^a-z0-9]+$/u, "");
  return name;
}

function importDescription(path: string, content: string): string {
  const line =
    content
      .split("\n")
      .map((value) => value.replace(/^[\s#>*-]+/u, "").trim())
      .find((value) => value !== "") ?? "";
  const text = `Legacy ${path}${line === "" ? "" : `: ${line}`}`.replace(
    /[\u0000-\u001f\u007f]/gu,
    " ",
  );
  return text.length <= P.MEMORY_DESCRIPTION_MAX_CHARS
    ? text
    : `${text.slice(0, P.MEMORY_DESCRIPTION_MAX_CHARS - 1)}…`;
}

function fileImport(owner: string, file: P.LegacyMemoryFile): LegacyImport {
  const part =
    file.relativePath === "MEMORY.md"
      ? "index"
      : slugPart(
          file.relativePath.replace(/^notes\//u, "").replaceAll("/", "-"),
        );
  return {
    body: file.content,
    description: importDescription(file.relativePath, file.content),
    name: importName(owner, part),
    path: file.relativePath,
  };
}

function wholeImport(
  owner: string,
  files: readonly P.LegacyMemoryFile[],
): LegacyImport {
  const body = files
    .map((file) =>
      file.relativePath === "MEMORY.md"
        ? file.content
        : `## ${file.relativePath}\n\n${file.content}`,
    )
    .join("\n\n");
  return {
    body,
    description:
      `Legacy memory of @${owner}: MEMORY.md and ${String(files.filter((file) => file.relativePath !== "MEMORY.md").length)} notes`.slice(
        0,
        P.MEMORY_DESCRIPTION_MAX_CHARS,
      ),
    name: importName(owner, ""),
    path: WHOLE_IMPORT_PATH,
  };
}
