import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { bootstrapStable } from "@rah-os/k-carrier";

import { NodeKCarrierSlotServiceLauncher } from "../src/index.ts";

test("slot launcher executes only K slot bytes with fd-only config and no inherited env", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-k-slot-launcher-"));
  chmodSync(directory, 0o700);
  const stateDir = join(directory, "k");
  const configPath = join(directory, "service-config.json");
  const resultPath = join(directory, "observed.json");
  const sourceArtifactPath = join(directory, "computer-source");
  const fixturePath = join(
    import.meta.dirname,
    "fixtures",
    "k-slot-service-child.mjs",
  );
  await mkdir(stateDir, { mode: 0o700 });
  writeFileSync(
    configPath,
    JSON.stringify({ resultPath, secret: "fd-only-service-secret" }),
    { mode: 0o600 },
  );
  writeFileSync(
    sourceArtifactPath,
    `#!/bin/sh\nexec "${process.execPath}" "${fixturePath}" "$@"\n`,
    { mode: 0o700 },
  );
  chmodSync(sourceArtifactPath, 0o500);
  await bootstrapStable({
    artifactPath: sourceArtifactPath,
    stateDir,
    version: "1.0.0",
  });
  const previous = process.env.RAH_K_SLOT_PARENT_SECRET;
  process.env.RAH_K_SLOT_PARENT_SECRET = "must-not-be-inherited";
  try {
    const launcher = new NodeKCarrierSlotServiceLauncher({
      configurationPath: configPath,
      stateDir,
    });
    const launched = await launcher.launch("stable");
    assert.ok(launched.processId > 0);
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      try {
        const observed = JSON.parse(readFileSync(resultPath, "utf8")) as {
          args: string[];
          inheritedSecret: boolean;
          processId: number;
          secret: string;
        };
        assert.deepEqual(observed.args, [
          "__computer-service",
          "--config-fd=3",
        ]);
        assert.equal(observed.inheritedSecret, false);
        assert.equal(observed.processId, launched.processId);
        assert.equal(observed.secret, "fd-only-service-secret");
        const childProcessGroup = Number.parseInt(
          execFileSync(
            "/bin/ps",
            ["-o", "pgid=", "-p", String(launched.processId)],
            { encoding: "utf8" },
          ).trim(),
          10,
        );
        assert.equal(childProcessGroup, launched.processId);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail("slot service did not consume fd-only configuration");
  } finally {
    if (previous === undefined) delete process.env.RAH_K_SLOT_PARENT_SECRET;
    else process.env.RAH_K_SLOT_PARENT_SECRET = previous;
    rmSync(directory, { force: true, recursive: true });
  }
});
