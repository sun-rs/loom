import type { DatabaseSync } from "node:sqlite";
import type { HumanThreadFollowRequest } from "@rah-os/protocol";
/** Called inside HumanActivity's authenticated, scope-checked transaction.
 * A captured UI frontier is history, never notification authority or task completion. */
export function persistHumanThreadFollow(
  db: DatabaseSync,
  actorId: string,
  input: HumanThreadFollowRequest,
) {
  const previous = db
    .prepare(
      "SELECT following, retained_seq FROM human_thread_follows WHERE principal_id=? AND thread_id=?",
    )
    .get(actorId, input.threadId);
  // Same-state repeats cannot move the snapshot or acknowledge unseen messages.
  if (previous?.following === Number(input.following)) return;
  if (
    input.retainThroughSeq !== undefined &&
    !db
      .prepare(
        "SELECT 1 FROM discovery_messages WHERE room_id=? AND thread_id=? AND room_seq=?",
      )
      .get(input.roomId, input.threadId, input.retainThroughSeq)
  )
    throw Error(
      "retained activity frontier must identify a visible thread message",
    );
  db.prepare(
    `INSERT INTO human_thread_follows(principal_id,thread_id,following,retained_seq) VALUES(?,?,?,?)
    ON CONFLICT(principal_id,thread_id) DO UPDATE SET following=excluded.following,retained_seq=excluded.retained_seq`,
  ).run(
    actorId,
    input.threadId,
    Number(input.following),
    input.retainThroughSeq ?? null,
  );
  if (input.retainThroughSeq !== undefined) {
    // Official unfollow clears the captured row's unread state only. Do not advance
    // Done, parent-channel reads, or the frontier of replies arriving after capture.
    db.prepare(
      `INSERT INTO human_activity_frontiers(principal_id,room_id,scope_id,read_seq,done_seq) VALUES(?,?,?,?,0)
      ON CONFLICT(principal_id,room_id,scope_id) DO UPDATE SET read_seq=MAX(read_seq,excluded.read_seq)`,
    ).run(actorId, input.roomId, input.threadId, input.retainThroughSeq);
  }
}
