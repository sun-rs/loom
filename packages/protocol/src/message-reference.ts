import { z } from "zod";

import { IdentifierSchema } from "./common.ts";
import { RoomKindSchema } from "./collaboration.ts";

const ReferenceValueSchema = z.string().min(1).max(2_000);

export const MessageReferenceReadStateSchema = z.enum(["read", "unread"]);
export type MessageReferenceReadState = z.infer<
  typeof MessageReferenceReadStateSchema
>;

export const ClientMessageReferenceReadStatesRequestSchema = z
  .object({
    messageIds: z.array(IdentifierSchema).min(1).max(200),
    roomId: IdentifierSchema,
  })
  .strict()
  .refine(({ messageIds }) => new Set(messageIds).size === messageIds.length, {
    message: "messageIds must be unique",
    path: ["messageIds"],
  });
export type ClientMessageReferenceReadStatesRequest = z.infer<
  typeof ClientMessageReferenceReadStatesRequestSchema
>;

export const MessageReferenceReadStateRecordSchema = z
  .object({
    messageId: IdentifierSchema,
    principalId: IdentifierSchema,
    readState: MessageReferenceReadStateSchema,
  })
  .strict();
export type MessageReferenceReadStateRecord = z.infer<
  typeof MessageReferenceReadStateRecordSchema
>;

export const ClientMessageReferenceReadStatesResponseSchema = z
  .object({
    readStates: z.array(MessageReferenceReadStateRecordSchema),
  })
  .strict();
export type ClientMessageReferenceReadStatesResponse = z.infer<
  typeof ClientMessageReferenceReadStatesResponseSchema
>;

const PrincipalReferenceCommon = {
  principalId: IdentifierSchema,
  readState: MessageReferenceReadStateSchema.optional(),
  self: z.boolean(),
  value: ReferenceValueSchema,
};

export const MessageAgentReferenceSchema = z
  .object({
    ...PrincipalReferenceCommon,
    agentDefinitionId: IdentifierSchema,
    kind: z.literal("agent"),
  })
  .strict();

export const MessageHumanReferenceSchema = z
  .object({
    ...PrincipalReferenceCommon,
    directRoomId: IdentifierSchema.optional(),
    kind: z.literal("human"),
  })
  .strict();

export const MessageRoomReferenceSchema = z
  .object({
    kind: z.literal("room"),
    roomId: IdentifierSchema,
    roomKind: RoomKindSchema,
    value: ReferenceValueSchema,
  })
  .strict();

export const MessageThreadReferenceSchema = z
  .object({
    kind: z.literal("thread"),
    roomId: IdentifierSchema,
    roomKind: RoomKindSchema,
    rootMessageId: IdentifierSchema,
    threadId: IdentifierSchema,
    value: ReferenceValueSchema,
  })
  .strict();

export const MessageTaskReferenceSchema = z
  .object({
    kind: z.literal("task"),
    roomId: IdentifierSchema,
    rootMessageId: IdentifierSchema,
    taskId: IdentifierSchema,
    taskNumber: z.number().int().positive(),
    threadId: IdentifierSchema,
    value: ReferenceValueSchema,
  })
  .strict();

export const MessageComputerReferenceSchema = z
  .object({
    hostId: IdentifierSchema,
    kind: z.literal("computer"),
    value: ReferenceValueSchema,
  })
  .strict();

export const MessageAppReferenceSchema = z
  .object({
    appId: z
      .string()
      .trim()
      .min(3)
      .max(300)
      .regex(/^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)+$/iu),
    kind: z.literal("app"),
    value: ReferenceValueSchema,
  })
  .strict();

export const MessagePermalinkReferenceSchema = z
  .object({
    kind: z.literal("message"),
    messageId: IdentifierSchema,
    roomId: IdentifierSchema,
    roomKind: RoomKindSchema,
    rootMessageId: IdentifierSchema.optional(),
    threadId: IdentifierSchema.optional(),
    value: ReferenceValueSchema,
  })
  .strict()
  .refine(
    ({ rootMessageId, threadId }) =>
      (rootMessageId === undefined) === (threadId === undefined),
    "message thread identity requires both threadId and rootMessageId",
  );

/**
 * A display reference with canonical identity. Message.body remains the original
 * Markdown; clients may derive these values but must never route from label text.
 */
export const MessageReferenceSchema = z.discriminatedUnion("kind", [
  MessageAgentReferenceSchema,
  MessageHumanReferenceSchema,
  MessageRoomReferenceSchema,
  MessageThreadReferenceSchema,
  MessageTaskReferenceSchema,
  MessageComputerReferenceSchema,
  MessageAppReferenceSchema,
  MessagePermalinkReferenceSchema,
]);
export type MessageReference = z.infer<typeof MessageReferenceSchema>;
