import { DatabaseSync } from "node:sqlite";
import { ClientWorkspacesListResponseSchema } from "@rah-os/protocol";
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

import { startRestartableLocalCoreWorkbench as startLocalCoreWorkbench } from "../src/restartable-local-workbench.ts";

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
      "retired configuration must never be parsed or followed",
      { mode: 0o600 },
    );
    running = await startLocalCoreWorkbench({
      environment: { ...process.env, PATH: binDirectory },
      mode: { kind: "loopback", port: 0 },
      staticDirectory,
      workbenchHome,
      workspaceCwd,
    });
    const origin = running.descriptor.webOrigin;
    const homeBefore = await fetch(origin);
    const authCookie = homeBefore.headers.get("set-cookie")!.split(";")[0]!;
    const status = async () =>
      (
        await fetch(`${origin}/_rah/service`, {
          headers: { cookie: authCookie },
        })
      ).json() as Promise<{ generation: string; state: string }>;
    const hostInstance = () => {
      const db = new DatabaseSync(
        join(running!.descriptor.stateDirectory, "room.db"),
        { readOnly: true },
      );
      try {
        return db
          .prepare("SELECT instance_id FROM agent_hosts WHERE state = 'online'")
          .get()!.instance_id;
      } finally {
        db.close();
      }
    };
    const beforeHost = hostInstance();
    const before = await status();
    const restart = (
      headers: Record<string, string>,
      generation = before.generation,
    ) =>
      fetch(`${origin}/_rah/service/restart`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ generation }),
      });
    assert.equal((await restart({ origin })).status, 401);
    assert.equal(
      (await restart({ cookie: authCookie, origin: "https://evil.invalid" }))
        .status,
      403,
    );
    assert.equal(
      (await restart({ cookie: authCookie, origin }, "obsolete")).status,
      409,
    );
    const db = new DatabaseSync(
      join(running.descriptor.stateDirectory, "room.db"),
    );
    try {
      const human = db
        .prepare("SELECT principal_id FROM principals LIMIT 1")
        .get()!.principal_id;
      db.prepare(
        "INSERT INTO agent_exclusive_operation_leases (lease_id, operation_id, participant_id, kind, owner_host_id, owner_host_instance_id, state, acquired_at, renewed_at, lease_until, lease_until_ms) VALUES ('restart-fixture', 'restart-fixture', ?, 'execution_restart', 'fixture', 'fixture', 'active', '2026-01-01', '2026-01-01', '2099-01-01', 4070908800000)",
      ).run(human!);
      assert.equal(
        (await restart({ cookie: authCookie, origin })).status,
        409,
        "active work blocks restart",
      );
      assert.equal((await status()).generation, before.generation);
      db.prepare(
        "DELETE FROM agent_exclusive_operation_leases WHERE lease_id = 'restart-fixture'",
      ).run();
    } finally {
      db.close();
    }
    assert.equal((await restart({ cookie: authCookie, origin })).status, 202);
    const deadline = Date.now() + 30_000;
    let after = before;
    while (Date.now() < deadline) {
      try {
        after = await status();
        if (after.generation !== before.generation && after.state === "online")
          break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.notEqual(
      after.generation,
      before.generation,
      "full service restarted at the same URL",
    );
    assert.equal(
      (await restart({ cookie: authCookie, origin })).status,
      409,
      "lost receipt retry cannot restart the successor",
    );
    assert.notEqual(
      hostInstance(),
      beforeHost,
      "AgentHost was actually reconstructed",
    );
    assert.equal(running.descriptor.webOrigin, origin);
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
    assert.ok(workspace.workspaceId);
    const retired = await fetch(
      `${origin}/v3/client/managed-mcp/executors/list`,
      {
        method: "POST",
        headers: {
          cookie: authCookie,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ controlRoomId: workspace.controlRoomId }),
      },
    );
    assert.equal(retired.status, 404);
    assert.deepEqual(await health.json(), {
      service: "rah-os-local-core",
      state: "online",
    });
  } finally {
    await running?.stop();
    rmSync(directory, { force: true, recursive: true });
  }
});
