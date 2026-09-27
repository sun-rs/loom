import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  openCodeConfigContentWithUserMcpDisabled,
  resolveOpenCodeMcpNames,
  verifyOpenCodeUserMcpDisabled,
} from "../src/opencode-user-mcp.js";

/**
 * evo §57/§59: every OpenCode launch (cold and warm driver) switches the
 * user's MCP servers off by name. The names come from OpenCode's own
 * resolution; the switch is process-only; `GET /mcp` proves it.
 */
test("the config switches every resolved server off and keeps the rest", () => {
  const content = JSON.stringify({
    instructions: ["/tmp/rules.md"],
    mcp: { inherited: { type: "remote", url: "http://127.0.0.1:9/x" } },
  });
  assert.deepEqual(
    JSON.parse(
      openCodeConfigContentWithUserMcpDisabled(content, [
        "usermarker",
        "inherited",
      ]),
    ),
    {
      instructions: ["/tmp/rules.md"],
      mcp: {
        inherited: {
          type: "remote",
          url: "http://127.0.0.1:9/x",
          enabled: false,
        },
        usermarker: { enabled: false },
      },
    },
  );
  // No server resolved: the launch content is unchanged.
  assert.equal(openCodeConfigContentWithUserMcpDisabled(content, []), content);
  assert.throws(
    () => openCodeConfigContentWithUserMcpDisabled("nope", ["x"]),
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
if (process.env.EMPTY === "1") { process.stdout.write("{}"); process.exit(0); }
process.stdout.write(JSON.stringify({ mcp: { usermarker: {}, projmarker: {} }, cwd: process.cwd() }));
`,
    );
    chmodSync(executable, 0o700);
    const resolve = (env: NodeJS.ProcessEnv) =>
      resolveOpenCodeMcpNames({ executable, env, cwd: directory });
    assert.deepEqual(await resolve(process.env), ["usermarker", "projmarker"]);
    assert.deepEqual(await resolve({ ...process.env, EMPTY: "1" }), []);
    await assert.rejects(
      resolve({ ...process.env, FAIL: "1" }),
      /debug config failed \(code=3\): boom/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("verification needs every MCP server disabled", async () => {
  const verify = (answer: unknown) =>
    verifyOpenCodeUserMcpDisabled({ requestJson: async () => answer });
  await verify({});
  await verify({ usermarker: { status: "disabled" } });
  await assert.rejects(
    verify({
      usermarker: { status: "disabled" },
      pluginmarker: { status: "connected" },
    }),
    /not disabled: pluginmarker/u,
  );
  await assert.rejects(verify([]), /no status map/u);
});
