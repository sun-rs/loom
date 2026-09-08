import { IdentifierSchema } from "./common.ts";
import {
  WorkerTaskHistoryRequestSchema,
  WorkerTaskHistoryResponseSchema,
} from "./worker-read-tools.ts";
import type { z } from "zod";

export const ClientTaskHistoryRequestSchema =
  WorkerTaskHistoryRequestSchema.extend({ roomId: IdentifierSchema });
export const ClientTaskHistoryResponseSchema = WorkerTaskHistoryResponseSchema;
export type ClientTaskHistoryRequest = z.input<
  typeof ClientTaskHistoryRequestSchema
>;
export type ClientTaskHistoryResponse = z.infer<
  typeof ClientTaskHistoryResponseSchema
>;
