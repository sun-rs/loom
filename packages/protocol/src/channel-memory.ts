import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";
import { RoomEventSchema } from "./room-event.ts";

/**
 * evo S6 platform memory (contract §4, owner ruling 2026-09-26): long-term
 * memory owned by the Kernel and scoped to one channel. The shape follows
 * Claude Code auto memory (name + one-line description index, body on
 * demand, four types); enforcement follows a platform store (authenticated
 * scope, read/write switches, immutable revisions, optimistic concurrency).
 * Provenance is filled from the authenticated context only: no request
 * schema below carries an author, Role, model, session, RunAttempt or scope
 * field for a Worker, and every schema is strict.
 */
export const MEMORY_ENTRY_TYPES = [
  "user",
  "feedback",
  "project",
  "reference",
] as const;
export const MemoryEntryTypeSchema = z.enum(MEMORY_ENTRY_TYPES);
export type MemoryEntryType = z.infer<typeof MemoryEntryTypeSchema>;

export const MemoryEntryStateSchema = z.enum([
  "active",
  "invalidated",
  "deleted",
]);
export type MemoryEntryState = z.infer<typeof MemoryEntryStateSchema>;

/** Body limit in UTF-8 bytes (owner ruling: 16 KiB per entry). */
export const MEMORY_BODY_MAX_BYTES = 16 * 1024;
export const MEMORY_DESCRIPTION_MAX_CHARS = 150;
export const MEMORY_REASON_MAX_CHARS = 500;
export const MEMORY_LIST_MAX_LIMIT = 200;
export const MEMORY_SEARCH_MAX_LIMIT = 50;
export const MEMORY_HISTORY_MAX_REVISIONS = 20;

/** A stable slug; unique among the non-deleted entries of one channel. */
export const MemoryEntryNameSchema = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u,
    "memory name must be a lowercase slug of 1-64 characters (a-z, 0-9, '.', '_', '-')",
  );

const UTF8 = new TextEncoder();
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export const MemoryDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(MEMORY_DESCRIPTION_MAX_CHARS)
  .refine((value) => !CONTROL_CHARACTERS.test(value), {
    message: "memory description must be a single line",
  });

export const MemoryBodySchema = z
  .string()
  .refine((value) => value.trim().length > 0, {
    message: "memory body is required",
  })
  .refine((value) => !value.includes("\u0000"), {
    message: "memory body must not contain NUL",
  })
  .refine((value) => UTF8.encode(value).byteLength <= MEMORY_BODY_MAX_BYTES, {
    message: `memory body exceeds ${MEMORY_BODY_MAX_BYTES} bytes`,
  });

export const MemoryReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(MEMORY_REASON_MAX_CHARS);

const ExpectedRevisionSchema = z.number().int().positive();

/**
 * Who wrote a revision, filled by the Kernel from the authenticated context.
 * It proves authorship, not correctness. Fields a runtime cannot establish
 * (for example the model of a RunAttempt without a placement decision) are
 * null, never estimated.
 */
export const MemoryProvenanceSchema = z
  .object({
    actorPrincipalId: IdentifierSchema,
    actorKind: z.enum(["instance", "human"]),
    roleId: IdentifierSchema.nullable(),
    roleRevisionId: IdentifierSchema.nullable(),
    instanceId: IdentifierSchema.nullable(),
    modelBindingId: z.string().nullable(),
    modelReasoning: z.string().nullable(),
    sessionGeneration: z.number().int().nonnegative().nullable(),
    runAttemptId: IdentifierSchema.nullable(),
    viaRoomId: IdentifierSchema.nullable(),
    basedOnRoomSeq: z.number().int().nonnegative().nullable(),
    recordedAt: TimestampSchema,
  })
  .strict();
export type MemoryProvenance = z.infer<typeof MemoryProvenanceSchema>;

/** One index row: never carries the body. */
export const MemoryEntrySchema = z
  .object({
    entryId: IdentifierSchema,
    channelId: IdentifierSchema,
    name: MemoryEntryNameSchema,
    type: MemoryEntryTypeSchema,
    description: z.string(),
    pinned: z.boolean(),
    state: MemoryEntryStateSchema,
    revision: z.number().int().positive(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

/** An entry with its current body (null after a Human delete). */
export const MemoryEntryDetailSchema = MemoryEntrySchema.extend({
  body: z.string().nullable(),
  provenance: MemoryProvenanceSchema,
}).strict();
export type MemoryEntryDetail = z.infer<typeof MemoryEntryDetailSchema>;

export const MemoryRevisionOperationSchema = z.enum([
  "create",
  "update",
  "invalidate",
  "restore",
  "pin",
  "unpin",
  "delete",
]);
export type MemoryRevisionOperation = z.infer<
  typeof MemoryRevisionOperationSchema
>;

/** Immutable, except that a Human delete redacts every body to null. */
export const MemoryRevisionSchema = z
  .object({
    entryId: IdentifierSchema,
    revision: z.number().int().positive(),
    op: MemoryRevisionOperationSchema,
    name: MemoryEntryNameSchema,
    type: MemoryEntryTypeSchema,
    description: z.string(),
    body: z.string().nullable(),
    pinned: z.boolean(),
    state: MemoryEntryStateSchema,
    reason: z.string().nullable(),
    provenance: MemoryProvenanceSchema,
  })
  .strict();
export type MemoryRevision = z.infer<typeof MemoryRevisionSchema>;

// Worker requests: the scope is the instance's channel, derived by the
// Kernel from the Worker credential. None of these carries a channel.

export const WorkerMemoryWriteRequestSchema = z
  .object({
    name: MemoryEntryNameSchema,
    type: MemoryEntryTypeSchema,
    description: MemoryDescriptionSchema,
    body: MemoryBodySchema,
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export type WorkerMemoryWriteRequest = z.infer<
  typeof WorkerMemoryWriteRequestSchema
>;

export const WorkerMemoryUpdateRequestSchema = z
  .object({
    name: MemoryEntryNameSchema,
    expectedRevision: ExpectedRevisionSchema,
    type: MemoryEntryTypeSchema.optional(),
    description: MemoryDescriptionSchema.optional(),
    body: MemoryBodySchema.optional(),
    idempotencyKey: IdentifierSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.type !== undefined ||
      value.description !== undefined ||
      value.body !== undefined,
    { message: "memory update needs a new type, description or body" },
  );
export type WorkerMemoryUpdateRequest = z.infer<
  typeof WorkerMemoryUpdateRequestSchema
>;

export const WorkerMemoryInvalidateRequestSchema = z
  .object({
    name: MemoryEntryNameSchema,
    expectedRevision: ExpectedRevisionSchema,
    reason: MemoryReasonSchema,
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export type WorkerMemoryInvalidateRequest = z.infer<
  typeof WorkerMemoryInvalidateRequestSchema
>;

export const WorkerMemoryRestoreRequestSchema = z
  .object({
    name: MemoryEntryNameSchema,
    expectedRevision: ExpectedRevisionSchema,
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export type WorkerMemoryRestoreRequest = z.infer<
  typeof WorkerMemoryRestoreRequestSchema
>;

export const WorkerMemoryListRequestSchema = z
  .object({
    includeInvalidated: z.boolean().optional(),
    limit: z.number().int().positive().max(MEMORY_LIST_MAX_LIMIT).optional(),
  })
  .strict();
export type WorkerMemoryListRequest = z.infer<
  typeof WorkerMemoryListRequestSchema
>;

export const WorkerMemoryReadRequestSchema = z
  .object({ name: MemoryEntryNameSchema })
  .strict();
export type WorkerMemoryReadRequest = z.infer<
  typeof WorkerMemoryReadRequestSchema
>;

export const MemorySearchQuerySchema = z.string().trim().min(1).max(200);

export const WorkerMemorySearchRequestSchema = z
  .object({
    query: MemorySearchQuerySchema,
    limit: z.number().int().positive().max(MEMORY_SEARCH_MAX_LIMIT).optional(),
  })
  .strict();
export type WorkerMemorySearchRequest = z.infer<
  typeof WorkerMemorySearchRequestSchema
>;

export const WorkerMemoryHistoryRequestSchema = WorkerMemoryReadRequestSchema;
export type WorkerMemoryHistoryRequest = WorkerMemoryReadRequest;

// Responses shared by the Worker and Human facades.

export const MemoryMutationResponseSchema = z
  .object({
    entry: MemoryEntryDetailSchema,
    event: RoomEventSchema,
    deduplicated: z.boolean(),
  })
  .strict();
export type MemoryMutationResponse = z.infer<
  typeof MemoryMutationResponseSchema
>;

export const MemoryListResponseSchema = z
  .object({
    channelId: IdentifierSchema,
    entries: z.array(MemoryEntrySchema),
    total: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();
export type MemoryListResponse = z.infer<typeof MemoryListResponseSchema>;

export const MemoryReadResponseSchema = z
  .object({ entry: MemoryEntryDetailSchema })
  .strict();
export type MemoryReadResponse = z.infer<typeof MemoryReadResponseSchema>;

export const MemorySearchResponseSchema = z
  .object({
    channelId: IdentifierSchema,
    query: z.string(),
    entries: z.array(MemoryEntrySchema),
    truncated: z.boolean(),
  })
  .strict();
export type MemorySearchResponse = z.infer<typeof MemorySearchResponseSchema>;

export const MemoryHistoryResponseSchema = z
  .object({
    entry: MemoryEntrySchema,
    revisions: z.array(MemoryRevisionSchema),
    truncated: z.boolean(),
  })
  .strict();
export type MemoryHistoryResponse = z.infer<typeof MemoryHistoryResponseSchema>;

// Human requests (authenticated Human who manages the channel).

export const ClientMemoryListRequestSchema = z
  .object({
    channelId: IdentifierSchema,
    includeInvalidated: z.boolean().optional(),
    includeDeleted: z.boolean().optional(),
    limit: z.number().int().positive().max(MEMORY_LIST_MAX_LIMIT).optional(),
  })
  .strict();
export type ClientMemoryListRequest = z.infer<
  typeof ClientMemoryListRequestSchema
>;

export const ClientMemoryEntryRequestSchema = z
  .object({ entryId: IdentifierSchema })
  .strict();
export type ClientMemoryEntryRequest = z.infer<
  typeof ClientMemoryEntryRequestSchema
>;

export const ClientMemorySearchRequestSchema = z
  .object({
    channelId: IdentifierSchema,
    query: MemorySearchQuerySchema,
    limit: z.number().int().positive().max(MEMORY_SEARCH_MAX_LIMIT).optional(),
  })
  .strict();
export type ClientMemorySearchRequest = z.infer<
  typeof ClientMemorySearchRequestSchema
>;

export const ClientMemoryInvalidateRequestSchema = z
  .object({
    entryId: IdentifierSchema,
    expectedRevision: ExpectedRevisionSchema,
    reason: MemoryReasonSchema,
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export type ClientMemoryInvalidateRequest = z.infer<
  typeof ClientMemoryInvalidateRequestSchema
>;

export const ClientMemoryRestoreRequestSchema = z
  .object({
    entryId: IdentifierSchema,
    expectedRevision: ExpectedRevisionSchema,
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export type ClientMemoryRestoreRequest = z.infer<
  typeof ClientMemoryRestoreRequestSchema
>;

export const ClientMemoryDeleteRequestSchema =
  ClientMemoryInvalidateRequestSchema;
export type ClientMemoryDeleteRequest = ClientMemoryInvalidateRequest;

export const ClientMemoryPinRequestSchema = z
  .object({
    entryId: IdentifierSchema,
    expectedRevision: ExpectedRevisionSchema,
    pinned: z.boolean(),
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export type ClientMemoryPinRequest = z.infer<
  typeof ClientMemoryPinRequestSchema
>;

/** A per-instance switch override; null inherits the channel default. */
export const MemoryAccessOverrideSchema = z
  .object({
    instanceId: IdentifierSchema,
    read: z.boolean().nullable(),
    write: z.boolean().nullable(),
  })
  .strict();
export type MemoryAccessOverride = z.infer<typeof MemoryAccessOverrideSchema>;

/**
 * Channel memory switches. Defaults are on. `members` is the effective
 * access of each current instance member (override, else default).
 */
export const MemoryPolicySchema = z
  .object({
    channelId: IdentifierSchema,
    revision: z.number().int().nonnegative(),
    readDefault: z.boolean(),
    writeDefault: z.boolean(),
    overrides: z.array(MemoryAccessOverrideSchema),
    members: z.array(
      z
        .object({
          instanceId: IdentifierSchema,
          read: z.boolean(),
          write: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export type MemoryPolicy = z.infer<typeof MemoryPolicySchema>;

export const ClientMemoryPolicyReadRequestSchema = z
  .object({ channelId: IdentifierSchema })
  .strict();
export type ClientMemoryPolicyReadRequest = z.infer<
  typeof ClientMemoryPolicyReadRequestSchema
>;

export const ClientMemoryPolicyUpdateRequestSchema = z
  .object({
    channelId: IdentifierSchema,
    expectedRevision: z.number().int().nonnegative(),
    readDefault: z.boolean().optional(),
    writeDefault: z.boolean().optional(),
    overrides: z.array(MemoryAccessOverrideSchema).max(64).optional(),
    idempotencyKey: IdentifierSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.readDefault !== undefined ||
      value.writeDefault !== undefined ||
      (value.overrides !== undefined && value.overrides.length > 0),
    { message: "memory policy update needs a default or an override" },
  )
  .refine(
    (value) =>
      new Set((value.overrides ?? []).map((item) => item.instanceId)).size ===
      (value.overrides ?? []).length,
    { message: "memory policy overrides must name each instance once" },
  );
export type ClientMemoryPolicyUpdateRequest = z.infer<
  typeof ClientMemoryPolicyUpdateRequestSchema
>;

export const MemoryPolicyUpdateResponseSchema = z
  .object({
    policy: MemoryPolicySchema,
    event: RoomEventSchema,
    deduplicated: z.boolean(),
  })
  .strict();
export type MemoryPolicyUpdateResponse = z.infer<
  typeof MemoryPolicyUpdateResponseSchema
>;
