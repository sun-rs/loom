import { z } from "zod";
import {
  AgentWorkspaceListRequestSchema,
  AgentWorkspaceListSchema,
  AgentWorkspaceFileSchema,
  AgentWorkspaceRootsSchema,
} from "./agent-workspace.ts";
export const ChannelWorkspaceReadRequestSchema =
  AgentWorkspaceListRequestSchema.omit({ agentId: true })
    .extend({
      roomId: z.string().min(1).max(256),
      operation: z.enum(["roots", "list", "read", "changes", "diff"]),
    })
    .strict();
export const ChannelWorkspaceReadResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("roots"), value: AgentWorkspaceRootsSchema })
    .strict(),
  z
    .object({ kind: z.literal("list"), value: AgentWorkspaceListSchema })
    .strict(),
  z
    .object({ kind: z.literal("read"), value: AgentWorkspaceFileSchema })
    .strict(),
  z
    .object({
      kind: z.literal("changes"),
      entries: z
        .array(
          z
            .object({ path: z.string().max(4096), status: z.string().max(2) })
            .strict(),
        )
        .max(500),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("diff"),
      text: z.string().max(524288),
      path: z.string().max(4096),
    })
    .strict(),
]);
export type ChannelWorkspaceReadRequest = z.infer<
  typeof ChannelWorkspaceReadRequestSchema
>;
export type ChannelWorkspaceReadResponse = z.infer<
  typeof ChannelWorkspaceReadResponseSchema
>;
