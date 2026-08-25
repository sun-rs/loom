import { isAbsolute } from "node:path";

import { z } from "zod";

const AbsolutePathSchema = z
  .string()
  .min(1)
  .refine(isAbsolute, "path must be absolute");

export const HostCredentialReferenceSchema = z
  .object({
    path: AbsolutePathSchema,
    source: z.literal("file"),
  })
  .strict();
export type HostCredentialReference = z.infer<
  typeof HostCredentialReferenceSchema
>;

export const DaemonConfigSchema = z
  .object({
    client: z
      .object({
        bindHost: z.literal("127.0.0.1"),
        port: z.number().int().nonnegative().max(65_535),
      })
      .strict(),
    drainTimeoutMs: z.number().int().positive(),
    host: z
      .object({
        credential: HostCredentialReferenceSchema,
        hostId: z.string().min(1),
        participantId: z.string().min(1),
      })
      .strict(),
    hostStaleAfterMs: z.number().int().positive(),
    leaseMs: z.number().int().positive(),
    leaseRenewIntervalMs: z.number().int().positive().optional(),
    lockDirectory: AbsolutePathSchema.optional(),
    outboxLeaseMs: z.number().int().positive(),
    outboxPollIntervalMs: z.number().int().positive(),
    outboxRetryAfterMs: z.number().int().nonnegative(),
    pollIntervalMs: z.number().int().positive(),
    retryAfterMs: z.number().int().nonnegative().optional(),
    runTimeoutMs: z.number().int().positive(),
    runtimeCancelTimeoutMs: z.number().int().positive(),
    runtimeRecoveryTimeoutMs: z.number().int().positive(),
    runtimeStartTimeoutMs: z.number().int().positive(),
    taskClaimHeartbeatIntervalMs: z.number().int().positive().optional(),
    taskClaimLeaseMs: z.number().int().positive().optional(),
    runtime: z
      .object({
        args: z.array(z.string()),
        command: z.string().min(1),
        cwd: AbsolutePathSchema,
        diagnosticByteLimit: z.number().int().positive().optional(),
        env: z.record(z.string(), z.string()),
        kind: z.literal("generic-process"),
        supervisorControlTimeoutMs: z.number().int().positive().optional(),
        supervisorStartupTimeoutMs: z.number().int().positive().optional(),
        terminationGraceMs: z.number().int().nonnegative().optional(),
      })
      .strict(),
    schemaVersion: z.literal(2),
    stateDirectory: AbsolutePathSchema,
  })
  .strict()
  .superRefine((config, context) => {
    if (
      config.leaseRenewIntervalMs !== undefined &&
      config.leaseRenewIntervalMs >= config.leaseMs
    ) {
      context.addIssue({
        code: "custom",
        message: "leaseRenewIntervalMs must be less than leaseMs",
        path: ["leaseRenewIntervalMs"],
      });
    }
    if (
      config.taskClaimHeartbeatIntervalMs !== undefined &&
      config.taskClaimLeaseMs !== undefined &&
      config.taskClaimHeartbeatIntervalMs >= config.taskClaimLeaseMs
    ) {
      context.addIssue({
        code: "custom",
        message:
          "taskClaimHeartbeatIntervalMs must be less than taskClaimLeaseMs",
        path: ["taskClaimHeartbeatIntervalMs"],
      });
    }
  });

export type DaemonConfig = z.infer<typeof DaemonConfigSchema>;
