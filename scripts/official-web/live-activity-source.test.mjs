import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const read = (p) => readFileSync(p, "utf8");
test("live activity imports presentation without upstream connected state", () => {
  assert.match(
    read("frontends/raft/loom/AppearanceRuntime.tsx"),
    /OfficialWorkingSurfaces140.generated/,
  );
  assert.doesNotMatch(
    read("frontends/raft/loom/ChannelSidebar.tsx"),
    /LoomLiveActivity/,
  );
});
test("older official source matches original intake hash and generated port has no connected store", async () => {
  const dir = "frontends/raft/upstream/compatibility/live-activity/";
  const provenance = JSON.parse(read(dir + "provenance.json"));
  const adoption = JSON.parse(read("frontends/raft/adoption.json"));
  assert.equal(provenance.revision, adoption.revision);
  assert.equal(provenance.sha256, adoption.files[provenance.sourcePath]);
  assert.equal(
    createHash("sha256")
      .update(read(dir + "LiveAgentActivityBar.tsx"))
      .digest("hex"),
    provenance.sha256,
  );
  const { generateLiveActivity } = await import("./generate-live-activity.mjs");
  const output = generateLiveActivity();
  assert.equal(
    read("frontends/raft/loom/OfficialLiveActivity.generated.tsx"),
    output,
  );
  assert.doesNotMatch(
    output,
    /useLiveAgentActivityStore|ConnectedLiveAgentActivityBar|theme-brutal:/,
  );
});
