import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
test("product has no system-channel creator, settings, endpoint or first-run greeting writer", () => {
  for (const p of [
    "packages/daemon/src/ensure-all-channel.ts",
    "packages/kernel/src/all-channel-membership.ts",
    "frontends/raft/loom/SystemSettings.tsx",
  ])
    assert(!existsSync(p), p);
  for (const p of [
    "packages/daemon/src/local-workbench-bootstrap.ts",
    "packages/kernel/src/room-kernel.ts",
    "packages/kernel/src/workspace-agent-provisioning.ts",
  ])
    assert.doesNotMatch(
      readFileSync(p, "utf8"),
      /ensureAllChannel|reconcileAllChannelMemberships|requestAgentFirstRun/,
    );
  for (const p of [
    "packages/client-sdk/src/index.ts",
    "packages/application-service/src/client-application-service.ts",
  ])
    assert.doesNotMatch(
      readFileSync(p, "utf8"),
      /workspaces\/system-channel|workspace\.system-channel/,
    );
  assert.doesNotMatch(
    readFileSync("frontends/raft/loom/SettingsPage.tsx", "utf8"),
    /SystemSettings/,
  );
});
test("removed system-channel configuration is not a published protocol or a generated UI dependency", async () => {
  const protocol = await import("../../packages/protocol/src/index.ts");
  assert.equal("SystemChannelVisibilityReadSchema" in protocol, false);
  assert.equal(
    protocol.ClientWorkspaceUpdateRequestSchema.safeParse({
      workspaceId: "w",
      name: "w",
      avatarKey: null,
      basedOnControlRoomSeq: 0,
      idempotencyKey: "x",
      agentAllChannelGreetingEnabled: true,
    }).success,
    false,
  );
  assert.doesNotMatch(
    readFileSync("scripts/official-web/generate-settings-sections.mjs", "utf8"),
    /SystemChannelsSection/,
  );
});
