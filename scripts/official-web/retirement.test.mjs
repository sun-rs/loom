import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("official source is the only tracked product UI; client owners survive console retirement", async () => {
  const old = execFileSync(
    "git",
    [
      "ls-files",
      "--",
      "apps/web",
      "packages/ui-web",
      "packages/ui-tokens",
      "packages/raft-ui-snapshot",
    ],
    { encoding: "utf8" },
  );
  assert.equal(
    old.trim(),
    "",
    "Reconstructed UI must not remain in the active tree",
  );
  for (const path of [
    "frontends/raft/packages/web/src/App.tsx",
    "packages/client-sdk/src/index.ts",
    "packages/client-core/src/index.ts",
  ])
    await access(path);
  for (const path of [
    "apps/console",
    "scripts/run-console-browser-gate.mjs",
    "apps/web",
    "packages/ui-web",
    "packages/ui-tokens",
    "packages/raft-ui-snapshot",
  ]) {
    await assert.rejects(access(path), { code: "ENOENT" });
  }
  const { scripts } = JSON.parse(await readFile("package.json", "utf8"));
  assert.ok(
    !Object.values(scripts).some((s) =>
      [
        "@rah-os/console",
        "apps/console",
        "test:console",
        "@rah-os/web",
        "apps/web",
        "packages/ui-web",
        "packages/ui-tokens",
        "packages/raft-ui-snapshot",
      ].some((path) => s.includes(path)),
    ),
  );
  assert.match(scripts["build:web:workbench"], /build-product-web/);
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  assert.ok(!lock.packages["apps/console"]);
  assert.ok(!lock.packages["node_modules/@rah-os/console"]);
});
