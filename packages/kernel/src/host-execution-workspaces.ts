import type { DatabaseSync } from "node:sqlite";
import {
  HOST_EXECUTION_WORKSPACE_BINDING_LIMIT,
  AgentDefinitionRevisionSchema,
  ChannelWorkspaceSchema,
  HostExecutionWorkspaceBindingSchema,
  type HostExecutionWorkspaceBinding,
} from "@rah-os/protocol";
import {
  requireAuthenticatedHost,
  type AuthenticatedHostContext,
} from "./auth.ts";
import { authorizedHostParticipantIds } from "./host-authorization.ts";
import { jsonObject, text } from "./sqlite-row.ts";

/**
 * Host-scoped configuration projection. It never returns Host-derived paths;
 * the only paths are a channel home's Human-attached directories.
 */
export function listHostExecutionWorkspaceBindings(
  database: DatabaseSync,
  host: AuthenticatedHostContext,
): HostExecutionWorkspaceBinding[] {
  const authenticated = requireAuthenticatedHost(database, host);
  const result: HostExecutionWorkspaceBinding[] = [];
  const participants = authorizedHostParticipantIds(database, authenticated);
  if (participants.length > HOST_EXECUTION_WORKSPACE_BINDING_LIMIT)
    throw new Error(
      "Host execution binding limit exceeded; full snapshot cannot be returned",
    );
  for (const participantId of participants) {
    const row = database
      .prepare(
        `SELECT r.definition_json, rooms.workspace_id FROM agent_definitions d
      JOIN agent_definition_revisions r ON r.agent_definition_revision_id = d.current_revision_id
      JOIN rooms ON rooms.room_id = d.control_room_id
      WHERE d.participant_id = ? AND d.state <> 'tombstoned'`,
      )
      .get(participantId);
    if (!row) continue;
    const revision = AgentDefinitionRevisionSchema.parse(
      jsonObject(row, "definition_json"),
    );
    const channelHome =
      revision.executionWorkspace?.kind === "channel_home"
        ? revision.executionWorkspace
        : undefined;
    const channelWorkspace =
      channelHome === undefined
        ? undefined
        : database
            .prepare(
              "SELECT channel_workspace_json FROM rooms WHERE room_id = ?",
            )
            .get(channelHome.roomId)?.channel_workspace_json;
    result.push(
      HostExecutionWorkspaceBindingSchema.parse({
        participantId,
        agentDefinitionRevisionId: revision.agentDefinitionRevisionId,
        workspaceDefinitionId: text(row, "workspace_id"),
        ...(revision.executionWorkspace === undefined
          ? {}
          : { executionWorkspace: revision.executionWorkspace }),
        ...(channelHome === undefined
          ? {}
          : {
              additionalDirectories:
                typeof channelWorkspace === "string"
                  ? ChannelWorkspaceSchema.parse(JSON.parse(channelWorkspace))
                      .additionalDirectories
                  : [],
            }),
      }),
    );
  }
  return result.sort((a, b) => a.participantId.localeCompare(b.participantId));
}
