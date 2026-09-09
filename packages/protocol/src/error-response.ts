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

/**
 * Raft's failure body carries a typed recovery instruction next to the code:
 * the CLI transport reads `body.suggestedNextAction ?? body.suggested_next_action`
 * (`main.js@32524008`) and `apiFailureError` prefers it over any CLI-local
 * fallback (`main.js@29998456`). RAH's Worker failure body gains the same
 * optional field so a server that knows the situation can say which command
 * recovers from it. It is optional on purpose: a client built before this
 * field still parses every body, and a body without it renders no
 * `Next action:` line at all.
 */
export const WorkerErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: IdentifierSchema,
        message: z.string().min(1),
        suggestedNextAction: z.string().min(1).max(4_000).optional(),
      })
      .strict(),
  })
  .strict();
export type WorkerErrorResponse = z.infer<typeof WorkerErrorResponseSchema>;

/**
 * Raft's `mapResolveError` attaches this to a `message resolve` that resolved
 * nothing (`main.js@30190674`), with Raft's command names replaced by RAH's own
 * spelling of the same two commands. It states which command to run; it does
 * not weigh whether to run it.
 */
export const WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION =
  "Use rah worker message-search to find the message, or rah worker message-read --around only when you want nearby context rather than proof that this id exists.";

export const ClientErrorResponseSchema = ErrorResponseSchema;
export type ClientErrorResponse = z.infer<typeof ClientErrorResponseSchema>;
