import { requireAgentExecutionEnabled } from "./workspace-agent-management.ts";
import { unresolvedActivationCancellation } from "./activation-cancellation.ts";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { integer, text, type Row } from "./sqlite-row.ts";

export type PendingRuntimeNotice = {
  fingerprint: string;
  text: string;
  eventIds: string[];
};
export type RuntimeNoticeInput = {
  activationId: string;
  runAttemptId: string;
  excludeEventIds?: readonly string[];
};

/**
 * Structural port of Raft Computer 1.0.18 projectAgentInboxSnapshot (737013)
 * and formatAgentInboxDelta (734232), plus recordNoticeWritten/filterUncontributed
 * (763021/763039): exclude only identities written by this run, never ACK them.
 * main.js SHA256
 * 20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e.
 * RAH glue: durable Inbox, Room-local cursors, canonical handles and full IDs.
 * This is only a wake hint: it neither presents message bodies nor advances ACK.
 */
export function pendingRuntimeNotice(
  database: DatabaseSync,
  activation: Row,
  input: RuntimeNoticeInput,
): PendingRuntimeNotice | undefined {
  const excluded = input.excludeEventIds ?? [];
  if (
    !Array.isArray(excluded) ||
    excluded.length > 256 ||
    excluded.some(
      (id) => typeof id !== "string" || id.length === 0 || id.length > 200,
    )
  ) {
    throw new Error(
      "excludeEventIds must contain at most 256 nonempty event IDs of at most 200 characters",
    );
  }
  requireAgentExecutionEnabled(database, text(activation, "participant_id"));
  if (unresolvedActivationCancellation(database, activation)) return undefined;
  const rows = database
    .prepare(
      `
    SELECT i.event_id, i.event_seq, i.reason, m.message_id, m.thread_id,
      sender.handle AS sender_handle, r.slug, r.kind, peer.handle AS peer_handle
    FROM inbox_items i
    JOIN memberships membership ON membership.room_id=i.room_id AND membership.principal_id=i.participant_id
    JOIN rooms r ON r.room_id=i.room_id AND r.kind IN ('channel','direct')
    JOIN room_events e ON e.event_id=i.event_id AND e.type='message.posted'
    JOIN messages m ON m.message_id=e.aggregate_id AND m.room_id=i.room_id
    JOIN principals sender ON sender.principal_id=m.actor_id
    LEFT JOIN direct_room_pairs d ON d.room_id=i.room_id
    LEFT JOIN principals peer ON peer.principal_id=CASE WHEN d.left_principal_id=i.participant_id THEN d.right_principal_id ELSE d.left_principal_id END
    LEFT JOIN worker_target_read_positions read ON read.participant_id=i.participant_id
      AND read.room_id=i.room_id AND read.thread_key=COALESCE(m.thread_id,'')
    WHERE i.participant_id=? AND i.state='pending'
      AND NOT (i.room_id=? AND i.event_seq<=?)
      AND i.event_seq>COALESCE(read.through_room_seq,0)
      AND i.event_id NOT IN (SELECT value FROM json_each(?))
    ORDER BY i.created_at DESC, i.rowid DESC LIMIT 21
  `,
    )
    .all(
      text(activation, "participant_id"),
      text(activation, "room_id"),
      integer(activation, "to_seq"),
      JSON.stringify(excluded),
    );
  if (rows.length === 0) return undefined;
  const buckets = new Map<string, Row[]>();
  let shown = 0;
  for (const row of rows.slice(0, 20)) {
    if (row.kind === "direct" && typeof row.peer_handle !== "string") continue;
    const channel =
      row.kind === "direct" ? `dm:@${row.peer_handle}` : `#${row.slug}`;
    // Match the existing Worker target resolver, including its Thread suffix.
    const target = `${channel}${row.thread_id ? `:${row.thread_id}` : ""}`;
    const previous = buckets.get(target) ?? [];
    const candidate = new Map(buckets).set(target, [...previous, row]);
    const output = render(candidate, shown + 1, rows.length > shown + 1);
    if (
      Buffer.byteLength(output, "utf8") > 4096 ||
      Buffer.byteLength(JSON.stringify(output), "utf8") > 5000
    )
      break;
    buckets.set(target, [...previous, row]);
    shown++;
  }
  if (shown === 0) return undefined;
  const output = render(buckets, shown, rows.length > shown);
  const eventIds = [...buckets.values()]
    .flat()
    .map((row) => text(row, "event_id"));
  return {
    eventIds,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(eventIds))
      .digest("hex"),
    text: output,
  };
}

function render(
  buckets: Map<string, Row[]>,
  count: number,
  omitted: boolean,
): string {
  return `[RAH inbox notice:\nInbox update: ${count} unread message${count === 1 ? "" : "s"}${omitted ? " shown (more pending)" : ""}; ${buckets.size} changed target${buckets.size === 1 ? "" : "s"}\n${[
    ...buckets,
  ]
    .map(([target, rows]) => {
      const latest = rows[0]!;
      const first = rows.at(-1)!;
      return `${target}  pending: ${rows.length} message${rows.length === 1 ? "" : "s"} · first msg=${first.message_id} · latest sender @${latest.sender_handle} · latest msg=${latest.message_id}${rows.some((row) => row.reason === "mention") ? " · you were mentioned" : ""}`;
    })
    .join("\n")}]`;
}
