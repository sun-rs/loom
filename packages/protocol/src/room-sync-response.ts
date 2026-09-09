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

/**
 * The delivery window itself. Kept separate from the refinement chain so a
 * caller-specific response (the Worker one) can add its own strict fields
 * without loosening or duplicating the window invariants below.
 */
export const roomSyncResponseShape = {
  cursorBefore: z.number().int().nonnegative(),
  cursorAfter: z.number().int().nonnegative(),
  eventFloorSeq: z.number().int().nonnegative().optional(),
  latestRoomSeq: z.number().int().nonnegative(),
  snapshot: RoomSnapshotSchema.nullable(),
  snapshotSeq: z.number().int().nonnegative().optional(),
  events: z.array(RoomEventSchema),
};

type RoomSyncWindow = {
  cursorBefore: number;
  cursorAfter: number;
  eventFloorSeq?: number | undefined;
  latestRoomSeq: number;
  snapshot: unknown;
  snapshotSeq?: number | undefined;
};

export function refineRoomSyncWindow<Schema extends z.ZodType<RoomSyncWindow>>(
  schema: Schema,
): Schema {
  const refined = (schema as unknown as z.ZodType<RoomSyncWindow>)
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
  return refined as unknown as Schema;
}

export const RoomSyncResponseSchema = refineRoomSyncWindow(
  z.object(roomSyncResponseShape).strict(),
);
export type RoomSyncResponse = z.infer<typeof RoomSyncResponseSchema>;
