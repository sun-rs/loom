import { z } from "zod";
import { IdentifierSchema } from "./common.ts";

export const ErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: IdentifierSchema,
        message: z.string().min(1),
      })
      .strict(),
  })
  .strict();
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const WorkerErrorResponseSchema = ErrorResponseSchema;
export type WorkerErrorResponse = ErrorResponse;

export const ClientErrorResponseSchema = ErrorResponseSchema;
export type ClientErrorResponse = z.infer<typeof ClientErrorResponseSchema>;
