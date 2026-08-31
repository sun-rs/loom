import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startLocalCoreWorkbench } from "../src/local-core-workbench.ts";

test("one local Core owner composes persistent daemon and loopback gateway", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-local-core-owner-"));
  const binDirectory = join(directory, "bin");
  const staticDirectory = join(directory, "dist");
  const workbenchHome = join(directory, "home");
  const workspaceCwd = join(directory, "workspace");
  mkdirSync(binDirectory, { mode: 0o700 });
  mkdirSync(staticDirectory, { mode: 0o700 });
  mkdirSync(workspaceCwd, { mode: 0o700 });
  writeFileSync(join(staticDirectory, "index.html"), "<!doctype html>RAH");
  const codexPath = join(binDirectory, "codex");
  writeFileSync(
    codexPath,
    `#!${process.execPath}
const args = process.argv.slice(2).join(" ");
if (args === "--version") process.stdout.write("codex-core-owner\\n");
else if (args === "debug models --bundled") process.stdout.write(JSON.stringify({models:[{slug:"gpt-owner",visibility:"list",supported_in_api:true,supported_reasoning_levels:[{effort:"low"}],service_tiers:[]}]}));
else process.exitCode = 2;
`,
    { mode: 0o700 },
  );
  chmodSync(codexPath, 0o700);
  let running;
  try {
    running = await startLocalCoreWorkbench({
      environment: {
        ...process.env,
        PATH: binDirectory,
      },
      mode: { kind: "loopback", port: 0 },
      staticDirectory,
      workbenchHome,
      workspaceCwd,
    });
    assert.equal(running.descriptor.persistent, true);
    assert.equal(running.descriptor.runtimes.length, 1);
    assert.equal(running.descriptor.runtimes[0]?.cliId, "codex");
    assert.equal(
      running.descriptor.stateDirectory,
      join(workbenchHome, "state"),
    );
    const health = await fetch(`${running.descriptor.webOrigin}/_rah/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      service: "rah-os-local-core",
      state: "online",
    });
  } finally {
    await running?.stop();
    rmSync(directory, { force: true, recursive: true });
  }
});
