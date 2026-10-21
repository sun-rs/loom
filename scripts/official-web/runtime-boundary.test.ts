import test from "node:test";
import assert from "node:assert/strict";
import { assertOfficialRuntimeBoundary } from "../../frontends/raft/loom/runtime-boundary.ts";
test("built chunks cannot contain the original cloud transport or unused full pages", () => {
  for (const file of [
    "api/client.ts",
    "components/profile/ProfilePanel.tsx",
    "components/agent/AgentMcpTab.tsx",
    "components/agent/ChannelMembers.tsx",
    "components/layout/Sidebar.tsx",
    "components/layout/LeftRail.tsx",
  ]) {
    assert.throws(
      () =>
        assertOfficialRuntimeBoundary([
          "/repo/frontends/raft/packages/web/src/" + file,
        ]),
      /Unexpected official runtime dependency/,
    );
  }
});
test("Loom adapters and pinned source inputs are not confused with runtime pages", () => {
  assert.doesNotThrow(() =>
    assertOfficialRuntimeBoundary([
      "/repo/frontends/raft/loom/upstream-api.ts",
      "/repo/frontends/raft/upstream/raft-web-source/packages/web/src/components/layout/LeftRail.tsx",
    ]),
  );
});
