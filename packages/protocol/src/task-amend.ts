import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
import {
  ResolvedWorkerTaskCausalityShape,
  WorkerTaskCausalityShape,
} from "./worker-task-causality.ts";
// Raft computer 1.0.18 agentApiTaskAmendBodySchema: title trims; description is exact and nullable.
const TaskAmendFieldsShape = {
  taskId: IdentifierSchema,
  title: z.string().trim().min(1).max(10_000).optional(),
  description: z.string().max(50_000).nullable().optional(),
};
const requireOneAmendedField = [
  (value: { title?: unknown; description?: unknown }) =>
    value.title !== undefined || value.description !== undefined,
  { message: "At least one of title or description is required" },
] as const;
export const TaskAmendRequestSchema = z
  .object({ ...TaskAmendFieldsShape, ...ResolvedWorkerTaskCausalityShape })
  .strict()
  .refine(...requireOneAmendedField);
export type TaskAmendRequest = z.infer<typeof TaskAmendRequestSchema>;
/** The Agent-facing form: Raft's `task amend` carries neither causal field. */
export const WorkerTaskAmendRequestSchema = z
  .object({ ...TaskAmendFieldsShape, ...WorkerTaskCausalityShape })
  .strict()
  .refine(...requireOneAmendedField);
export type WorkerTaskAmendRequest = z.infer<
  typeof WorkerTaskAmendRequestSchema
>;
// Public card fields only, as consumed by Raft TaskModalHead's amended changes[field].from/to.
export const TaskAmendChangesSchema = z
  .object({
    title: z.object({ from: z.string(), to: z.string() }).strict().optional(),
    description: z
      .object({ from: z.string().nullable(), to: z.string().nullable() })
      .strict()
      .optional(),
  })
  .strict();
// 2 * (10k title + 50k description) * 6 worst-case JSON bytes, plus envelope < 1 MiB.
export const TASK_HISTORY_ROW_MAX_BYTES = 1024 * 1024;
export const TASK_HISTORY_PAGE_MAX_BYTES = 2 * 1024 * 1024 - 16 * 1024;
export const TASK_CARD_TRANSPORT_MAX_BYTES = 2 * 1024 * 1024;
export type TaskAmendChanges = z.infer<typeof TaskAmendChangesSchema>;
