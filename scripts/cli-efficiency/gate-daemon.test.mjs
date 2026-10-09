import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gateDaemonConfig,
  gateRuntimeSettings,
  gateRuntimeSpec,
} from "./gate-daemon.mjs";

test("ordinary Codex gate explicitly selects exec while existing gates retain their transport", () => {
  const input = {
    provider: "codex",
    cwd: "/tmp/work",
    effort: "low",
    shimPath: "/tmp/guard",
  };
  assert.equal(gateRuntimeSpec(input).adapterKind, "codex-app-server/v1");
  const ordinary = gateRuntimeSpec({
    ...input,
    shimOptions: { execTransport: "codex-exec/v1" },
  });
  assert.equal(ordinary.adapterKind, "codex-exec/v1");
  assert.equal(ordinary.executable, input.shimPath);
  assert.equal(ordinary.modelCatalogProbe.kind, "codex-cli/v1");
  assert.equal(ordinary.reasoning, "low");
  assert.throws(() =>
    gateRuntimeSpec({
      ...input,
      provider: "claude",
      shimOptions: { execTransport: "codex-exec/v1" },
    }),
  );
});

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

// Owner 2026-09-27: instance prewarming is off by default; the gate states it
// explicitly, so every arm measures a cold first round unless it opts in.
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
