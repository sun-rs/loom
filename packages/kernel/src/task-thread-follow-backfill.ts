import type { DatabaseSync } from "node:sqlite";

/** Schema 81: existing explicit unfollows win; no synthetic message/read receipt. */
export function backfillTaskThreadFollows(db: DatabaseSync): void {
  db.exec(`INSERT OR IGNORE INTO agent_thread_follows
    (participant_id,thread_id,following,source,updated_at)
    SELECT p.principal_id,t.thread_id,1,'participation',t.updated_at
    FROM tasks t JOIN (
      SELECT task_id,assignee_id AS id FROM tasks WHERE assignee_id IS NOT NULL
      UNION SELECT task_id,creator_id FROM tasks
      UNION SELECT task_id,participant_id FROM task_participants
    ) members ON members.task_id=t.task_id
    JOIN principals p ON p.principal_id=members.id AND p.kind='agent'
    JOIN memberships m ON m.room_id=t.room_id AND m.principal_id=p.principal_id
    JOIN threads th ON th.thread_id=t.thread_id
    LEFT JOIN agent_definitions a ON a.participant_id=p.principal_id
    WHERE a.state IS NULL OR a.state='enabled'`);
}
