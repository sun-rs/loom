import { z } from "zod";
import { AttachmentSchema } from "./room-files.ts";

import { IdentifierSchema, TimestampSchema } from "./common.ts";

export const ParticipantKindSchema = z.enum(["human", "agent", "service"]);
export type ParticipantKind = z.infer<typeof ParticipantKindSchema>;

export const PrincipalSchema = z
  .object({
    avatarKey: z
      .string()
      .regex(/^[a-z0-9_-]{1,64}$/)
      .optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
    principalId: IdentifierSchema,
    handle: IdentifierSchema,
    kind: ParticipantKindSchema,
  })
  .strict();
export type Principal = z.infer<typeof PrincipalSchema>;

export const WorkspaceStateSchema = z.enum(["active", "archived"]);
export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;

export const WorkspaceSchema = z
  .object({
    archivedAt: TimestampSchema.optional(),
    avatarKey: z
      .string()
      .regex(/^[a-z0-9_-]{1,64}$/)
      .optional(),
    controlRoomId: IdentifierSchema.optional(),
    createdAt: TimestampSchema,
    name: IdentifierSchema,
    slug: IdentifierSchema,
    state: WorkspaceStateSchema,
    workspaceId: IdentifierSchema,
  })
  .strict()
  .refine(
    (workspace) =>
      workspace.state === "archived"
        ? workspace.archivedAt !== undefined
        : workspace.archivedAt === undefined,
    {
      message: "archivedAt must match the Workspace state",
      path: ["archivedAt"],
    },
  );
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const RoomKindSchema = z.enum(["channel", "direct", "control"]);
export type RoomKind = z.infer<typeof RoomKindSchema>;

export const RoomVisibilitySchema = z.enum(["public", "private"]);
export type RoomVisibility = z.infer<typeof RoomVisibilitySchema>;

export const MembershipRoleSchema = z.enum(["owner", "admin", "member"]);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;

export const RoomSchema = z
  .object({
    archivedAt: TimestampSchema.optional(),
    createdAt: TimestampSchema,
    description: z.string().trim().max(2_000).optional(),
    // Immutable pair from Kernel, not a viewer-specific name or UI cache.
    directParticipantIds: z
      .tuple([IdentifierSchema, IdentifierSchema])
      .optional(),
    kind: RoomKindSchema,
    name: IdentifierSchema,
    roomId: IdentifierSchema,
    slug: IdentifierSchema,
    visibility: RoomVisibilitySchema.optional(),
    workspaceId: IdentifierSchema,
  })
  .strict();
export type Room = z.infer<typeof RoomSchema>;

export const RoomMembershipSchema = z
  .object({
    joinedAt: TimestampSchema,
    principalId: IdentifierSchema,
    role: MembershipRoleSchema,
    roomId: IdentifierSchema,
  })
  .strict();
export type RoomMembership = z.infer<typeof RoomMembershipSchema>;

export const ForwardedMessageAuthorSnapshotSchema = z
  .object({
    avatarKey: z
      .string()
      .regex(/^[a-z0-9_-]{1,64}$/)
      .optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
    handle: IdentifierSchema,
    kind: ParticipantKindSchema,
    principalId: IdentifierSchema,
  })
  .strict();
export type ForwardedMessageAuthorSnapshot = z.infer<
  typeof ForwardedMessageAuthorSnapshotSchema
>;

export const ForwardedMessageSnapshotSchema = z
  .object({
    actor: ForwardedMessageAuthorSnapshotSchema,
    attachmentPolicy: z.literal("projected").optional(),
    attachments: z.array(AttachmentSchema).max(10).default([]),
    body: z.string(),
    createdAt: TimestampSchema,
    isThreadChild: z.boolean(),
    provenanceState: z.literal("available").optional(),
    sourceMessageId: IdentifierSchema,
    sourceRoomSeq: z.number().int().positive(),
    sourceRootMessageId: IdentifierSchema.optional(),
    sourceThreadId: IdentifierSchema.optional(),
  })
  .strict()
  .superRefine((item, context) => {
    const hasThreadIdentity =
      item.sourceRootMessageId !== undefined &&
      item.sourceThreadId !== undefined;
    if (item.isThreadChild !== hasThreadIdentity) {
      context.addIssue({
        code: "custom",
        message:
          "thread child snapshots require both sourceRootMessageId and sourceThreadId",
      });
    }
    if (
      (item.attachmentPolicy === undefined) !==
      (item.provenanceState === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "forwarded attachment policy and provenance state must be projected together",
      });
    }
  });
export type ForwardedMessageSnapshot = z.infer<
  typeof ForwardedMessageSnapshotSchema
>;

export const ForwardedMessageBundleSchema = z
  .object({
    items: z.array(ForwardedMessageSnapshotSchema).min(1).max(100),
    kind: z.literal("forwarded-bundle"),
    sourceRoom: z
      .object({
        kind: RoomKindSchema,
        name: IdentifierSchema,
        roomId: IdentifierSchema,
        slug: IdentifierSchema,
      })
      .strict(),
    version: z.literal(1),
  })
  .strict();
export type ForwardedMessageBundle = z.infer<
  typeof ForwardedMessageBundleSchema
>;

export const MessageSchema = z
  .object({
    attachments: z.array(AttachmentSchema).max(10).optional(),
    actorId: IdentifierSchema,
    body: z.string(),
    createdAt: TimestampSchema,
    forwardedBundle: ForwardedMessageBundleSchema.optional(),
    messageId: IdentifierSchema,
    roomId: IdentifierSchema,
    roomSeq: z.number().int().positive(),
    threadId: IdentifierSchema.optional(),
  })
  .strict()
  .refine(
    (message) =>
      message.body.trim().length > 0 ||
      !!message.attachments?.length ||
      message.forwardedBundle !== undefined,
    "message body or attachment or forwarded bundle is required",
  );
export type Message = z.infer<typeof MessageSchema>;

export const ThreadSchema = z
  .object({
    createdAt: TimestampSchema,
    createdBy: IdentifierSchema,
    lastReplyAt: TimestampSchema.optional(),
    replyCount: z.number().int().nonnegative(),
    roomId: IdentifierSchema,
    rootMessageId: IdentifierSchema,
    threadId: IdentifierSchema,
  })
  .strict();
export type Thread = z.infer<typeof ThreadSchema>;
