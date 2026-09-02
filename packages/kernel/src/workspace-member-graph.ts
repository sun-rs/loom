import type { DatabaseSync } from "node:sqlite";

import {
  AgentDefinitionRevisionSchema,
  ClientWorkspaceMemberGraphResponseSchema,
  projectMemberGraphEdges,
  type ClientWorkspaceMemberGraphResponse,
} from "@rah-os/protocol";

import { ForbiddenError, NotFoundError } from "./errors.ts";
import { jsonObject, nullableText, text, type Row } from "./sqlite-row.ts";
import type { Principal } from "./types.ts";

type MutableMember = {
  avatarKey?: string;
  channelIds: string[];
  displayName: string;
  handle: string;
  id: string;
  participantId?: string;
  principalId?: string;
  agentDefinitionId?: string;
  type: "agent" | "human";
};

export function listWorkspaceMemberGraph(
  database: DatabaseSync,
  actor: Principal,
  input: { workspaceId: string },
): ClientWorkspaceMemberGraphResponse {
  if (actor.kind !== "human") {
    throw new ForbiddenError("only Human principals can read member graphs");
  }
  const workspace = database
    .prepare("SELECT workspace_id FROM workspaces WHERE workspace_id = ?")
    .get(input.workspaceId);
  if (workspace === undefined) {
    throw new NotFoundError(`Workspace ${input.workspaceId} was not found`);
  }
  const access = database
    .prepare(
      `SELECT 1 AS present
       FROM memberships
       JOIN rooms ON rooms.room_id = memberships.room_id
       WHERE memberships.principal_id = ?
         AND rooms.workspace_id = ?
       LIMIT 1`,
    )
    .get(actor.principalId, input.workspaceId);
  if (access === undefined) {
    throw new ForbiddenError(
      `Human ${actor.principalId} has no access to Workspace ${input.workspaceId}`,
    );
  }
  const channelRows = database
    .prepare(
      `SELECT rooms.room_id, rooms.name, rooms.slug
       FROM rooms
       JOIN memberships AS viewer_membership
         ON viewer_membership.room_id = rooms.room_id
        AND viewer_membership.principal_id = ?
       WHERE rooms.workspace_id = ?
         AND rooms.kind = 'channel'
         AND rooms.archived_at IS NULL
       ORDER BY rooms.name, rooms.room_id
       LIMIT 501`,
    )
    .all(actor.principalId, input.workspaceId);
  let truncated = channelRows.length > 500;
  const visibleChannelRows = channelRows.slice(0, 500);
  if (visibleChannelRows.length === 0) {
    return ClientWorkspaceMemberGraphResponseSchema.parse({
      agents: [],
      channels: [],
      edges: [],
      humans: [],
      truncated,
      workspaceId: input.workspaceId,
    });
  }
  const channelIds = visibleChannelRows.map((row) => text(row, "room_id"));
  const placeholders = channelIds.map(() => "?").join(", ");
  const membershipRows = database
    .prepare(
      `SELECT
         memberships.room_id,
         principals.principal_id,
         principals.kind,
         principals.handle,
         principals.display_name,
         principals.avatar_key,
         agent_definitions.agent_definition_id,
         agent_definition_revisions.definition_json
       FROM memberships
       JOIN principals ON principals.principal_id = memberships.principal_id
       LEFT JOIN agent_definitions
         ON agent_definitions.participant_id = principals.principal_id
       LEFT JOIN agent_definition_revisions
         ON agent_definition_revisions.agent_definition_revision_id = agent_definitions.current_revision_id
       WHERE memberships.room_id IN (${placeholders})
         AND principals.kind IN ('human', 'agent')
       ORDER BY principals.kind, principals.principal_id, memberships.room_id`,
    )
    .all(...channelIds);
  const members = new Map<string, MutableMember>();
  for (const row of membershipRows) {
    const member = memberFromRow(row);
    const key = `${member.type}:${member.id}`;
    const previous = members.get(key);
    if (previous === undefined) members.set(key, member);
    else previous.channelIds.push(text(row, "room_id"));
  }
  const humans = [...members.values()]
    .filter((member) => member.type === "human")
    .slice(0, 500)
    .map((member) => ({
      ...(member.avatarKey === undefined
        ? {}
        : { avatarKey: member.avatarKey }),
      channelIds: member.channelIds,
      displayName: member.displayName,
      handle: member.handle,
      id: member.id,
      principalId: member.principalId!,
      type: "human" as const,
    }));
  const agents = [...members.values()]
    .filter((member) => member.type === "agent" && member.agentDefinitionId)
    .slice(0, 500)
    .map((member) => ({
      agentDefinitionId: member.agentDefinitionId!,
      ...(member.avatarKey === undefined
        ? {}
        : { avatarKey: member.avatarKey }),
      channelIds: member.channelIds,
      displayName: member.displayName,
      handle: member.handle,
      id: member.id,
      participantId: member.participantId!,
      type: "agent" as const,
    }));
  if (
    humans.length <
      [...members.values()].filter((member) => member.type === "human")
        .length ||
    agents.length <
      [...members.values()].filter((member) => member.type === "agent").length
  ) {
    truncated = true;
  }
  const visibleMembers = [...humans, ...agents];
  const channels = visibleChannelRows.map((row) => {
    const id = text(row, "room_id");
    const humanCount = humans.filter((member) =>
      member.channelIds.includes(id),
    ).length;
    const agentCount = agents.filter((member) =>
      member.channelIds.includes(id),
    ).length;
    return {
      agentCount,
      humanCount,
      id,
      memberCount: humanCount + agentCount,
      name: text(row, "name"),
      slug: text(row, "slug"),
    };
  });
  return ClientWorkspaceMemberGraphResponseSchema.parse({
    agents,
    channels,
    edges: projectMemberGraphEdges(visibleMembers, channels),
    humans,
    truncated,
    workspaceId: input.workspaceId,
  });
}

function memberFromRow(row: Row): MutableMember {
  const principalId = text(row, "principal_id");
  const handle = text(row, "handle");
  const principalDisplayName = nullableText(row, "display_name") ?? handle;
  const principalAvatarKey = nullableText(row, "avatar_key") ?? undefined;
  const roomId = text(row, "room_id");
  if (text(row, "kind") === "human") {
    return {
      ...(principalAvatarKey === undefined
        ? {}
        : { avatarKey: principalAvatarKey }),
      channelIds: [roomId],
      displayName: principalDisplayName,
      handle,
      id: principalId,
      principalId,
      type: "human",
    };
  }
  const agentDefinitionId =
    nullableText(row, "agent_definition_id") ?? undefined;
  const definition =
    row.definition_json === null || row.definition_json === undefined
      ? undefined
      : AgentDefinitionRevisionSchema.parse(jsonObject(row, "definition_json"));
  const avatarKey = definition?.avatarKey ?? principalAvatarKey;
  return {
    ...(agentDefinitionId === undefined ? {} : { agentDefinitionId }),
    ...(avatarKey === undefined ? {} : { avatarKey }),
    channelIds: [roomId],
    displayName: definition?.displayName ?? principalDisplayName,
    handle,
    id: agentDefinitionId ?? principalId,
    participantId: principalId,
    type: "agent",
  };
}
