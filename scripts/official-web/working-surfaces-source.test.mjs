import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateWorkingSurfaces140 } from "./generate-working-surfaces140.mjs";
test("working, channel summary, stale notice and Computer rack reproduce the complete pinned release", async () => {
  const r = await generateWorkingSurfaces140(),
    base = "frontends/raft/loom/";
  assert.equal(
    readFileSync(base + "OfficialWorkingSurfaces140.generated.js", "utf8"),
    r.js,
  );
  assert.equal(
    readFileSync(base + "OfficialWorkingSurfaces140.generated.d.ts", "utf8"),
    r.types,
  );
  assert.deepEqual(
    JSON.parse(
      readFileSync(base + "working-surfaces140.provenance.json", "utf8"),
    ),
    r.provenance,
  );
  assert.doesNotMatch(
    r.js,
    /useAgentStore|useMachineStore|pruneExpired|function VWe/,
  );
  assert.match(r.js, /working-now-list/);
  assert.match(r.js, /channel-header-working/);
  assert.match(r.js, /sidebar-stale-notice/);
  assert.match(r.js, /computers-rack-overview/);
  const member = readFileSync(
    base + "OfficialMemberFlow.generated.tsx",
    "utf8",
  );
  assert.match(member, /presence=\{agent.presence\}/);
  assert.match(member, /presence=\{presence\}/);
  assert.doesNotMatch(member, /badge=\{undefined\}/);
});
