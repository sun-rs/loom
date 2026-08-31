import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveRuntimeToolAccessLaunch,
  supportedRuntimeToolAccessModes,
} from "../src/runtime-tool-access.ts";

test("standard RuntimeOffers publish only Raft-compatible unattended access", () => {
  for (const [adapterKind, probeKind] of [
    ["codex-app-server/v1", "codex-cli/v1"],
    ["kimi-acp/v1", "kimi-cli/v1"],
    ["claude-stream-json/v1", "claude-cli/v1"],
    ["generic-process/v1", "codex-cli/v1"],
    ["generic-process/v1", "kimi-cli/v1"],
    ["generic-process/v1", "opencode-cli/v1"],
    ["opencode-server/v1", "opencode-cli/v1"],
    ["unknown/v1", undefined],
  ] as const) {
    assert.deepEqual(supportedRuntimeToolAccessModes(adapterKind, probeKind), [
      "full_access",
    ]);
  }
});

test("provider-native unattended mappings follow the Raft policy without a shell", () => {
  assert.deepEqual(
    resolveRuntimeToolAccessLaunch("claude-cli/v1", "full_access"),
    {
      args: [
        "--allow-dangerously-skip-permissions",
        "--dangerously-skip-permissions",
        "--permission-mode",
        "bypassPermissions",
      ],
      env: {},
    },
  );

  assert.deepEqual(
    resolveRuntimeToolAccessLaunch("codex-cli/v1", "full_access"),
    { args: ["--sandbox", "danger-full-access"], env: {} },
  );

  assert.deepEqual(
    resolveRuntimeToolAccessLaunch("kimi-cli/v1", "full_access"),
    {
      args: ["--yolo"],
      env: {},
    },
  );
  const openCode = resolveRuntimeToolAccessLaunch(
    "opencode-cli/v1",
    "full_access",
  );
  assert.deepEqual(openCode.args, ["--auto"]);
  assert.deepEqual(JSON.parse(openCode.env.OPENCODE_PERMISSION!), {
    "*": "allow",
  });
});

test("restricted modes are not part of the Raft-compatible product path", () => {
  assert.deepEqual(resolveRuntimeToolAccessLaunch(undefined, "full_access"), {
    args: [],
    env: {},
  });
  for (const probeKind of [
    "claude-cli/v1",
    "codex-cli/v1",
    "kimi-cli/v1",
    "opencode-cli/v1",
    "unknown/v1",
    undefined,
  ]) {
    for (const mode of ["read_only", "workspace_write"] as const) {
      assert.throws(
        () => resolveRuntimeToolAccessLaunch(probeKind, mode),
        /standard Raft policy requires full_access/u,
      );
    }
  }
});
