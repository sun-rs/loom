import type { DatabaseSync } from "node:sqlite";
import {
  AgentPresenceSchema,
  type AgentPresence,
  type AgentCatalogEntry,
} from "@rah-os/protocol";
import { raftTrajectoryActivity } from "./raft-presence-projection.ts";
import { readAgentTrajectoryVersion } from "./runtime-trajectory.ts";

/** Caller enforces catalog ACL. No new state table or timeline paging. */
export function readAgentPresence(
  database: DatabaseSync,
  agent: AgentCatalogEntry,
  now: Date,
): AgentPresence {
  const result = (
    activity: AgentPresence["activity"],
    reason: AgentPresence["reason"],
    activityAt?: string,
  ) =>
    AgentPresenceSchema.parse({
      agentDefinitionId: agent.definition.agentDefinitionId,
      trajectoryVersion: readAgentTrajectoryVersion(
        database,
        agent.definition.participantId,
      ),
      activity,
      ...(activityAt ? { activityAt } : {}),
      reason,
    });
  if (agent.definition.state !== "enabled") return result("offline", "paused");
  const runSql = `
    SELECT r.*, COALESCE(r.runtime_run_id, p.runtime_run_id) AS observed_runtime_run_id,
           p.state AS process_state, p.exit_code AS process_exit_code,
           a.lease_until_ms, pl.host_instance_id
    FROM run_attempts r
    JOIN activations a ON a.activation_id = r.activation_id
    LEFT JOIN runtime_processes p ON p.run_attempt_id = r.run_attempt_id
    LEFT JOIN placements pl ON pl.placement_id = r.placement_id
    WHERE r.participant_id = ?`;
  const run =
    database
      .prepare(
        `${runSql} AND r.state IN ('starting','running','orphaned') ORDER BY r.rowid DESC LIMIT 1`,
      )
      .get(agent.definition.participantId) ??
    database
      .prepare(`${runSql} ORDER BY r.rowid DESC LIMIT 1`)
      .get(agent.definition.participantId);
  const hosts = run
    ? database
        .prepare("SELECT * FROM agent_hosts WHERE host_id = ?")
        .all(run.host_id!)
    : database
        .prepare(
          `SELECT h.* FROM agent_hosts h
      WHERE EXISTS (SELECT 1 FROM json_each(h.participant_ids_json) WHERE value = ?)
      ORDER BY h.last_seen_ms DESC LIMIT 2`,
        )
        .all(agent.definition.participantId);
  const host = hosts.length === 1 ? hosts[0] : undefined;
  if (!host) return result("offline", "unknown");
  const age = now.getTime() - Number(host.last_seen_ms);
  if (!Number.isFinite(age) || age < 0) return result("offline", "unknown");
  if (host.state === "offline" || age >= 30_000)
    return result("offline", "host_offline");
  if (host.state === "draining") return result("offline", "host_draining");
  if (!run) return result("online", "online");
  // Finished execution is durable evidence, not an observation owned by the
  // incumbent Host generation. A healthy restart must not erase that fact.
  if (["exited", "cancelled"].includes(String(run.state)))
    return result("online", "online");
  if (run.host_instance_id != null && run.host_instance_id !== host.instance_id)
    return result("offline", "unknown");
  if (["failed", "timed_out", "orphaned"].includes(String(run.state)))
    return result("error", "error");
  if (run.process_state === "terminated")
    return run.process_exit_code != null && Number(run.process_exit_code) !== 0
      ? result("error", "error")
      : result("online", "online");
  if (run.lease_until_ms == null || Number(run.lease_until_ms) <= now.getTime())
    return result("offline", "unknown");
  // Producer order, not arrival timestamp: delayed old entries stay historical.
  const latest =
    run.observed_runtime_run_id == null
      ? undefined
      : database
          .prepare(
            `
    SELECT entry_json, observed_at FROM run_trajectory_entries
    WHERE runtime_run_id = ? AND run_attempt_id = ?
      AND json_extract(entry_json, '$.subagent') IS NULL
      AND json_extract(entry_json, '$.kind') IN ('thinking','tool_start','compaction_started','compaction_finished','status')
    ORDER BY producer_sequence DESC LIMIT 1`,
          )
          .get(run.observed_runtime_run_id, run.run_attempt_id!);
  if (latest) {
    const entry = JSON.parse(String(latest.entry_json));
    const activity = raftTrajectoryActivity(entry);
    if (activity)
      return result(
        activity,
        activity === "offline"
          ? "idle"
          : activity === "working" && entry.detailKind === "starting"
            ? "starting"
            : activity,
        String(latest.observed_at),
      );
  }
  return result(
    "working",
    run.state === "starting" ? "starting" : "working",
    String(run.started_at),
  );
}
