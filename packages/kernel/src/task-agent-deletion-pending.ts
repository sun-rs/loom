import type { RoomEvent } from "@rah-os/protocol";
import type { WorkspaceAgentManagementOwner } from "./workspace-agent-management.ts";
import { text } from "./sqlite-row.ts";

export function cancelDeletedAgentTaskOperations(
  owner: WorkspaceAgentManagementOwner,
  participantId: string,
  request: RoomEvent,
): void {
  const { database: db, events } = owner;
  const now = owner.now().toISOString();
  for (const row of db
    .prepare(
      `SELECT * FROM input_requests WHERE state='pending' AND (requester_id=? OR responder_id=? OR task_id IN (SELECT task_id FROM tasks WHERE assignee_id=? OR claimed_by=?))`,
    )
    .all(participantId, participantId, participantId, participantId)) {
    const id = text(row, "input_request_id");
    db.prepare(
      "UPDATE input_requests SET state='cancelled',cancelled_at=?,cancelled_by=?,cancellation_reason='Agent deleted',updated_at=? WHERE input_request_id=?",
    ).run(now, request.actorId, now, id);
    events.append(
      {
        actorId: request.actorId,
        aggregateId: id,
        aggregateType: "input_request",
        roomId: text(row, "room_id"),
        idempotencyKey: `${request.eventId}:input:${id}`,
        type: "input.cancelled",
        payload: {
          inputRequestId: id,
          taskId: text(row, "task_id"),
          reason: "agent_deleted",
        },
      },
      request,
    );
  }
  for (const row of db
    .prepare(
      "SELECT * FROM task_reassignment_operations WHERE state NOT IN ('assigned','failed_closed') AND (previous_assignee_id=? OR next_assignee_id=?)",
    )
    .all(participantId, participantId)) {
    const id = text(row, "operation_id");
    db.prepare(
      "UPDATE task_reassignment_operations SET state='failed_closed',updated_at=?,completed_at=? WHERE operation_id=?",
    ).run(now, now, id);
    events.append(
      {
        actorId: request.actorId,
        aggregateId: text(row, "task_id"),
        aggregateType: "task",
        roomId: text(row, "room_id"),
        idempotencyKey: `${request.eventId}:reassignment:${id}`,
        type: "task.reassignment_failed_closed",
        payload: {
          operationId: id,
          taskId: text(row, "task_id"),
          reason: "agent_deleted",
        },
      },
      request,
    );
  }
}
