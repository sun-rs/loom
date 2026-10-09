import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeProfileManifestV3Schema } from "../src/index.ts";

const manifest = {
  manifestVersion: 3,
  runtimeProfileId: "ordinary-codex",
  displayName: "Ordinary Codex exec",
  protocolFamily: "rah-worker-process/v1",
  adapter: {
    kind: "codex-exec/v1",
    executable: "codex",
    fixedArgs: [],
    config: {},
  },
  staticEnv: {},
  credentialSlots: [],
  declaredCapabilities: ["worker_commands"],
  recoveryDrivers: [],
  workspacePolicy: { allowedModes: ["in_place"] },
  modelCatalogProbe: { kind: "codex-cli/v1" },
};

test("ordinary Codex exec is an explicit profile, separate from app-server", () => {
  const parsed = RuntimeProfileManifestV3Schema.parse(manifest);
  assert.equal(parsed.adapter.kind, "codex-exec/v1");
  assert.equal(
    RuntimeProfileManifestV3Schema.parse({
      ...manifest,
      adapter: { ...manifest.adapter, kind: "codex-app-server/v1" },
    }).adapter.kind,
    "codex-app-server/v1",
  );
});

test("ordinary Codex cannot bind another provider's model catalog", () => {
  assert.equal(
    RuntimeProfileManifestV3Schema.safeParse({
      ...manifest,
      modelCatalogProbe: { kind: "claude-cli/v1" },
    }).success,
    false,
  );
});
