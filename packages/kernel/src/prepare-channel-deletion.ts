import { RuntimeTerminationProofError } from "./errors.ts";
import type { DatabaseSync } from "node:sqlite";
import type { RoomKernel } from "./room-kernel.ts";
import type { AuthenticatedActorContext } from "./auth.ts";
import type { ChannelDeletionScope } from "./channel-deletion-scope.ts";
import { integer, text } from "./sqlite-row.ts";
/** Use existing durable deletion/Host stop machinery; never infer termination from a signal. */
export function prepareChannelInstances(
  kernel: RoomKernel,
  db: DatabaseSync,
  actor: AuthenticatedActorContext,
  scope: ChannelDeletionScope,
  key: string,
) {
  const seq = (roomId: string) =>
    integer(
      db.prepare("SELECT next_seq FROM rooms WHERE room_id=?").get(roomId)!,
      "next_seq",
    ) - 1;
  const definition = (agentId: string) =>
    db
      .prepare(
        "SELECT control_room_id,state FROM agent_definitions WHERE agent_definition_id=?",
      )
      .get(agentId)!;
  for (const i of scope.instances) {
    const d = definition(i.agentId);
    if (d.state !== "tombstoned")
      kernel.manageWorkspaceAgent(actor, {
        action: "set_state",
        agentId: i.agentId,
        state: "disabled",
        basedOnRoomSeq: seq(text(d, "control_room_id")),
        idempotencyKey: `${key}:disable:${i.instanceId}`,
      });
  }
  for (const roomId of scope.roomIds) {
    for (const t of db
      .prepare(
        "SELECT task_id FROM tasks WHERE room_id=? AND workflow_status NOT IN ('done','closed')",
      )
      .all(roomId))
      kernel.cancelTask(actor, {
        taskId: text(t, "task_id"),
        basedOnRoomSeq: seq(roomId),
        idempotencyKey: `${key}:cancel:${text(t, "task_id")}`,
        reason: "Human requested permanent channel deletion",
      });
  }
  let waiting: RuntimeTerminationProofError | undefined;
  for (const i of scope.instances) {
    const d = definition(i.agentId);
    if (d.state !== "tombstoned")
      try {
        kernel.manageWorkspaceAgent(actor, {
          action: "set_state",
          agentId: i.agentId,
          state: "tombstoned",
          basedOnRoomSeq: seq(text(d, "control_room_id")),
          idempotencyKey: `${key}:delete:${i.instanceId}`,
        });
      } catch (error) {
        if (!(error instanceof RuntimeTerminationProofError)) throw error;
        waiting ??= error;
      }
  }
  if (waiting) throw waiting;
}
