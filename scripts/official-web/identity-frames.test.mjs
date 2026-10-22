import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/loom/" + p, "utf8");
test("shared sidebar and role tabs consume reproducible official presentation", async () => {
  const { generateIdentityFrames } =
    await import("./generate-identity-frames.mjs");
  assert.equal(
    read("OfficialIdentityFrames.generated.tsx"),
    generateIdentityFrames(),
  );
  assert.match(read("ChatSidebarFrame.tsx"), /<OfficialSidebarHeader/);
  assert.match(read("RoleWorkspace.tsx"), /<OfficialRoleTabs/);
  assert.doesNotMatch(
    read("ChatSidebarFrame.tsx"),
    /<SidebarHeaderTitle|<PanelTitle/,
  );
});
