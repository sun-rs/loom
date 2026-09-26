import { z } from "zod";

export const RuntimeGuideIdSchema = z.enum([
  "codex",
  "claude",
  "kimi",
  "opencode",
]);
export const RuntimeLaunchEnvironmentSchema = z
  .record(
    z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)
      .max(128),
    z
      .string()
      .max(8192)
      .refine((value) => !value.includes("\0"), "Invalid environment value"),
  )
  .superRefine((env, ctx) => {
    if (Object.keys(env).length > 64 || JSON.stringify(env).length > 16384)
      ctx.addIssue({
        code: "custom",
        message: "Environment exceeds 16 KiB / 64 variables",
      });
    for (const key of Object.keys(env))
      if (
        /^(?:RAH_|LOOM_|NODE_OPTIONS$|NODE_PATH$|PATH$|HOME$|USER$|SHELL$|LD_|DYLD_|KIMI_MODEL_THINKING_EFFORT$|CLAUDE_CODE_DISABLE_AUTO_MEMORY$|OPENCODE_PERMISSION$|KIMI_DISABLE_CRON$|KIMI_CODE_EXPERIMENTAL_WAIT_FOR$)/u.test(
          key,
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "RAH managed environment key is protected: " + key,
          path: [key],
        });
  });
export const RuntimeGuideReadSchema = z
  .object({ agentId: z.string().min(1).max(200).optional() })
  .strict();
export type RuntimeGuideRead = z.infer<typeof RuntimeGuideReadSchema>;
export const RuntimeGuideUpdateSchema = z
  .object({
    runtimeId: RuntimeGuideIdSchema,
    agentId: z.string().min(1).max(200).optional(),
    environment: RuntimeLaunchEnvironmentSchema.optional(),
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
      value.environment !== undefined ||
      value.enabled !== undefined ||
      value.additionalArgs !== undefined ||
      value.overrideArgs !== undefined,
    "A setting change is required",
  )
  .refine(
    (value) =>
      !(value.additionalArgs !== undefined && value.overrideArgs !== undefined),
    "Use override or legacy additions, not both",
  )
  .refine(
    (value) =>
      !value.agentId ||
      (value.enabled === undefined && value.overrideArgs === undefined),
    "Agent settings cannot change global Guide or managed launch arguments",
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
          environment: z.record(z.string(), z.string()).default({}),
          inheritedArgs: z.array(z.string()).default([]),
          inheritedEnvironment: z.record(z.string(), z.string()).default({}),
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
