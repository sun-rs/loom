import { z } from "zod";
import { IdentifierSchema, TimestampSchema } from "./common.ts";
import { ClientAgentProvisionRequestSchema } from "./agent-provision-request.ts";
import { AgentCatalogEntrySchema } from "./agent-definition.ts";
import { RoomEventSchema } from "./room-event.ts";

export const RoleConfigurationSchema = ClientAgentProvisionRequestSchema.omit({
  controlRoomId: true,
  basedOnRoomSeq: true,
  idempotencyKey: true,
});
export const RoleTemplateSchema = z
  .object({
    roleId: IdentifierSchema,
    roleRevisionId: IdentifierSchema,
    controlRoomId: IdentifierSchema,
    configuration: RoleConfigurationSchema,
    createdAt: TimestampSchema,
  })
  .strict();
export const RoleCreateRequestSchema = z
  .object({
    controlRoomId: IdentifierSchema,
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    configuration: RoleConfigurationSchema,
  })
  .strict();
export const RoleCreateResponseSchema = z
  .object({
    role: RoleTemplateSchema,
    event: RoomEventSchema,
    deduplicated: z.boolean(),
  })
  .strict();
export const RoleListRequestSchema = z
  .object({ controlRoomId: IdentifierSchema })
  .strict();
export const RoleInstanceSchema = z
  .object({
    instanceId: IdentifierSchema,
    agentId: IdentifierSchema,
    roleId: IdentifierSchema,
    roleRevisionId: IdentifierSchema,
    channelId: IdentifierSchema,
  })
  .strict();
export const RoleListResponseSchema = z
  .object({
    roles: z.array(RoleTemplateSchema),
    instances: z.array(
      RoleInstanceSchema.extend({
        isCurrent: z.boolean(),
        /**
         * Contract §5: native compactions observed in the instance's current
         * session (since its last Human reset), summed over its RunAttempts'
         * `compaction_finished` trajectory facts. `null`: no run of this
         * session recorded any trajectory, so unknown (never zero).
         */
        sessionCompactionCount: z.number().int().nonnegative().nullable(),
      }),
    ),
  })
  .strict();
export const RoleReviseRequestSchema = RoleCreateRequestSchema.omit({
  controlRoomId: true,
})
  .extend({
    roleId: IdentifierSchema,
    expectedRoleRevisionId: IdentifierSchema,
  })
  .strict();
export type RoleReviseRequest = z.infer<typeof RoleReviseRequestSchema>;
export const RoleInstantiateRequestSchema = z
  .object({
    roleId: IdentifierSchema,
    channelId: IdentifierSchema,
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export const RoleInstantiateResponseSchema = z
  .object({
    instance: RoleInstanceSchema,
    agent: AgentCatalogEntrySchema,
    event: RoomEventSchema,
    deduplicated: z.boolean(),
  })
  .strict();
export type RoleTemplate = z.infer<typeof RoleTemplateSchema>;
export type RoleCreateRequest = z.infer<typeof RoleCreateRequestSchema>;
export type RoleInstantiateRequest = z.infer<
  typeof RoleInstantiateRequestSchema
>;

export type RoleCreateResponse = z.infer<typeof RoleCreateResponseSchema>;

export type RoleListRequest = z.infer<typeof RoleListRequestSchema>;

export type RoleListResponse = z.infer<typeof RoleListResponseSchema>;

export type RoleInstantiateResponse = z.infer<
  typeof RoleInstantiateResponseSchema
>;

/** Host-authenticated: the Host persisted this instance's native session binding. */
export const InstanceSessionBindingRecordInputSchema = z
  .object({
    runAttemptId: IdentifierSchema,
    runtimeRunId: IdentifierSchema,
  })
  .strict();
export type InstanceSessionBindingRecordInput = z.infer<
  typeof InstanceSessionBindingRecordInputSchema
>;

/**
 * Human recovery exit: the next run of this instance starts a new native
 * session. The reset is explicit and recorded in the instance's channel.
 */
export const InstanceSessionResetRequestSchema = z
  .object({
    instanceId: IdentifierSchema,
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export const InstanceSessionResetResponseSchema = z
  .object({
    instanceId: IdentifierSchema,
    channelId: IdentifierSchema,
    sessionGeneration: z.number().int().positive(),
    event: RoomEventSchema,
    deduplicated: z.boolean(),
  })
  .strict();
export type InstanceSessionResetRequest = z.infer<
  typeof InstanceSessionResetRequestSchema
>;
export type InstanceSessionResetResponse = z.infer<
  typeof InstanceSessionResetResponseSchema
>;

/**
 * D2-2 Human recovery exit: abandon one Activation of a Role instance that a
 * blocked retry fence stopped (for example an assigned Task the instance never
 * submitted, or a repeated Runtime failure). The Activation is cancelled and
 * its fence resolved, releasing the lane; history, finished RunAttempts and
 * Tasks are kept unchanged. Recorded in the instance's channel.
 */
export const InstanceActivationAbandonRequestSchema = z
  .object({
    instanceId: IdentifierSchema,
    activationId: IdentifierSchema,
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export const InstanceActivationAbandonResponseSchema = z
  .object({
    instanceId: IdentifierSchema,
    channelId: IdentifierSchema,
    activationId: IdentifierSchema,
    event: RoomEventSchema,
    deduplicated: z.boolean(),
  })
  .strict();
export type InstanceActivationAbandonRequest = z.infer<
  typeof InstanceActivationAbandonRequestSchema
>;
export type InstanceActivationAbandonResponse = z.infer<
  typeof InstanceActivationAbandonResponseSchema
>;
