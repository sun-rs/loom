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
    enabled: z.boolean(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
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
        })
        .strict(),
    ),
  })
  .strict();
export type RuntimeGuideSettingsView = z.infer<
  typeof RuntimeGuideSettingsSchema
>;
export type RuntimeGuideUpdate = z.infer<typeof RuntimeGuideUpdateSchema>;
