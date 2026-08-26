import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";

export const RoomEventSchema = z
  .object({
    eventId: IdentifierSchema,
    roomId: IdentifierSchema,
    roomSeq: z.number().int().positive(),
    type: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
    actorId: IdentifierSchema,
    aggregateType: IdentifierSchema,
    aggregateId: IdentifierSchema,
    payload: z.record(z.string(), z.unknown()),
    idempotencyKey: IdentifierSchema,
    schemaVersion: z.number().int().positive(),
    createdAt: TimestampSchema,
  })
  .strict();
export type RoomEvent = z.infer<typeof RoomEventSchema>;
