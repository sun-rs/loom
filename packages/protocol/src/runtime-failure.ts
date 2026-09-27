import { z } from "zod";

export const RuntimeRetryDispositionSchema = z.enum([
  "recoverable",
  "action_required",
  "sticky_terminal",
]);
export type RuntimeRetryDisposition = z.infer<
  typeof RuntimeRetryDispositionSchema
>;

export const RuntimeFailureSchema = z
  .object({
    actionRequired: z.boolean(),
    errorClass: z.enum([
      "AuthError",
      "InputTooLargeError",
      "ModelConfigError",
      "NotFoundError",
      "ProviderApiError",
      "ProviderConnectionError",
      "ProviderServerError",
      "ProviderStreamError",
      "RateLimitError",
      "RuntimeError",
      "TimeoutError",
    ]),
    message: z.string().trim().min(1).max(8_192),
    retryDisposition: RuntimeRetryDispositionSchema,
    sticky: z.boolean(),
  })
  .strict();
export type RuntimeFailure = z.infer<typeof RuntimeFailureSchema>;

/**
 * Carried in the Kernel's completion refusal when an Activation's business
 * obligation (an unsubmitted Task it was assigned before its head, an owner
 * follow-up or a review) is unmet. It is not a Runtime failure: a new process
 * cannot clear it, so its retry fence never holds the participant's lane and
 * the Host does not blindly re-execute a turn whose final reply committed.
 */
export const BUSINESS_OBLIGATION_UNMET_MARKER = "RAH_BUSINESS_OBLIGATION_UNMET";
