import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kimiWorkerMcpLease } from "../src/cold-worker-mcp-lease.ts";

test("cold Kimi owns private internal-only config and original Run bridge revoked on release", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kimi-lease-"));
  let released = 0;
  try {
    const token = join(dir, "token");
    await writeFile(token, "original-secret", { mode: 0o600 });
    const lease = await kimiWorkerMcpLease("original", {
      env: {
        RAH_WORKER_SESSION_FILE: token,
        RAH_WORKER_API_URL: "http://127.0.0.1:1",
      },
      release: () => {
        released++;
      },
    });
    assert.equal(lease.env.LOOM_WORKER_MCP_IDENTITY, "cold-stdio/v1");
    const args = lease.args!;
    assert.equal(args[0], "--mcp-config-file");
    const path = args[1]!;
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const text = await readFile(path, "utf8"),
      config = JSON.parse(text);
    assert.deepEqual(Object.keys(config.mcpServers), ["loom_worker"]);
    assert.equal(text.includes("original-secret"), false);
    assert.equal(text.includes(lease.env.LOOM_WORKER_MCP_SECRET!), false);
    await lease.release?.();
    await lease.release?.();
    assert.equal(released, 1);
    await assert.rejects(stat(path));
    await assert.rejects(stat(lease.env.LOOM_WORKER_MCP_SOCKET!));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
