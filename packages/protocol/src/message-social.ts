import { z } from "zod";
import { IdentifierSchema, TimestampSchema } from "./common.ts";
import { SearchHitSchema } from "./client-discovery.ts";
import { PrincipalSchema, RoomKindSchema } from "./collaboration.ts";

// Raft $tt: add/remove are explicit intents, never a retry-sensitive toggle.
export const ReactionEmojiSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .refine(
    (value) =>
      [
        ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
          value,
        ),
      ].length === 1 &&
      /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u.test(
        value,
      ),
    "expected one emoji",
  )
  .transform((value) => (value === "❤" ? "❤️" : value));
export const MessageSocialRequestSchema = z
  .object({
    roomId: IdentifierSchema,
    messageIds: z.array(IdentifierSchema).min(1).max(100),
  })
  .strict();
export const MessageSocialItemSchema = z
  .object({
    messageId: IdentifierSchema,
    version: z.number().int().nonnegative(),
    saved: z.boolean(),
    reactions: z.array(
      z
        .object({
          emoji: z.string(),
          count: z.number().int().positive(),
          mine: z.boolean(),
          actors: z
            .array(
              z
                .object({ principalId: IdentifierSchema, name: z.string() })
                .strict(),
            )
            .max(20),
        })
        .strict(),
    ),
  })
  .strict();
export const MessageSocialResponseSchema = z
  .object({ items: z.array(MessageSocialItemSchema) })
  .strict();
const Mutation = {
  roomId: IdentifierSchema,
  messageId: IdentifierSchema,
  idempotencyKey: z.string().min(1).max(200),
};
export const MessageReactionRequestSchema = z
  .object({
    ...Mutation,
    emoji: ReactionEmojiSchema,
    active: z.boolean(),
    basedOnRoomSeq: z.number().int().nonnegative(),
  })
  .strict();
export const MessageSaveRequestSchema = z
  .object({ ...Mutation, saved: z.boolean() })
  .strict();
export const SavedMessagesRequestSchema = z
  .object({
    workspaceId: IdentifierSchema,
    query: z.string().trim().max(300).optional(),
    channelId: IdentifierSchema.optional(),
    sortDirection: z.enum(["asc", "desc"]).default("desc"),
    cursor: z.string().max(2000).optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();
export const SavedMessagesResponseSchema = z
  .object({
    items: z.array(
      SearchHitSchema.extend({
        savedAt: TimestampSchema,
        roomKind: RoomKindSchema,
        sender: PrincipalSchema,
      }),
    ),
    total: z.number().int().nonnegative(),
    globalTotal: z.number().int().nonnegative(),
    nextCursor: z.string().optional(),
  })
  .strict();
export type MessageSocialItem = z.infer<typeof MessageSocialItemSchema>;
export type MessageSocialRequest = z.infer<typeof MessageSocialRequestSchema>;
export type MessageReactionRequest = z.infer<
  typeof MessageReactionRequestSchema
>;
export type MessageSaveRequest = z.infer<typeof MessageSaveRequestSchema>;
export type SavedMessagesRequest = z.input<typeof SavedMessagesRequestSchema>;

export const SidebarSortModeSchema = z.enum(["manual", "recent", "az"]);
const Keys = z
  .array(z.string().min(1).max(300))
  .max(2000)
  .refine(
    (keys) => new Set(keys).size === keys.length,
    "duplicate sidebar identity",
  );
export const SidebarPreferencesSchema = z
  .object({
    version: z.number().int().nonnegative(),
    pinned: Keys,
    channelOrder: Keys,
    dmOrder: Keys,
    // Raft channel settings are personal Human × Workspace preferences. Muting
    // suppresses ordinary Activity but never exact mentions.
    mutedActivity: Keys.default([]),
    // Raft server mute is a Human × Workspace Web Push preference. It does
    // not hide Activity and is independent from per-Room Activity mute.
    mutedWorkspace: z.boolean().default(false),
    // Raft's default push scope is intentionally narrow. RAH OS exposes an
    // explicit per-Room opt-in for ordinary top-level messages without making
    // that local-first enhancement the legacy/default behavior.
    notifyAllMessages: Keys.default([]),
    // Raft collapses long messages by default. This stores per-Room opt-outs,
    // which keeps legacy rows and newly discovered Rooms on the official default.
    expandedLongMessages: Keys.default([]),
    channelSortMode: SidebarSortModeSchema,
    dmSortMode: SidebarSortModeSchema,
    pinnedSortMode: SidebarSortModeSchema,
  })
  .strict();
export const SidebarGetRequestSchema = z
  .object({ workspaceId: IdentifierSchema })
  .strict();
export const SidebarPatchRequestSchema = SidebarGetRequestSchema.extend({
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(200),
  // Do not derive this from fields carrying response-migration defaults:
  // Zod applies an inner default even under `.partial()`, which would turn a
  // one-field patch into an accidental reset of every omitted defaulted field.
  patch: z
    .object({
      pinned: Keys,
      channelOrder: Keys,
      dmOrder: Keys,
      mutedActivity: Keys,
      mutedWorkspace: z.boolean(),
      notifyAllMessages: Keys,
      expandedLongMessages: Keys,
      channelSortMode: SidebarSortModeSchema,
      dmSortMode: SidebarSortModeSchema,
      pinnedSortMode: SidebarSortModeSchema,
    })
    .partial()
    .strict(),
}).strict();
export const SidebarResponseSchema = z
  .object({
    preferences: SidebarPreferencesSchema,
    recent: z.record(z.string(), z.string()),
  })
  .strict();
export type SidebarPreferences = z.infer<typeof SidebarPreferencesSchema>;
export type SidebarPatchRequest = z.infer<typeof SidebarPatchRequestSchema>;
export const DEFAULT_SIDEBAR_PREFERENCES: SidebarPreferences = {
  version: 0,
  pinned: [],
  channelOrder: [],
  dmOrder: [],
  mutedActivity: [],
  mutedWorkspace: false,
  notifyAllMessages: [],
  expandedLongMessages: [],
  channelSortMode: "manual",
  dmSortMode: "manual",
  pinnedSortMode: "manual",
};
