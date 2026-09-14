import type { RoomEvent } from "@rah-os/protocol";
import type { WorkspaceAgentManagementOwner } from "./workspace-agent-management.ts";
import { text } from "./sqlite-row.ts";

/** Same cancel/log/obsolete-receipt boundary as ReminderService.cancel, inside deletion's transaction. */
export function cancelDeletedAgentReminders(
  owner: WorkspaceAgentManagementOwner,
  request: RoomEvent,
): void {
  const { database: db } = owner;
  const now = owner.now().toISOString();
  for (const row of db
    .prepare(
      "SELECT reminder_id FROM reminders WHERE owner_agent_id=? AND status<>'canceled'",
    )
    .all(request.aggregateId)) {
    const id = text(row, "reminder_id");
    db.prepare(
      "UPDATE reminders SET status='canceled',version=version+1,updated_at=? WHERE reminder_id=?",
    ).run(now, id);
    db.prepare(
      "UPDATE reminder_fire_receipts SET state='obsolete',updated_at=? WHERE reminder_id=? AND state='pending'",
    ).run(now, id);
    db.prepare(
      "INSERT INTO reminder_events(event_id,reminder_id,event_type,actor_type,actor_id,occurred_at,metadata_json) VALUES(?,?,'canceled','human',?,?,?)",
    ).run(
      owner.createId("reminder_event"),
      id,
      request.actorId,
      now,
      JSON.stringify({
        reason: "agent_deleted",
        deletionRequestEventId: request.eventId,
      }),
    );
  }
}
