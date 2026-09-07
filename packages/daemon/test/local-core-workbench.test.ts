import {
  ClientWorkspacesListResponseSchema,
  ClientManagedMcpExecutorsListResponseSchema,
} from "@rah-os/protocol";
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
    await running.stop();
    writeFileSync(
      join(workbenchHome, "state", "managed-mcp.json"),
      JSON.stringify({
        schemaVersion: 1,
        executors: [
          {
            executorRef: "owner-fixture",
            transport: {
              kind: "streamable-http",
              url: "https://example.invalid/mcp",
            },
          },
        ],
      }),
      { mode: 0o600 },
    );
    running = await startLocalCoreWorkbench({
      environment: { ...process.env, PATH: binDirectory },
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
    const home = await fetch(running.descriptor.webOrigin);
    const cookie = home.headers.get("set-cookie")!.split(";")[0]!;
    const query = async (path: string, body: object) => {
      const response = await fetch(
        `${running!.descriptor.webOrigin}/v3/client/${path}`,
        {
          method: "POST",
          headers: {
            cookie,
            origin: running!.descriptor.webOrigin,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      assert.equal(response.status, 200);
      return response.json();
    };
    const workspace = ClientWorkspacesListResponseSchema.parse(
      await query("workspaces/list", {}),
    ).workspaces[0]!;
    const mcp = ClientManagedMcpExecutorsListResponseSchema.parse(
      await query("managed-mcp/executors/list", {
        controlRoomId: workspace.controlRoomId,
      }),
    );
    assert.deepEqual(
      mcp.executors.map((entry: { executorRef: string }) => entry.executorRef),
      ["owner-fixture"],
    );
    assert.equal(JSON.stringify(mcp).includes("example.invalid"), false);
    assert.deepEqual(await health.json(), {
      service: "rah-os-local-core",
      state: "online",
    });
  } finally {
    await running?.stop();
    rmSync(directory, { force: true, recursive: true });
  }
});
