import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readLocalWorkbenchMcpConfig } from "../src/local-workbench-mcp-config.ts";
test("local MCP config is explicit, bounded, private and uses existing executor validation", async () => {
  const home = mkdtempSync(join(tmpdir(), "rah-mcp-config-")),
    file = join(home, "managed-mcp.json");
  const executor = {
    executorRef: "local",
    transport: { kind: "streamable-http", url: "http://127.0.0.1:9000/mcp" },
  };
  const put = (data: unknown) =>
    writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
  try {
    assert.deepEqual(await readLocalWorkbenchMcpConfig(home), []);
    put({ schemaVersion: 1, executors: [executor] });
    assert.deepEqual(await readLocalWorkbenchMcpConfig(home), [executor]);
    for (const data of [
      { schemaVersion: 2, executors: [] },
      { schemaVersion: 1, executors: [executor, executor] },
      {
        schemaVersion: 1,
        executors: [{ ...executor, secret: "must-not-echo" }],
      },
      {
        schemaVersion: 1,
        executors: [
          {
            ...executor,
            transport: {
              kind: "streamable-http",
              url: "http://remote.invalid/mcp",
            },
          },
        ],
      },
    ]) {
      put(data);
      await assert.rejects(
        readLocalWorkbenchMcpConfig(home),
        (e) => e instanceof Error && !e.message.includes("must-not-echo"),
      );
    }
    put({ schemaVersion: 1, executors: [] });
    chmodSync(file, 0o644);
    await assert.rejects(readLocalWorkbenchMcpConfig(home));
    chmodSync(file, 0o600);
    writeFileSync(file, " ".repeat(65537));
    await assert.rejects(readLocalWorkbenchMcpConfig(home));
    rmSync(file);
    const target = join(home, "target");
    writeFileSync(target, '{"schemaVersion":1,"executors":[]}', {
      mode: 0o600,
    });
    symlinkSync(target, file);
    await assert.rejects(readLocalWorkbenchMcpConfig(home));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
