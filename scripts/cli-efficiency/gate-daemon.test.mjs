import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateDaemonConfig, gateRuntimeSettings } from "./gate-daemon.mjs";

// Channel homes (evo status §39) are created at room.create; the gate daemon
// keeps them inside its own temporary root, never ~/.loom/channel-workspaces.
test("gate daemon config: channel homes under the gate root, warm switch per arm", () => {
  const root = mkdtempSync(join(tmpdir(), "loom-gate-config-"));
  try {
    const prepared = { config: { schemaVersion: 4, stateDirectory: "/s" } };
    const cold = gateDaemonConfig(prepared, {
      provider: "codex",
      warm: false,
      root,
    });
    assert.equal(
      cold.channelWorkspaceRoot,
      join(realpathSync(root), "channel-workspaces"),
    );
    assert.equal(cold.stateDirectory, "/s");
    assert.deepEqual(cold.warmRuntimes, {
      codex: { enabled: false },
      opencode: { enabled: false },
    });
    assert.deepEqual(
      gateDaemonConfig(prepared, { provider: "claude", warm: true, root })
        .warmRuntimes,
      { claude: { enabled: true } },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Owner 2026-09-27: the product prewarms instances at creation by default.
// Every gate arm measures a cold first round unless it opts in explicitly.
test("gate runtime settings switch instance prewarming off unless the arm opts in", () => {
  assert.deepEqual(gateRuntimeSettings({}), {
    revision: 0,
    prewarm: { enabled: false },
  });
  assert.deepEqual(gateRuntimeSettings({ prewarm: true }), {
    revision: 0,
    prewarm: { enabled: true },
  });
});
