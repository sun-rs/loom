import { z } from "zod";

export const RuntimeGuideIdSchema = z.enum([
  "codex",
  "claude",
  "kimi",
  "opencode",
]);
export const RuntimeGuideReadSchema = z.object({}).strict();
export const RuntimeGuideUpdateSchema = z
  .object({
    runtimeId: RuntimeGuideIdSchema,
    enabled: z.boolean().optional(),
    additionalArgs: z.array(z.string().min(1).max(2048)).max(64).optional(),
    overrideArgs: z
      .array(z.string().min(1).max(2048))
      .max(64)
      .nullable()
      .optional(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (value) =>
      value.enabled !== undefined ||
      value.additionalArgs !== undefined ||
      value.overrideArgs !== undefined,
    "A setting change is required",
  )
  .refine(
    (value) =>
      !(value.additionalArgs !== undefined && value.overrideArgs !== undefined),
    "Use override or legacy additions, not both",
  );
export const RuntimeGuideSettingsSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    runtimes: z.array(
      z
        .object({
          runtimeId: RuntimeGuideIdSchema,
          enabled: z.boolean(),
          supported: z.boolean(),
          detail: z.string(),
          additionalArgs: z.array(z.string()).default([]),
          managedLaunch: z
            .object({
              args: z.array(z.string()),
              environment: z.record(z.string(), z.string()),
            })
            .default({ args: [], environment: {} }),
          requiredArgs: z.array(z.string()).default([]),
          defaultArgs: z.array(z.string()).default([]),
          effectiveArgs: z.array(z.string()).default([]),
          overrideArgs: z.array(z.string()).nullable().default(null),
        })
        .strict(),
    ),
  })
  .strict();
export type RuntimeGuideSettingsView = z.infer<
  typeof RuntimeGuideSettingsSchema
>;
export type RuntimeGuideUpdate = z.infer<typeof RuntimeGuideUpdateSchema>;
