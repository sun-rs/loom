import type { DatabaseSync } from "node:sqlite";

import { ConflictError } from "./errors.ts";
import { stringArray, text, type Row } from "./sqlite-row.ts";

/** Kernel-owned conservative admission fence, NOT memory replication.
 * Once a managed Agent may have materialized memory, another Computer must
 * not bootstrap an empty copy. Explicit terminal-proof/export/import handoff
 * is required before changing this home; no automatic takeover is provided.
 */
export function bindManagedAgentMemoryHome(
  database: DatabaseSync,
  participantId: string,
  hostId: string,
  boundAt: string,
): void {
  const managed = database
    .prepare("SELECT 1 FROM agent_definitions WHERE participant_id = ?")
    .get(participantId);
  if (managed === undefined) return;
  assertAgentMemoryHome(database, participantId, hostId);
  database
    .prepare(
      "INSERT OR IGNORE INTO agent_memory_homes(participant_id, owner_host_id, state, bound_at) VALUES(?, ?, 'bound', ?)",
    )
    .run(participantId, hostId, boundAt);
}

export function assertAgentMemoryHome(
  database: DatabaseSync,
  participantId: string,
  hostId: string,
): void {
  const home = database
    .prepare(
      "SELECT owner_host_id, state FROM agent_memory_homes WHERE participant_id = ?",
    )
    .get(participantId);
  if (
    home !== undefined &&
    (home.state !== "bound" || home.owner_host_id !== hostId)
  ) {
    throw new ConflictError(
      `Agent ${participantId} memory home requires verified Computer handoff; refusing empty-memory takeover`,
    );
  }
}

export function memoryHomeEligibleParticipants(
  database: DatabaseSync,
  hostId: string,
  participantIds: string[],
): string[] {
  if (participantIds.length === 0) return [];
  const rows = database
    .prepare(
      `SELECT participant_id FROM agent_memory_homes
     WHERE participant_id IN (${participantIds.map(() => "?").join(",")})
       AND (state <> 'bound' OR owner_host_id <> ?)`,
    )
    .all(...participantIds, hostId);
  const denied = new Set(rows.map((row) => text(row, "participant_id")));
  return participantIds.filter((participantId) => !denied.has(participantId));
}

export function memoryHomeAuthorizedHosts(
  database: DatabaseSync,
  hosts: Row[],
): Array<{ hostId: string; participantIds: string[] }> {
  return hosts.map((host) => ({
    hostId: text(host, "host_id"),
    participantIds: memoryHomeEligibleParticipants(
      database,
      text(host, "host_id"),
      stringArray(host, "participant_ids_json"),
    ),
  }));
}

/** Conservative upgrade: never choose between two historically used homes.
 * Even a failed pre-start run may have prepared files before crashing.
 * Existing pins are immutable and survive deletion of old Run diagnostics.
 */
export function backfillAgentMemoryHomes(database: DatabaseSync): void {
  database.exec(`
    INSERT OR IGNORE INTO agent_memory_homes(participant_id, owner_host_id, state, bound_at)
    SELECT r.participant_id,
      CASE WHEN COUNT(DISTINCT r.host_id) = 1 THEN MIN(r.host_id) ELSE NULL END,
      CASE WHEN COUNT(DISTINCT r.host_id) = 1 THEN 'bound' ELSE 'conflicted' END,
      MIN(r.started_at)
    FROM run_attempts r
    JOIN agent_definitions a ON a.participant_id = r.participant_id
    GROUP BY r.participant_id;
  `);
}
