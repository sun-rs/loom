import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverKnownLocalClis } from "../src/local-runtime-inventory.ts";

test("local CLI discovery resolves executable identity and bounded version without a shell", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-local-cli-discovery-"));
  try {
    for (const [name, version] of [
      ["codex", "codex-cli test"],
      ["kimi", "kimi test"],
    ] as const) {
      const executable = join(directory, name);
      writeFileSync(
        executable,
        `#!/bin/sh\n/usr/bin/printf '%s\\n' '${version}'\n`,
        { mode: 0o700 },
      );
      chmodSync(executable, 0o700);
    }

    const inventory = await discoverKnownLocalClis({
      environment: { PATH: directory },
      versionTimeoutMs: 2_000,
    });
    const codex = inventory.find(({ executable }) => executable === "codex");
    const kimi = inventory.find(({ executable }) => executable === "kimi");
    const claude = inventory.find(({ executable }) => executable === "claude");
    assert.equal(codex?.available, true);
    assert.equal(
      codex?.resolvedExecutablePath,
      realpathSync(join(directory, "codex")),
    );
    assert.equal(codex?.version, "codex-cli test");
    assert.equal(kimi?.version, "kimi test");
    assert.equal(claude?.available, false);
    assert.equal(claude?.configured, false);
    assert.equal(claude?.source, "discovered");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
