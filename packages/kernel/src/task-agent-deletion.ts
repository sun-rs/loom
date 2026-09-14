import { cancelDeletedAgentTaskOperations } from "./task-agent-deletion-pending.ts";
import type { RoomEvent } from "@rah-os/protocol";
import { integer, text } from "./sqlite-row.ts";
import type { WorkspaceAgentManagementOwner } from "./workspace-agent-management.ts";

/** Deletion releases future ownership; canonical tasks, discussions and reviews survive. */
export function releaseDeletedAgentTasks(
  owner: WorkspaceAgentManagementOwner,
  participantId: string,
  request: RoomEvent,
): void {
  const { database: db, events } = owner;
  const now = owner.now().toISOString();
  cancelDeletedAgentTaskOperations(owner, participantId, request);
  const tasks = db
    .prepare(
      `SELECT DISTINCT t.* FROM tasks t LEFT JOIN task_participants p ON p.task_id=t.task_id
    WHERE t.workflow_status NOT IN ('done','closed') AND (t.assignee_id=? OR t.claimed_by=? OR p.participant_id=?)`,
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
      state=CASE WHEN workflow_status='in_review' THEN 'submitted' ELSE 'todo' END,
      workflow_status=CASE WHEN workflow_status='in_review' THEN 'in_review' ELSE 'todo' END,updated_at=? WHERE task_id=?`,
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
        idempotencyKey: `${request.eventId}:task:${id}`,
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
