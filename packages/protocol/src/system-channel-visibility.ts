import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
import { RoomEventSchema } from "./room-event.ts";
export const SystemChannelVisibilityReadSchema = z
  .object({ workspaceId: IdentifierSchema })
  .strict();
export const SystemChannelVisibilityUpdateSchema =
  SystemChannelVisibilityReadSchema.extend({
    hidden: z.boolean(),
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
  });
export const SystemChannelVisibilityResponseSchema = z
  .object({ hidden: z.boolean() })
  .strict();
export const SystemChannelVisibilityMutationSchema =
  SystemChannelVisibilityResponseSchema.extend({
    event: RoomEventSchema,
    deduplicated: z.boolean(),
  });
export type SystemChannelVisibilityRead = z.infer<
  typeof SystemChannelVisibilityReadSchema
>;
export type SystemChannelVisibilityUpdate = z.infer<
  typeof SystemChannelVisibilityUpdateSchema
>;
export type SystemChannelVisibilityResponse = z.infer<
  typeof SystemChannelVisibilityResponseSchema
>;
export type SystemChannelVisibilityMutation = z.infer<
  typeof SystemChannelVisibilityMutationSchema
>;
