import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import type {
  AgentCatalogEntry,
  RuntimeTrajectoryEntry,
} from "@rah-os/protocol";
import { readAgentPresence } from "../src/agent-presence.ts";
import { raftTrajectoryActivity } from "../src/raft-presence-projection.ts";

test("presence entry mapping agrees with the frozen Raft mne function", () => {
  const source = readFileSync(
    new URL(
      "../../../docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a",
  );
  // Evaluate only this reviewed pure function, not the bundle/store/network.
  const from = source.indexOf("function mne(");
  const original = source.slice(from, source.indexOf("function sM(", from));
  const upstream = runInNewContext(
    `(${original})`,
    {
      Vd: (activity: string) => ({ activity }),
      $be: () => "",
      ub: (x: string) => x,
    },
    { timeout: 100 },
  );
  for (const entry of [
    { kind: "thinking", text: "x" },
    { kind: "tool_start", toolName: "bash" },
    { kind: "compaction_started" },
    { kind: "compaction_finished" },
    { kind: "text", text: "not a status" },
    { kind: "system", title: "system", text: "x" },
    ...["online", "offline", "thinking", "working", "error"].map(
      (activity) => ({ kind: "status", activity }),
    ),
  ] as RuntimeTrajectoryEntry[])
    assert.equal(raftTrajectoryActivity(entry), upstream(entry)?.activity);
});

test("presence follows live process/Host lifetime and never resurrects old Run activity", () => {
  const db = new DatabaseSync(":memory:");
  const agent = {
    definition: {
      agentDefinitionId: "agent",
      participantId: "p",
      state: "enabled",
    },
  } as AgentCatalogEntry;
  let clock = 100_000;
  db.exec(`CREATE TABLE agent_hosts(host_id,instance_id,state,last_seen_ms,participant_ids_json);
    CREATE TABLE placements(placement_id,host_instance_id);
    CREATE TABLE activations(activation_id,lease_until_ms);
    CREATE TABLE run_attempts(run_attempt_id,placement_id,activation_id,participant_id,host_id,state,runtime_run_id,started_at);
    CREATE TABLE runtime_processes(run_attempt_id,state,exit_code,runtime_run_id);
    CREATE TABLE run_trajectory_entries(runtime_run_id,run_attempt_id,producer_sequence,entry_json,observed_at);
    INSERT INTO agent_hosts VALUES('h','g1','online',100000,'["p"]');
    INSERT INTO placements VALUES('pl','g1');
    INSERT INTO activations VALUES('a',999999);`);
  const read = () => readAgentPresence(db, agent, new Date(clock));
  try {
    assert.deepEqual(
      { activity: read().activity, reason: read().reason },
      { activity: "online", reason: "online" },
      "a healthy Host makes its enabled resident Agent ready",
    );
    db.exec(`INSERT INTO run_attempts VALUES('r','pl','a','p','h','running','runtime','1970-01-01T00:01:30.000Z');
      INSERT INTO runtime_processes VALUES('r','active',NULL,'runtime');
      INSERT INTO run_trajectory_entries VALUES('runtime','r',5,'{"kind":"status","activity":"thinking"}','1970-01-01T00:01:39.000Z');`);
    assert.deepEqual(
      { activity: read().activity, activityAt: read().activityAt },
      { activity: "thinking", activityAt: "1970-01-01T00:01:39.000Z" },
    );
    db.exec(
      `INSERT INTO run_trajectory_entries VALUES('runtime','r',4,'{"kind":"status","activity":"error"}','1970-01-01T00:01:38.000Z');`,
    );
    assert.equal(
      read().activity,
      "thinking",
      "late older provider fact is not current",
    );
    db.exec(
      `INSERT INTO run_trajectory_entries VALUES('runtime','r',6,'{"kind":"status","activity":"error","subagent":{"subagentType":"child"}}','1970-01-01T00:01:40.000Z');`,
    );
    assert.equal(
      read().activity,
      "thinking",
      "subagent state cannot replace its parent",
    );
    clock += 30000;
    assert.equal(read().reason, "host_offline");
    clock = 100000;
    db.exec("UPDATE agent_hosts SET state='draining'");
    assert.equal(read().reason, "host_draining");
    db.exec("UPDATE agent_hosts SET state='online', instance_id='g2'");
    assert.equal(
      read().reason,
      "unknown",
      "replaced Host generation cannot inherit old busy",
    );
    db.exec(
      "UPDATE agent_hosts SET instance_id='g1'; UPDATE activations SET lease_until_ms=1",
    );
    assert.equal(
      read().reason,
      "unknown",
      "expired execution lease cannot claim current activity",
    );
    db.exec(
      "UPDATE activations SET lease_until_ms=999999; UPDATE runtime_processes SET state='terminated',exit_code=0",
    );
    assert.equal(
      read().reason,
      "online",
      "terminal proof overrides historical thinking",
    );
    db.exec("UPDATE run_attempts SET state='failed'");
    assert.equal(read().activity, "error");
    db.exec(`INSERT INTO run_attempts VALUES('r2','pl','a','p','h','starting','runtime2','1970-01-01T00:01:40.000Z');
      INSERT INTO runtime_processes VALUES('r2','prepared',NULL,'runtime2');`);
    assert.deepEqual(
      { activityAt: read().activityAt, reason: read().reason },
      { activityAt: "1970-01-01T00:01:40.000Z", reason: "starting" },
      "new Run does not inherit old error and carries its activity time",
    );
    db.exec(
      "UPDATE run_attempts SET state='exited'; UPDATE runtime_processes SET state='terminated',exit_code=0",
    );
    assert.equal(read().reason, "online");
    db.exec("UPDATE agent_hosts SET instance_id='g2'");
    assert.equal(
      read().reason,
      "online",
      "a finished Run returns to ready after a healthy Host restart",
    );
    db.exec("UPDATE run_attempts SET state='cancelled'");
    assert.equal(
      read().reason,
      "online",
      "a cancelled Run returns to ready and cannot become unknown after restart",
    );
    assert.equal(
      readAgentPresence(
        db,
        { ...agent, definition: { ...agent.definition, state: "disabled" } },
        new Date(clock),
      ).reason,
      "paused",
    );
    db.exec("DELETE FROM agent_hosts");
    assert.equal(read().reason, "unknown");
  } finally {
    db.close();
  }
});
