import { WorkerAddressingSchema } from "./worker-addressing.ts";
import { z } from "zod";

import { IdentifierSchema } from "./common.ts";
import {
  refineRoomSyncWindow,
  roomSyncResponseShape,
} from "./room-sync-response.ts";

/**
 * Ledger facts about what this participant was already shown at a target and
 * what it has already said there since. Worker-only: a Human client sync window
 * keeps its existing shape.
 *
 * `presentedThroughSeq` is deduplicated into `targets` because it is constant
 * per target; `alreadyPresented` and `respondedAfter` vary per delivered event
 * and are carried in a sidecar array keyed by `roomSeq`, so `RoomEventSchema`
 * — shared with every other reader of a Room event — is not changed.
 */
export const WorkerPresentedTargetSchema = z
  .object({
    roomId: IdentifierSchema,
    threadId: IdentifierSchema.optional(),
    presentedThroughSeq: z.number().int().positive(),
  })
  .strict();
export type WorkerPresentedTarget = z.infer<typeof WorkerPresentedTargetSchema>;

export const WorkerPresentedEventSchema = z
  .object({
    roomSeq: z.number().int().positive(),
    messageId: IdentifierSchema,
    threadId: IdentifierSchema.optional(),
    alreadyPresented: z.literal(true),
    presentedThroughSeq: z.number().int().positive(),
    respondedAfter: z
      .object({
        messageIds: z.array(IdentifierSchema).max(5),
        count: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type WorkerPresentedEvent = z.infer<typeof WorkerPresentedEventSchema>;

export const WorkerPresentedContextSchema = z
  .object({
    targets: z.array(WorkerPresentedTargetSchema),
    events: z.array(WorkerPresentedEventSchema),
  })
  .strict();
export type WorkerPresentedContext = z.infer<
  typeof WorkerPresentedContextSchema
>;

export const WorkerSyncResponseSchema = refineRoomSyncWindow(
  z
    .object({
      ...roomSyncResponseShape,
      addressing: WorkerAddressingSchema.optional(),
      presentedContext: WorkerPresentedContextSchema.optional(),
    })
    .strict(),
);
export type WorkerSyncResponse = z.infer<typeof WorkerSyncResponseSchema>;
