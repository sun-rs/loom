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
