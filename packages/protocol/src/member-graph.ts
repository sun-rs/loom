import { z } from "zod";

import { IdentifierSchema } from "./common.ts";

const MemberGraphChannelIdListSchema = z
  .array(IdentifierSchema)
  .max(500)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "channelIds must be unique",
  });

export const MemberGraphHumanSchema = z
  .object({
    avatarKey: z
      .string()
      .regex(/^[a-z0-9_-]{1,64}$/)
      .optional(),
    channelIds: MemberGraphChannelIdListSchema,
    displayName: z.string().trim().min(1).max(120),
    handle: IdentifierSchema,
    id: IdentifierSchema,
    principalId: IdentifierSchema,
    type: z.literal("human"),
  })
  .strict()
  .refine((member) => member.id === member.principalId, {
    message: "Human id must equal principalId",
    path: ["id"],
  });
export type MemberGraphHuman = z.infer<typeof MemberGraphHumanSchema>;

export const MemberGraphAgentSchema = z
  .object({
    agentDefinitionId: IdentifierSchema,
    avatarKey: z
      .string()
      .regex(/^[a-z0-9_-]{1,64}$/)
      .optional(),
    channelIds: MemberGraphChannelIdListSchema,
    displayName: z.string().trim().min(1).max(120),
    handle: IdentifierSchema,
    id: IdentifierSchema,
    participantId: IdentifierSchema,
    type: z.literal("agent"),
  })
  .strict()
  .refine((member) => member.id === member.agentDefinitionId, {
    message: "Agent id must equal agentDefinitionId",
    path: ["id"],
  });
export type MemberGraphAgent = z.infer<typeof MemberGraphAgentSchema>;

export const MemberGraphChannelSchema = z
  .object({
    agentCount: z.number().int().nonnegative().max(500),
    humanCount: z.number().int().nonnegative().max(500),
    id: IdentifierSchema,
    memberCount: z.number().int().nonnegative().max(500),
    name: z.string().trim().min(1).max(120),
    slug: IdentifierSchema,
  })
  .strict()
  .refine(
    (channel) =>
      channel.memberCount === channel.humanCount + channel.agentCount,
    {
      message: "memberCount must equal humanCount plus agentCount",
      path: ["memberCount"],
    },
  );
export type MemberGraphChannel = z.infer<typeof MemberGraphChannelSchema>;

export const MemberGraphEdgeSchema = z
  .object({
    channelIds: MemberGraphChannelIdListSchema,
    channelNames: z.array(z.string().trim().min(1).max(120)).max(500),
    source: z.string().regex(/^(human|agent):[^\s]{1,512}$/),
    target: z.string().regex(/^(human|agent):[^\s]{1,512}$/),
    weight: z.number().int().positive().max(500),
  })
  .strict()
  .refine((edge) => edge.source < edge.target, {
    message: "edge source and target must be canonical and distinct",
  })
  .refine((edge) => edge.weight === edge.channelIds.length, {
    message: "edge weight must equal its shared channel count",
    path: ["weight"],
  });
export type MemberGraphEdge = z.infer<typeof MemberGraphEdgeSchema>;

export const ClientWorkspaceMemberGraphRequestSchema = z
  .object({ workspaceId: IdentifierSchema })
  .strict();
export type ClientWorkspaceMemberGraphRequest = z.infer<
  typeof ClientWorkspaceMemberGraphRequestSchema
>;

export const ClientWorkspaceMemberGraphResponseSchema = z
  .object({
    agents: z.array(MemberGraphAgentSchema).max(500),
    channels: z.array(MemberGraphChannelSchema).max(500),
    edges: z.array(MemberGraphEdgeSchema).max(5_000),
    humans: z.array(MemberGraphHumanSchema).max(500),
    truncated: z.boolean(),
    workspaceId: IdentifierSchema,
  })
  .strict()
  .superRefine((graph, context) => {
    const channels = new Map(
      graph.channels.map((channel) => [channel.id, channel]),
    );
    const members = [...graph.humans, ...graph.agents];
    const memberKeys = new Set<string>();
    for (const member of members) {
      const key = `${member.type}:${member.id}`;
      if (memberKeys.has(key)) {
        context.addIssue({
          code: "custom",
          message: `duplicate member identity ${key}`,
          path: [member.type === "human" ? "humans" : "agents"],
        });
      }
      memberKeys.add(key);
      for (const channelId of member.channelIds) {
        if (!channels.has(channelId)) {
          context.addIssue({
            code: "custom",
            message: `unknown member channel ${channelId}`,
            path: [member.type === "human" ? "humans" : "agents"],
          });
        }
      }
    }
    if (channels.size !== graph.channels.length) {
      context.addIssue({
        code: "custom",
        message: "channel identities must be unique",
        path: ["channels"],
      });
    }
    for (const channel of graph.channels) {
      const humans = graph.humans.filter((member) =>
        member.channelIds.includes(channel.id),
      ).length;
      const agents = graph.agents.filter((member) =>
        member.channelIds.includes(channel.id),
      ).length;
      if (humans !== channel.humanCount || agents !== channel.agentCount) {
        context.addIssue({
          code: "custom",
          message: `channel ${channel.id} membership counts do not match members`,
          path: ["channels"],
        });
      }
    }
    const edgeKeys = new Set<string>();
    for (const edge of graph.edges) {
      const key = `${edge.source}--${edge.target}`;
      if (
        edgeKeys.has(key) ||
        !memberKeys.has(edge.source) ||
        !memberKeys.has(edge.target)
      ) {
        context.addIssue({
          code: "custom",
          message: `invalid or duplicate edge ${key}`,
          path: ["edges"],
        });
      }
      edgeKeys.add(key);
      if (edge.channelIds.some((channelId) => !channels.has(channelId))) {
        context.addIssue({
          code: "custom",
          message: `edge ${key} references an unknown channel`,
          path: ["edges"],
        });
      }
    }
  });
export type ClientWorkspaceMemberGraphResponse = z.infer<
  typeof ClientWorkspaceMemberGraphResponseSchema
>;

type MemberGraphMember = MemberGraphHuman | MemberGraphAgent;

export function projectMemberGraphEdges(
  members: readonly MemberGraphMember[],
  channels: readonly MemberGraphChannel[],
): MemberGraphEdge[] {
  const memberKeysByChannel = new Map<string, string[]>();
  for (const member of members) {
    const memberKey = `${member.type}:${member.id}`;
    for (const channelId of member.channelIds) {
      const keys = memberKeysByChannel.get(channelId) ?? [];
      keys.push(memberKey);
      memberKeysByChannel.set(channelId, keys);
    }
  }
  const project = (
    includedChannels: readonly MemberGraphChannel[],
  ): MemberGraphEdge[] => {
    const edges = new Map<string, MemberGraphEdge>();
    for (const channel of includedChannels) {
      const keys = [
        ...new Set(memberKeysByChannel.get(channel.id) ?? []),
      ].sort();
      for (let left = 0; left < keys.length; left += 1) {
        for (let right = left + 1; right < keys.length; right += 1) {
          const source = keys[left]!;
          const target = keys[right]!;
          const edgeKey = `${source}--${target}`;
          const previous = edges.get(edgeKey);
          const channelIds = [...(previous?.channelIds ?? []), channel.id];
          edges.set(edgeKey, {
            channelIds,
            channelNames: [...(previous?.channelNames ?? []), channel.name],
            source,
            target,
            weight: channelIds.length,
          });
        }
      }
    }
    return [...edges.values()];
  };
  const primary = project(
    channels.filter(
      (channel) => channel.name !== "all" && channel.memberCount <= 36,
    ),
  );
  return primary.length > 0
    ? primary
    : project(channels.filter((channel) => channel.name !== "all"));
}
