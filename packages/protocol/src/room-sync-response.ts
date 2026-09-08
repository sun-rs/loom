import { z } from "zod";
import { RoomSchema, PrincipalSchema } from "./collaboration.ts";
import { RoomEventSchema } from "./room-event.ts";

export const RoomSnapshotSchema = z
  .object({
    room: RoomSchema,
    members: z.array(PrincipalSchema),
  })
  .strict();
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;

export const RoomSyncResponseSchema = z
  .object({
    cursorBefore: z.number().int().nonnegative(),
    cursorAfter: z.number().int().nonnegative(),
    eventFloorSeq: z.number().int().nonnegative().optional(),
    latestRoomSeq: z.number().int().nonnegative(),
    snapshot: RoomSnapshotSchema.nullable(),
    snapshotSeq: z.number().int().nonnegative().optional(),
    events: z.array(RoomEventSchema),
  })
  .strict()
  .refine((response) => response.cursorBefore <= response.latestRoomSeq, {
    message: "cursorBefore must be less than or equal to latestRoomSeq",
    path: ["cursorBefore"],
  })
  .refine((response) => response.cursorAfter <= response.latestRoomSeq, {
    message: "cursorAfter must be less than or equal to latestRoomSeq",
    path: ["cursorAfter"],
  })
  .refine(
    (response) =>
      response.eventFloorSeq === undefined ||
      response.eventFloorSeq <= response.cursorAfter,
    {
      message: "eventFloorSeq must be less than or equal to cursorAfter",
      path: ["eventFloorSeq"],
    },
  )
  .refine(
    (response) =>
      response.snapshotSeq === undefined ||
      response.snapshotSeq <= response.latestRoomSeq,
    {
      message: "snapshotSeq must be less than or equal to latestRoomSeq",
      path: ["snapshotSeq"],
    },
  )
  .refine(
    (response) =>
      (response.eventFloorSeq === undefined) ===
      (response.snapshotSeq === undefined),
    {
      message: "bounded bootstrap metadata must be complete",
      path: ["eventFloorSeq"],
    },
  )
  .refine(
    (response) =>
      response.eventFloorSeq === undefined ||
      (response.snapshot !== null &&
        response.snapshotSeq === response.latestRoomSeq),
    {
      message: "bounded bootstrap requires a current Room snapshot",
      path: ["snapshot"],
    },
  );
export type RoomSyncResponse = z.infer<typeof RoomSyncResponseSchema>;
