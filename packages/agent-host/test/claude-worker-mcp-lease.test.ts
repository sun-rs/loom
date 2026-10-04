import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeWorkerMcpLease } from "../src/claude-worker-mcp-lease.ts";

test("cold Claude lease keeps original credential private and releases both capabilities once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cmcp-test-"));
  const token = join(dir, "token");
  let releases = 0;
  try {
    await writeFile(token, "original-secret", { mode: 0o600 });
    const lease = await claudeWorkerMcpLease("run-original", {
      env: {
        RAH_WORKER_SESSION_FILE: token,
        RAH_WORKER_API_URL: "http://127.0.0.1:9999",
      },
      release: () => {
        releases++;
      },
    });
    assert.ok(lease.env.LOOM_WORKER_MCP_SECRET);
    assert.ok(lease.env.LOOM_WORKER_MCP_SOCKET);
    assert.equal(
      (await stat(lease.env.LOOM_WORKER_MCP_SOCKET!)).mode & 0o777,
      0o600,
    );
    const args = lease.args ?? [];
    assert.equal(args[0], "--mcp-config");
    assert.equal(JSON.stringify(args).includes("original-secret"), false);
    assert.equal(
      JSON.stringify(args).includes(lease.env.LOOM_WORKER_MCP_SECRET!),
      false,
    );
    const config = JSON.parse(args[1]!);
    assert.deepEqual(Object.keys(config.mcpServers), ["loom_worker"]);
    await lease.release?.();
    await lease.release?.();
    assert.equal(releases, 1);
    await assert.rejects(stat(lease.env.LOOM_WORKER_MCP_SOCKET!));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("no credential leaves fixture lease untouched; incomplete authority and external config fail closed", async () => {
  const empty = { env: {} };
  assert.equal(await claudeWorkerMcpLease("run", empty), empty);
  let released = 0;
  await assert.rejects(
    claudeWorkerMcpLease("run", {
      env: { RAH_WORKER_API_URL: "http://localhost" },
      release: () => {
        released++;
      },
    }),
  );
  assert.equal(released, 1);
  await assert.rejects(
    claudeWorkerMcpLease("run", {
      args: ["--mcp-config", "{}"],
      env: {
        RAH_WORKER_API_URL: "http://localhost",
        RAH_WORKER_SESSION_FILE: "/missing",
      },
    }),
  );
});
