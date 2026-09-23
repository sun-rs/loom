import { z } from "zod";
import { RuntimeGuideIdSchema } from "./runtime-guide-settings.ts";

const BindingIdentifierSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => value.trim().length > 0, "Empty binding identity")
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/u.test(value),
    "Invalid binding identity",
  );

/**
 * V1 contract for the proposed instance-based runtime binding. Not connected
 * to the legacy Agent session store or any public mutation route yet.
 * Mutable model/effort/profile settings deliberately do not identify a session.
 * Native IDs remain opaque; the host/runtime pair qualifies their namespace.
 */
export const InstanceSessionBindingSchema = z
  .object({
    schemaVersion: z.literal(1),
    instanceId: BindingIdentifierSchema,
    channelId: BindingIdentifierSchema,
    roleId: BindingIdentifierSchema,
    roleRevisionId: BindingIdentifierSchema,
    hostId: BindingIdentifierSchema,
    runtimeId: RuntimeGuideIdSchema,
    providerSessionId: BindingIdentifierSchema,
    bindingEpoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .readonly();

export type InstanceSessionBinding = z.infer<
  typeof InstanceSessionBindingSchema
>;
