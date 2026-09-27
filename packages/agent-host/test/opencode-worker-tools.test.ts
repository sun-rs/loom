import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LOOM_MCP_SERVER,
  OPENCODE_WORKER_TOOLS_MODE,
  RAH_WORKER_TOOLS_ENV as DRIVER_TOOLS_ENV,
  WORKER_MCP_ARGUMENT as DRIVER_MCP_ARGUMENT,
  openCodeConfigContentWithWorkerTools,
  openCodeWorkerToolCommand,
  resolveOpenCodeMcpNames,
  verifyOpenCodeWorkerTools,
} from "../src/opencode-worker-tools.js";
import {
  RAH_WORKER_TOOLS_ENV,
  WORKER_MCP_ARGUMENT,
  workerToolNames,
} from "../src/index.ts";

/**
 * evo §57 OpenCode wiring helpers, shared by the cold and the warm driver
 * (plain JS, so the constants are restated there and pinned here).
 */
test("the driver constants are the ones the Host and the CLI use", () => {
  assert.equal(DRIVER_TOOLS_ENV, RAH_WORKER_TOOLS_ENV);
  assert.equal(DRIVER_MCP_ARGUMENT, WORKER_MCP_ARGUMENT);
  const names = workerToolNames(OPENCODE_WORKER_TOOLS_MODE)!;
  assert.equal(names.post, `${LOOM_MCP_SERVER}_message_post`);
  assert.equal(names.check, `${LOOM_MCP_SERVER}_message_check`);
});

test("the MCP command exists only when the lease asks for the tools, and needs the Worker CLI", () => {
  assert.equal(openCodeWorkerToolCommand({}), undefined);
  assert.equal(
    openCodeWorkerToolCommand({ RAH_WORKER_CLI: "/opt/loom/rah" }),
    undefined,
  );
  assert.deepEqual(
    openCodeWorkerToolCommand({
      RAH_WORKER_TOOLS: "opencode",
      RAH_WORKER_CLI: "/opt/loom/rah",
    }),
    ["/opt/loom/rah", "__worker-mcp"],
  );
  assert.throws(
    () => openCodeWorkerToolCommand({ RAH_WORKER_TOOLS: "opencode" }),
    /RAH_WORKER_CLI/u,
  );
  assert.throws(
    () =>
      openCodeWorkerToolCommand({
        RAH_WORKER_TOOLS: "opencode",
        RAH_WORKER_CLI: "rah",
      }),
    /absolute/u,
  );
});

test("the config adds loom, switches every other resolved server off and keeps the rest", () => {
  const content = JSON.stringify({
    instructions: ["/tmp/rules.md"],
    mcp: { inherited: { type: "remote", url: "http://127.0.0.1:9/x" } },
  });
  const merged = JSON.parse(
    openCodeConfigContentWithWorkerTools(content, {
      command: ["/opt/loom/rah", "__worker-mcp"],
      names: ["usermarker", "inherited", "loom"],
    }),
  );
  assert.deepEqual(merged, {
    instructions: ["/tmp/rules.md"],
    mcp: {
      inherited: {
        type: "remote",
        url: "http://127.0.0.1:9/x",
        enabled: false,
      },
      usermarker: { enabled: false },
      loom: {
        type: "local",
        command: ["/opt/loom/rah", "__worker-mcp"],
        enabled: true,
      },
    },
  });
  // Only a command path: nothing credential-shaped is written.
  assert.doesNotMatch(JSON.stringify(merged), /token|secret|session/iu);
  assert.throws(
    () =>
      openCodeConfigContentWithWorkerTools("nope", { command: [], names: [] }),
    /not JSON/u,
  );
});

test("the names come from OpenCode's own resolved configuration", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-opencode-config-"));
  try {
    const executable = join(directory, "fake-opencode.mjs");
    writeFileSync(
      executable,
      `#!/usr/bin/env node
if (process.argv.slice(2).join(" ") !== "debug config --pure") process.exit(64);
if (process.env.FAIL === "1") { process.stderr.write("boom"); process.exit(3); }
process.stdout.write(JSON.stringify({ mcp: { usermarker: {}, projmarker: {} }, cwd: process.cwd() }));
`,
    );
    chmodSync(executable, 0o700);
    assert.deepEqual(
      await resolveOpenCodeMcpNames({
        executable,
        env: process.env,
        cwd: directory,
      }),
      ["usermarker", "projmarker"],
    );
    await assert.rejects(
      resolveOpenCodeMcpNames({
        executable,
        env: { ...process.env, FAIL: "1" },
        cwd: directory,
      }),
      /debug config failed \(code=3\): boom/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("verification needs loom connected and every other server disabled", async () => {
  const verify = (answers: unknown[]) =>
    verifyOpenCodeWorkerTools({
      requestJson: async () => answers.shift(),
      delay: async () => undefined,
      timeoutMs: 1_000,
    });
  await verify([
    { loom: { status: "connected" }, usermarker: { status: "disabled" } },
  ]);
  await verify([
    { loom: { status: "pending" } },
    { loom: { status: "connected" } },
  ]);
  await assert.rejects(
    verify([
      { loom: { status: "connected" }, usermarker: { status: "connected" } },
    ]),
    /not disabled: usermarker/u,
  );
  await assert.rejects(
    verify([{ loom: { status: "failed", error: "spawn ENOENT" } }]),
    /is failed: spawn ENOENT/u,
  );
  await assert.rejects(verify([[]]), /no status map/u);
  await assert.rejects(
    verifyOpenCodeWorkerTools({
      requestJson: async () => ({}),
      delay: async () => undefined,
      timeoutMs: 0,
    }),
    /did not connect/u,
  );
});
