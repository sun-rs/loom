import test from "node:test";
import assert from "node:assert/strict";
import { createAgentFacet } from "../../frontends/raft/adapter123/agent-facets.ts";
test("Role sidebar and Computer member list are different facets of one native read cache, without identity inference or unstable snapshots", () => {
  const facts = new Map([
    ["same-name-role", "role"],
    ["same-name-instance", "instance"],
  ]);
  const classify = (id: string) =>
    facts.get(id) as "role" | "instance" | undefined;
  const roles = createAgentFacet("role", classify),
    instances = createAgentFacet("instance", classify),
    rows = [
      { id: "same-name-role", name: "Tom" },
      { id: "same-name-instance", name: "Tom" },
      { id: "unknown", name: "Tom" },
    ];
  assert.deepEqual(roles(rows), [rows[0]]);
  assert.deepEqual(instances(rows), [rows[1]]);
  assert.equal(roles(rows), roles(rows));
  assert.notEqual(roles([...rows]), roles(rows));
  assert.equal(rows.length, 3);
});
