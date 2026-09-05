import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  assertUiEvidenceInputSnapshot,
  collectUiEvidenceInputPaths,
  snapshotUiEvidenceInputs,
  uiContractEvidenceInputPaths,
} from "../../../scripts/ui-evidence-inputs.mjs";

test("UI evidence inputs cover the executed product, fixtures and configuration", () => {
  const inputs = collectUiEvidenceInputPaths();
  for (const expected of [
    "apps/web/src/App.tsx",
    "apps/web/test/settings-family-fixture.tsx",
    "packages/kernel/src/room-kernel.ts",
    "packages/client-core/test/room-session.test.ts",
    "scripts/run-multi-agent-web-fixture.mjs",
    "scripts/ui-settings-family-browser-scenarios.mjs",
    "apps/web/vite.config.ts",
    "apps/web/tsconfig.json",
    "packages/kernel/package.json",
    "package-lock.json",
  ])
    assert.ok(inputs.includes(expected), `missing executed input ${expected}`);
  assert.equal(
    inputs.some((path) => path.includes("node_modules")),
    false,
  );
  assert.equal(
    inputs.some((path) => path.includes("dist")),
    false,
  );
  const evidence = uiContractEvidenceInputPaths();
  assert.ok(
    evidence.includes(
      "docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js",
    ),
  );
  assert.ok(
    evidence.includes("packages/raft-ui-snapshot/snapshot-manifest.json"),
  );
});

test("UI evidence snapshots reject changed, added and removed inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-ui-evidence-inputs-"));
  const source = join(root, "source");
  await mkdir(source);
  await writeFile(join(source, "component.ts"), "export const value = 1;\n");
  await writeFile(join(root, "package.json"), "{}\n");
  await writeFile(join(root, "fixture.json"), "{}\n");
  const options = {
    repositoryRoot: root,
    roots: ["source"],
    configs: ["package.json"],
    extraPaths: ["fixture.json"],
  };
  const snapshot = snapshotUiEvidenceInputs(options);
  assert.doesNotThrow(() => assertUiEvidenceInputSnapshot(snapshot, options));

  await writeFile(join(source, "component.ts"), "export const value = 2;\n");
  assert.throws(
    () => assertUiEvidenceInputSnapshot(snapshot, options),
    /changed during test/,
  );
  await writeFile(join(source, "component.ts"), "export const value = 1;\n");
  await writeFile(join(source, "new.ts"), "export {};\n");
  assert.throws(
    () => assertUiEvidenceInputSnapshot(snapshot, options),
    /input file set changed/,
  );
  await rm(join(source, "new.ts"));
  await rm(join(root, "fixture.json"));
  assert.throws(
    () => assertUiEvidenceInputSnapshot(snapshot, options),
    /input file set changed/,
  );
});
