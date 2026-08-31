// Independent browser-audit fault injection. Only the exact disposable fixture
// started by this auditor is allowed. This never edits browser state or a real Host.
import { DatabaseSync } from "node:sqlite";

const fixtureDatabase =
  "/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-os-multi-agent-web-boOFh4/state/room.db";
const fixtureHost = "independent-final-audit-20260831";
const mode = process.argv[2];
if (!["offline", "unknown", "restore"].includes(mode)) {
  throw new Error("Use offline, unknown, or restore");
}
const db = new DatabaseSync(fixtureDatabase);
const host = db
  .prepare(
    "SELECT host_id, state, last_seen_at FROM agent_hosts WHERE host_id = ?",
  )
  .get(fixtureHost);
if (!host) throw new Error("Disposable fixture Host missing");
db.exec("DROP TRIGGER IF EXISTS independent_final_audit_host_observation");
if (mode !== "restore") {
  const state = mode === "offline" ? "offline" : "online";
  const observedMs = Date.now() + (mode === "unknown" ? 3_600_000 : 0);
  const observedAt = new Date(observedMs).toISOString();
  db.prepare(
    "UPDATE agent_hosts SET state = ?, last_seen_at = ?, last_seen_ms = ? WHERE host_id = ?",
  ).run(state, observedAt, observedMs, fixtureHost);
  // Freeze only this synthetic observation while the real fixture API remains up.
  db.exec(`CREATE TRIGGER independent_final_audit_host_observation
    AFTER UPDATE ON agent_hosts WHEN NEW.host_id = '${fixtureHost}'
    BEGIN UPDATE agent_hosts SET state = '${state}', last_seen_at = '${observedAt}',
      last_seen_ms = ${observedMs} WHERE host_id = '${fixtureHost}'; END`);
}
console.log(
  JSON.stringify({
    mode,
    host: db
      .prepare(
        "SELECT host_id, state, last_seen_at FROM agent_hosts WHERE host_id = ?",
      )
      .get(fixtureHost),
  }),
);
db.close();
