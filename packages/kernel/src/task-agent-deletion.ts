import { cancelDeletedAgentTaskOperations } from "./task-agent-deletion-pending.ts";
import type { RoomEvent } from "@rah-os/protocol";
import { integer, text } from "./sqlite-row.ts";
import type { WorkspaceAgentManagementOwner } from "./workspace-agent-management.ts";

/** Deletion releases future ownership; canonical tasks, discussions and reviews survive. */
export function releaseDeletedAgentTasks(
  owner: WorkspaceAgentManagementOwner,
  participantId: string,
  request: RoomEvent,
  eventKey = request.eventId,
): void {
  const { database: db, events } = owner;
  const now = owner.now().toISOString();
  cancelDeletedAgentTaskOperations(owner, participantId, request);
  const tasks = db
    .prepare(
      `SELECT DISTINCT t.* FROM tasks t LEFT JOIN task_participants p ON p.task_id=t.task_id
    WHERE t.assignee_id=? OR t.claimed_by=? OR (t.workflow_status NOT IN ('done','closed') AND p.participant_id=?)`,
    )
    .all(participantId, participantId, participantId);
  for (const task of tasks) {
    const id = text(task, "task_id"),
      roomId = text(task, "room_id");
    const owned =
      task.assignee_id === participantId || task.claimed_by === participantId;
    if (owned)
      db.prepare(
        `UPDATE tasks SET assignee_id=NULL,claimed_by=NULL,claim_until=NULL,claim_until_ms=NULL,
      updated_at=? WHERE task_id=?`,
      ).run(now, id);
    db.prepare(
      "DELETE FROM task_participants WHERE task_id=? AND participant_id=?",
    ).run(id, participantId);
    events.append(
      {
        actorId: request.actorId,
        aggregateId: id,
        aggregateType: "task",
        roomId,
        idempotencyKey: `${eventKey}:task:${id}`,
        type: owned ? "task.unassigned" : "task.participant_removed",
        payload: {
          taskId: id,
          participantId,
          previousAssigneeId: task.assignee_id,
          previousState: task.state,
          previousWorkflowStatus: task.workflow_status,
          reason: "agent_deleted",
          basedOnRoomSeq:
            integer(
              db
                .prepare("SELECT next_seq FROM rooms WHERE room_id=?")
                .get(roomId)!,
              "next_seq",
            ) - 1,
        },
      },
      request,
    );
  }
}

/** Repair old tombstones using their authenticated, durable deletion intent. */
export function reconcileDeletedAgentTaskOwners(
  owner: Omit<WorkspaceAgentManagementOwner, "actorId">,
): void {
  const requests = owner.database
    .prepare(
      `SELECT DISTINCT e.*, a.participant_id
    FROM agent_definitions a JOIN room_events e ON e.aggregate_id=a.agent_definition_id
    WHERE a.state='tombstoned' AND e.type='agent.deletion_requested'
    AND EXISTS (SELECT 1 FROM tasks t WHERE t.assignee_id=a.participant_id OR t.claimed_by=a.participant_id)`,
    )
    .all();
  for (const row of requests) {
    const request = owner.events.eventFromRow(row);
    releaseDeletedAgentTasks(
      { ...owner, actorId: request.actorId },
      text(row, "participant_id"),
      request,
      `${request.eventId}:owner-repair-v1`,
    );
  }
}
