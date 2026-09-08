import type { DatabaseSync } from "node:sqlite";
import type { WorkerProfileReadRequest } from "@rah-os/protocol";
import { discoveryPage } from "./global-discovery.ts";
import { ForbiddenError } from "./errors.ts";
import { integer, type Row } from "./sqlite-row.ts";
import type { WorkerVisibleRoomScope } from "./worker-read-targets.ts";

// Same directory cursor owner, bound to authenticated Room and original creator.
export function visibleWorkerCreatedAgents(
  db: DatabaseSync,
  scope: WorkerVisibleRoomScope,
  creatorId: string,
  paging: Pick<
    WorkerProfileReadRequest,
    "createdAgentsLimit" | "createdAgentsCursor"
  >,
  project: (row: Row) => unknown,
  baseBytes: number,
) {
  let page;
  try {
    page = discoveryPage(db, "principals", scope.participantId, {
      cursor: paging.createdAgentsCursor,
      limit: paging.createdAgentsLimit ?? 50,
      bindingVersion: JSON.stringify([
        "worker-created-agents-v1",
        scope.roomId,
        creatorId,
      ]),
    });
  } catch {
    throw new ForbiddenError(
      "invalid created-Agent cursor or changed query scope",
    );
  }
  const rows = db
    .prepare(
      `SELECT p.*,p.rowid AS principal_order,a.agent_definition_id,a.state AS agent_state,current.execution_policy_revision_id,policy.policy_json,json_extract(current.definition_json,'$.displayName') AS agent_display_name,json_extract(current.definition_json,'$.avatarKey') AS agent_avatar_key
 FROM agent_definitions a JOIN principals p ON p.principal_id=a.participant_id JOIN agent_definition_revisions first ON first.agent_definition_id=a.agent_definition_id AND first.revision=1 JOIN agent_definition_revisions current ON current.agent_definition_revision_id=a.current_revision_id JOIN execution_policy_revisions policy ON policy.execution_policy_revision_id=current.execution_policy_revision_id
 JOIN memberships m ON m.principal_id=p.principal_id AND m.room_id=? WHERE first.created_by=? AND p.rowid<=? AND p.rowid<? ORDER BY p.rowid DESC LIMIT ?`,
    )
    .all(scope.roomId, creatorId, page.ceiling, page.before, page.limit + 1);
  const createdAgents: unknown[] = [];
  let bytes = baseBytes + 4096;
  for (const row of rows.slice(0, page.limit)) {
    const child = project(row),
      size = Buffer.byteLength(JSON.stringify(child)) + 1;
    if (bytes + size > 384 * 1024) {
      if (!createdAgents.length)
        throw new ForbiddenError(
          "one profile exceeds the Worker read response limit",
        );
      break;
    }
    bytes += size;
    createdAgents.push(child);
  }
  const more = rows.length > createdAgents.length;
  return {
    createdAgents,
    createdAgentsTruncated: more,
    ...(more
      ? {
          createdAgentsNextCursor: page.next(
            integer(rows[createdAgents.length - 1]!, "principal_order"),
          ),
        }
      : {}),
  };
}
