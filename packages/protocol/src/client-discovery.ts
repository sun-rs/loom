import { z } from "zod";
import { IdentifierSchema, TimestampSchema } from "./common.ts";
import { MessageSchema, PrincipalSchema, RoomSchema } from "./collaboration.ts";
import { TaskSchema } from "./task.ts";

const Page = {
  cursor: z.string().max(2000).optional(),
  limit: z.number().int().min(1).max(100).optional(),
};
const Ids = z.array(IdentifierSchema).max(50).optional();
export const GlobalTasksRequestSchema = z
  .object({
    ...Page,
    workspaceId: IdentifierSchema,
    roomIds: Ids,
    creatorIds: Ids,
    assigneeIds: Ids,
    unassigned: z.boolean().optional(),
  })
  .strict();
export const GlobalTaskSchema = z
  .object({ task: TaskSchema, roomName: z.string() })
  .strict();
export const GlobalTasksResponseSchema = z
  .object({
    tasks: z.array(GlobalTaskSchema),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().optional(),
  })
  .strict();
export type GlobalTasksRequest = z.infer<typeof GlobalTasksRequestSchema>;
export type GlobalTasksResponse = z.infer<typeof GlobalTasksResponseSchema>;

export const WorkspaceSearchRequestSchema = z
  .object({
    ...Page,
    workspaceId: IdentifierSchema,
    query: z.string().trim().max(300),
    roomIds: Ids,
    senderIds: Ids,
    senderKind: z.enum(["human", "agent"]).optional(),
    mentionSelf: z.boolean().optional(),
    scope: z.enum(["all", "channel", "direct", "thread"]).optional(),
    after: TimestampSchema.optional(),
    before: TimestampSchema.optional(),
    sort: z.enum(["recent", "relevance"]).optional(),
  })
  .strict();
export const SearchHitSchema = z
  .object({
    message: MessageSchema,
    roomName: z.string(),
    senderName: z.string(),
    rootMessageId: IdentifierSchema.optional(),
  })
  .strict();
export const WorkspaceSearchResponseSchema = z
  .object({
    hits: z.array(SearchHitSchema),
    rooms: z.array(RoomSchema),
    principals: z.array(PrincipalSchema),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().optional(),
  })
  .strict();
export type WorkspaceSearchRequest = z.infer<
  typeof WorkspaceSearchRequestSchema
>;
export type WorkspaceSearchResponse = z.infer<
  typeof WorkspaceSearchResponseSchema
>;
export const MessageContextRequestSchema = z
  .object({ messageId: IdentifierSchema, roomId: IdentifierSchema.optional() })
  .strict();
export const MessageContextResponseSchema = z
  .object({
    message: MessageSchema,
    messages: z.array(MessageSchema),
    rootMessageId: IdentifierSchema.optional(),
    rootMessage: MessageSchema.optional(),
  })
  .strict();
export type MessageContextRequest = z.infer<typeof MessageContextRequestSchema>;
export type MessageContextResponse = z.infer<
  typeof MessageContextResponseSchema
>;

export const HumanActivityRequestSchema = z
  .object({
    ...Page,
    workspaceId: IdentifierSchema,
    filter: z.enum(["all", "unread", "mentions"]).optional(),
  })
  .strict();
export const HumanActivityItemSchema = z
  .object({
    key: z.string(),
    roomId: IdentifierSchema,
    roomName: z.string(),
    kind: z.enum(["channel", "direct", "thread"]),
    threadId: IdentifierSchema.optional(),
    rootMessageId: IdentifierSchema.optional(),
    title: z.string(),
    latestMessage: MessageSchema,
    senderName: z.string(),
    latestSeq: z.number().int().positive(),
    unreadCount: z.number().int().nonnegative(),
    hasMention: z.boolean(),
    replyCount: z.number().int().nonnegative(),
    task: TaskSchema.optional(),
  })
  .strict();
export const HumanActivityResponseSchema = z
  .object({
    items: z.array(HumanActivityItemSchema),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().optional(),
    summary: z
      .object({
        unreadActivityCount: z.number().int().nonnegative(),
        rooms: z.array(
          z
            .object({
              roomId: IdentifierSchema,
              unreadCount: z.number().int().nonnegative(),
              hasMention: z.boolean(),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
  })
  .strict();
export const HumanActivityMarkRequestSchema = z
  .object({
    roomId: IdentifierSchema,
    threadId: IdentifierSchema.optional(),
    throughSeq: z.number().int().nonnegative(),
    action: z.enum(["read", "done"]),
  })
  .strict();
export const HumanActivityMarkResponseSchema = z
  .object({
    readThroughSeq: z.number().int().nonnegative(),
    doneThroughSeq: z.number().int().nonnegative(),
  })
  .strict();
export const HumanThreadFollowRequestSchema = z
  .object({
    roomId: IdentifierSchema,
    threadId: IdentifierSchema,
    following: z.boolean(),
  })
  .strict();
export const HumanThreadFollowResponseSchema = z
  .object({ following: z.boolean() })
  .strict();
export type HumanActivityRequest = z.infer<typeof HumanActivityRequestSchema>;
export type HumanActivityResponse = z.infer<typeof HumanActivityResponseSchema>;
export type HumanActivityItem = z.infer<typeof HumanActivityItemSchema>;
export type HumanActivityMarkRequest = z.infer<
  typeof HumanActivityMarkRequestSchema
>;
export type HumanThreadFollowRequest = z.infer<
  typeof HumanThreadFollowRequestSchema
>;
