import type { DatabaseSync } from "node:sqlite";
import type { TaskWorkflowStatus } from "@rah-os/protocol";
import {
  requireHumanTaskManager,
  requireRoomMember,
} from "./collaboration-policy.ts";
import { ConflictError, NotFoundError, StaleContextError } from "./errors.ts";
import { integer, nullableText, text } from "./sqlite-row.ts";
import { taskProjectionFromRow } from "./task-projection.ts";
import {
  assertTaskEventReplay,
  findRoomEventByIdempotencyKey,
} from "./task-event-replay.ts";
import { requestActiveTaskExecutionCancellation } from "./activation-cancellation.ts";
import { listRoomAgentRecipients } from "./room-agent-service.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import type { TaskCreateMutationResult } from "./types.ts";

type Edit =
  { workflowStatus: TaskWorkflowStatus } | { assigneeId: string | null };
type Input = { taskId: string; basedOnRoomSeq: number; idempotencyKey: string };
/** Human business edits are canonical Task mutations, not fake Worker execution.
 * Caller owns the transaction. Existing cancellation/claim owners fence handoff. */
export function editHumanTask(
  context: {
    database: DatabaseSync;
    events: RoomEventWriter;
    now: () => Date;
    createId: (prefix: string) => string;
  },
  actorId: string,
  input: Input,
  edit: Edit,
): TaskCreateMutationResult {
  const { database: db, events } = context;
  const requireTask = () => {
    const row = db
      .prepare("SELECT * FROM tasks WHERE task_id=?")
      .get(input.taskId);
    if (!row) throw new NotFoundError(`Task ${input.taskId} was not found`);
    return row;
  };
  const task = requireTask(),
    roomId = text(task, "room_id");
  requireRoomMember(db, roomId, actorId);
  requireHumanTaskManager(
    db,
    { roomId, creatorId: text(task, "creator_id") },
    actorId,
  );
  const workflow = "workflowStatus" in edit;
  const eventType = workflow
    ? edit.workflowStatus === "done"
      ? "task.completed"
      : edit.workflowStatus === "closed"
        ? "task.cancelled"
        : edit.workflowStatus === "todo"
          ? "task.reopened"
          : "task.workflow_updated"
    : edit.assigneeId === null
      ? "task.unassigned"
      : "task.assigned";
  const replay = findRoomEventByIdempotencyKey(
    db,
    roomId,
    input.idempotencyKey,
  );
  if (replay) {
    const event = assertTaskEventReplay(events.eventFromRow(replay), {
      actorId,
      aggregateId: input.taskId,
      eventType,
      payload: { ...edit, basedOnRoomSeq: input.basedOnRoomSeq },
    });
    return {
      event,
      deduplicated: true,
      activationIds: [],
      task: taskProjectionFromRow(db, requireTask()),
    };
  }
  const seq =
    integer(
      db.prepare("SELECT next_seq FROM rooms WHERE room_id=?").get(roomId)!,
      "next_seq",
    ) - 1;
  if (seq !== input.basedOnRoomSeq)
    throw new StaleContextError(input.basedOnRoomSeq, seq);
  if (!workflow && text(task, "workflow_status") === "done")
    throw new ConflictError(
      "Completed tasks cannot change assignee; reopen the task first",
    );
  if (!workflow && edit.assigneeId !== null)
    requireRoomMember(db, roomId, edit.assigneeId);
  const at = context.now().toISOString();
  const previousAssigneeId = nullableText(task, "assignee_id");
  const changed = workflow
    ? text(task, "workflow_status") !== edit.workflowStatus
    : previousAssigneeId !== edit.assigneeId;
  const claimedBy = nullableText(task, "claimed_by");
  let cancellationRequestId: string | undefined;
  const previousParticipants = db
    .prepare("SELECT participant_id FROM task_participants WHERE task_id=?")
    .all(input.taskId);
  const pendingInput = db
    .prepare(
      "SELECT input_request_id FROM input_requests WHERE task_id=? AND state='pending'",
    )
    .get(input.taskId);
  if (changed && claimedBy !== null) {
    cancellationRequestId = requestActiveTaskExecutionCancellation({
      actorId,
      createId: context.createId,
      database: db,
      participantId: claimedBy,
      reason: "Human changed Task status or assignee",
      requestedAt: at,
      roomId,
      taskId: input.taskId,
    });
  }
  const humanTakesResponsibility =
    workflow &&
    edit.workflowStatus === "in_progress" &&
    text(task, "state") === "todo" &&
    previousAssigneeId === null;
  if (changed && workflow) {
    const states = {
      todo: "todo",
      in_progress: "in_progress",
      in_review: "submitted",
      done: "completed",
      closed: "cancelled",
    } as const;
    db.prepare(
      `UPDATE tasks SET state=?,assignee_id=?,claimed_by=NULL,claim_until=NULL,claim_until_ms=NULL,
   blocked_reason=NULL,blocked_at=NULL,completed_at=?,cancellation_reason=?,cancelled_at=?,updated_at=? WHERE task_id=?`,
    ).run(
      states[edit.workflowStatus],
      humanTakesResponsibility ? actorId : previousAssigneeId,
      edit.workflowStatus === "done" ? at : null,
      edit.workflowStatus === "closed" ? "Closed by Human" : null,
      edit.workflowStatus === "closed" ? at : null,
      at,
      input.taskId,
    );
    // A pending question must not later undo a newer explicit Human status.
    db.prepare(
      "UPDATE input_requests SET state='cancelled',cancelled_at=?,cancelled_by=?,cancellation_reason='Human changed Task status',updated_at=? WHERE task_id=? AND state='pending'",
    ).run(at, actorId, at, input.taskId);
  } else if (changed && !workflow) {
    db.prepare(
      "UPDATE tasks SET assignee_id=?,state=CASE WHEN state='claimed' THEN 'in_progress' ELSE state END,claimed_by=NULL,claim_until=NULL,claim_until_ms=NULL,updated_at=? WHERE task_id=?",
    ).run(edit.assigneeId, at, input.taskId);
    if (edit.assigneeId === null)
      db.prepare("DELETE FROM task_participants WHERE task_id=?").run(
        input.taskId,
      );
    else
      db.prepare(
        "DELETE FROM task_participants WHERE task_id=? AND participant_id=?",
      ).run(input.taskId, edit.assigneeId);
  }
  const ready =
    workflow && edit.workflowStatus === "done" && changed
      ? db
          .prepare(
            `SELECT candidate.* FROM tasks candidate JOIN task_dependencies d ON d.task_id=candidate.task_id WHERE d.dependency_task_id=? AND candidate.state='todo' AND NOT EXISTS(SELECT 1 FROM task_dependencies r JOIN tasks dependency ON dependency.task_id=r.dependency_task_id WHERE r.task_id=candidate.task_id AND dependency.state<>'completed')`,
          )
          .all(input.taskId)
      : [];
  const event = events.append({
    actorId,
    aggregateId: input.taskId,
    aggregateType: "task",
    roomId,
    idempotencyKey: input.idempotencyKey,
    type: eventType,
    payload: {
      ...edit,
      basedOnRoomSeq: input.basedOnRoomSeq,
      taskId: input.taskId,
      previousState: text(task, "state"),
      previousWorkflowStatus: text(task, "workflow_status"),
      previousAssigneeId,
      humanEdited: true,
      ...(humanTakesResponsibility ? { assigneeId: actorId } : {}),
      ...(cancellationRequestId ? { cancellationRequestId } : {}),
      ...(changed && workflow && pendingInput
        ? { cancelledInputRequestId: text(pendingInput, "input_request_id") }
        : {}),
      readyTaskIds: ready.map((r) => text(r, "task_id")),
    },
  });
  const recipients = new Map<
    string,
    {
      participantId: string;
      reason:
        | "task_updated"
        | "task_assigned"
        | "task_collaboration"
        | "task_available"
        | "dependency_resolved";
    }
  >();
  const add = (
    id: string | null,
    reason:
      | "task_updated"
      | "task_assigned"
      | "dependency_resolved"
      | "task_collaboration",
  ) => {
    if (
      id &&
      db
        .prepare(
          "SELECT 1 FROM principals p JOIN memberships m ON m.principal_id=p.principal_id WHERE p.principal_id=? AND p.kind='agent' AND m.room_id=?",
        )
        .get(id, roomId)
    )
      recipients.set(id, { participantId: id, reason });
  };
  // Reopening a completed task is a Human correction, not new execution.
  const quietReopen =
    workflow &&
    edit.workflowStatus === "todo" &&
    text(task, "state") === "completed";
  if (changed && !quietReopen) {
    add(previousAssigneeId, "task_updated");
    for (const participant of previousParticipants)
      add(text(participant, "participant_id"), "task_updated");
    const current = requireTask();
    add(
      nullableText(current, "assignee_id"),
      workflow || !["todo", "in_progress"].includes(text(current, "state"))
        ? "task_updated"
        : "task_assigned",
    );
    if (
      ["todo", "in_progress"].includes(text(current, "state")) &&
      nullableText(current, "assignee_id") === null
    )
      for (const r of listRoomAgentRecipients(db, roomId, "task_available"))
        recipients.set(r.participantId, {
          participantId: r.participantId,
          reason: "task_available",
        });
    for (const dependent of ready) {
      const id = nullableText(dependent, "assignee_id");
      if (id) {
        add(id, "dependency_resolved");
        for (const r of db
          .prepare(
            "SELECT participant_id FROM task_participants WHERE task_id=? AND role='collaborator'",
          )
          .all(text(dependent, "task_id")))
          add(text(r, "participant_id"), "task_collaboration");
      } else
        for (const r of listRoomAgentRecipients(
          db,
          roomId,
          "dependency_resolved",
        ))
          recipients.set(r.participantId, {
            participantId: r.participantId,
            reason: "dependency_resolved",
          });
    }
  }
  return {
    event,
    deduplicated: false,
    activationIds: events.deriveAttention(event, [...recipients.values()], at),
    task: taskProjectionFromRow(db, requireTask()),
  };
}
