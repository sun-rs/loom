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
    instances: z.array(RoleInstanceSchema.extend({ isCurrent: z.boolean() })),
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
