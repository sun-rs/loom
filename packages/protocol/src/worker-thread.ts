import { z } from "zod";

import { IdentifierSchema } from "./common.ts";
import { RoomEventSchema } from "./room-event.ts";

/**
 * Raft's `raft thread unfollow --target '#channel:abcd1234' [--reason TEXT]`:
 * the Thread is addressed the way the Human reads it, the optional reason is
 * shown in the Thread-local unfollow notice
 * (`agentApiThreadUnfollowBodySchema = { thread, reason }`), and no causal
 * parameter is carried. RAH accepts that form, keeps `--thread-id` because the
 * canonical Thread id is what its Kernel and its Human client already address,
 * and derives both causal parameters when they are omitted.
 */
export const WorkerThreadUnfollowRequestSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative().optional(),
    channel: z.string().trim().min(1).max(500).optional(),
    idempotencyKey: IdentifierSchema.optional(),
    reason: z.string().trim().min(1).max(200).optional(),
    threadId: IdentifierSchema.optional(),
  })
  .strict()
  .refine(
    (input) => input.threadId !== undefined || input.channel !== undefined,
    "address the Thread with --target '#channel:threadId' or with --thread-id",
  );
export type WorkerThreadUnfollowRequest = z.infer<
  typeof WorkerThreadUnfollowRequestSchema
>;
/** The same command once the server has resolved the Thread and its causality. */
export type ResolvedWorkerThreadUnfollow = {
  basedOnRoomSeq: number;
  idempotencyKey: string;
  reason?: string | undefined;
  threadId: string;
};

export const WorkerThreadUnfollowResponseSchema = z
  .object({
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    following: z.literal(false),
    threadId: IdentifierSchema,
  })
  .strict();
export type WorkerThreadUnfollowResponse = z.infer<
  typeof WorkerThreadUnfollowResponseSchema
>;
