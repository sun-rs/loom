import { z } from "zod";

import { IdentifierSchema } from "./common.ts";

/**
 * Raft has neither `--based-on-room-seq` nor `--idempotency-key` on any Task
 * command: the read position is resolved inside the tool from the CLI's own
 * local state (`getConsumedSeq`), and `idempotencyKey` is optional in
 * `packages/shared/src/agentApiContract.ts`. RAH therefore accepts the minimal
 * form on every Task command and derives both values server-side.
 *
 * An explicitly presented value stays valid byte-for-byte and stays fenced:
 * a presented cursor must still have been delivered to this credential, and a
 * presented key still owns the deduplication decision.
 */
export const WorkerTaskCausalityShape = {
  basedOnRoomSeq: z.number().int().nonnegative().optional(),
  idempotencyKey: IdentifierSchema.optional(),
};

/** The same two fields once the server has resolved them for the Kernel. */
export const ResolvedWorkerTaskCausalityShape = {
  basedOnRoomSeq: z.number().int().nonnegative(),
  idempotencyKey: IdentifierSchema,
};
