import { z } from "zod";
import { IdentifierSchema, TimestampSchema } from "./common.ts";
import { MessageSchema } from "./collaboration.ts";

/** Presentation projection of durable events; never a canonical chat Message. */
export const RoomTimelineNoticeSchema = z
  .object({
    eventId: IdentifierSchema,
    roomId: IdentifierSchema,
    roomSeq: z.number().int().positive(),
    createdAt: TimestampSchema,
    type: z.enum(["membership.added", "room.unarchived", "reminder.fired"]),
    text: z.string(),
  })
  .strict();
export const RoomTimelineItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), message: MessageSchema }).strict(),
  z
    .object({ kind: z.literal("notice"), notice: RoomTimelineNoticeSchema })
    .strict(),
]);
export type RoomTimelineItem = z.infer<typeof RoomTimelineItemSchema>;
export const ClientRoomTimelineRequestSchema = z
  .object({
    roomId: IdentifierSchema,
    afterSeq: z.number().int().nonnegative().optional(),
    beforeSeq: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(500).default(50),
  })
  .strict()
  .refine(
    ({ afterSeq, beforeSeq }) =>
      afterSeq === undefined || beforeSeq === undefined,
    { message: "timeline accepts either afterSeq or beforeSeq" },
  );
export const ClientRoomTimelineResponseSchema = z
  .object({
    items: z.array(RoomTimelineItemSchema),
    cursorBefore: z.number().int().nonnegative(),
    cursorAfter: z.number().int().nonnegative(),
    hasMoreBefore: z.boolean(),
    hasMoreAfter: z.boolean(),
  })
  .strict();
export type ClientRoomTimelineRequest = z.infer<
  typeof ClientRoomTimelineRequestSchema
>;
export type ClientRoomTimelineResponse = z.infer<
  typeof ClientRoomTimelineResponseSchema
>;
