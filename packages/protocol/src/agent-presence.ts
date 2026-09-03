import { z } from "zod";
import { IdentifierSchema, TimestampSchema } from "./common.ts";
import { RuntimeTrajectoryActivitySchema } from "./runtime-activity.ts";

// Content-free observation, never Room/Task state or a telemetry transcript.
export const AgentPresenceSchema = z
  .object({
    agentDefinitionId: IdentifierSchema,
    activity: RuntimeTrajectoryActivitySchema,
    activityAt: TimestampSchema.optional(),
    reason: z.enum([
      "idle",
      "starting",
      "thinking",
      "working",
      "online",
      "error",
      "paused",
      "host_offline",
      "host_draining",
      "unknown",
    ]),
  })
  .strict();
export type AgentPresence = z.infer<typeof AgentPresenceSchema>;
export const ClientAgentPresenceListRequestSchema = z
  .object({ controlRoomId: IdentifierSchema })
  .strict();
export type ClientAgentPresenceListRequest = z.infer<
  typeof ClientAgentPresenceListRequestSchema
>;
export const ClientAgentPresenceListResponseSchema = z
  .object({
    agents: z.array(AgentPresenceSchema),
    observedAt: TimestampSchema,
  })
  .strict();
export type ClientAgentPresenceListResponse = z.infer<
  typeof ClientAgentPresenceListResponseSchema
>;
