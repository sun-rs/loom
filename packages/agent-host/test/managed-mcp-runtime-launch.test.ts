import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ManagedMcpCatalogSchema } from "@rah-os/protocol";

import {
  ManagedMcpRuntimeProxyRegistry,
  prepareManagedMcpRuntimeLaunch,
} from "../src/index.ts";

const catalog = ManagedMcpCatalogSchema.parse({
  catalogVersion: 1,
  tools: [
    {
      assignmentVersion: 2,
      configVersion: 4,
      inputSchema: { properties: {}, type: "object" },
      mcpServerId: "room-tools",
      runtimeName: "room-tools",
      serverName: "Room tools",
      toolName: "room.snapshot",
    },
  ],
});

test("managed MCP launch adapter injects Raft-compatible Claude, Codex, Kimi, and OpenCode configuration", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-managed-mcp-launch-"));
  const registry = new ManagedMcpRuntimeProxyRegistry();
  const client = {
    callTool: async () => ({ content: [], isError: false }),
    loadCatalog: async () => catalog,
  };
  try {
    const claude = await prepareManagedMcpRuntimeLaunch({
      adapter: { kind: "claude-cli/v1" },
      client,
      registry,
      temporaryDirectory: directory,
    });
    assert.equal(claude.args?.[0], "--mcp-config");
    const claudePath = claude.args?.[1];
    assert.ok(claudePath);
    const claudeConfig = JSON.parse(await readFile(claudePath, "utf8")) as {
      mcpServers: Record<string, { type: string; url: string }>;
    };
    const claudeEntry = Object.entries(claudeConfig.mcpServers)[0];
    assert.ok(claudeEntry);
    assert.match(claudeEntry[0], /^rm[a-zA-Z0-9]{6}$/u);
    assert.deepEqual(claudeEntry[1], {
      type: "http",
      url: claudeEntry[1].url,
    });
    assert.match(claudeEntry[1].url, /^http:\/\/127\.0\.0\.1:/u);
    await claude.release?.();
    await assert.rejects(access(claudePath));
    assert.equal((await fetch(claudeEntry[1].url)).status, 404);

    const codex = await prepareManagedMcpRuntimeLaunch({
      adapter: { kind: "codex-cli/v1" },
      client,
      registry,
      temporaryDirectory: directory,
    });
    assert.deepEqual(codex.args?.slice(0, 1), ["-c"]);
    assert.match(
      codex.args?.[1] ?? "",
      /^mcp_servers\.rm[a-zA-Z0-9]{6}\.url="http:\/\/127\.0\.0\.1:/u,
    );
    await codex.release?.();

    const kimi = await prepareManagedMcpRuntimeLaunch({
      adapter: { kind: "kimi-cli/v1" },
      client,
      registry,
      temporaryDirectory: directory,
    });
    assert.equal(kimi.args?.[0], "--mcp-config-file");
    const kimiPath = kimi.args?.[1];
    assert.ok(kimiPath);
    const kimiConfig = JSON.parse(await readFile(kimiPath, "utf8")) as {
      mcpServers: Record<string, { transport: string; url: string }>;
    };
    assert.deepEqual(Object.values(kimiConfig.mcpServers)[0], {
      transport: "http",
      url: Object.values(kimiConfig.mcpServers)[0]!.url,
    });
    await kimi.release?.();
    await assert.rejects(access(kimiPath));

    const opencode = await prepareManagedMcpRuntimeLaunch({
      adapter: { kind: "opencode-cli/v1" },
      client,
      existingEnvironment: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          mcp: { user: { enabled: true, type: "local" } },
          provider: { existing: true },
        }),
      },
      registry,
      temporaryDirectory: directory,
    });
    assert.deepEqual(opencode.args, []);
    const opencodeConfig = JSON.parse(
      opencode.env.OPENCODE_CONFIG_CONTENT!,
    ) as {
      mcp: Record<string, Record<string, unknown>>;
      provider: { existing: boolean };
    };
    assert.deepEqual(opencodeConfig.provider, { existing: true });
    assert.deepEqual(opencodeConfig.mcp.user, {
      enabled: true,
      type: "local",
    });
    const managedEntry = Object.entries(opencodeConfig.mcp).find(([name]) =>
      /^rm[a-zA-Z0-9]{6}$/u.test(name),
    );
    assert.ok(managedEntry);
    assert.deepEqual(managedEntry[1], {
      enabled: true,
      type: "remote",
      url: managedEntry[1].url,
    });
    await opencode.release?.();
  } finally {
    await registry.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("managed MCP discovery failure is fail-open but visible to Runtime diagnostics", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-managed-mcp-warning-"));
  const registry = new ManagedMcpRuntimeProxyRegistry();
  try {
    const lease = await prepareManagedMcpRuntimeLaunch({
      adapter: { kind: "codex-cli/v1" },
      client: {
        callTool: async () => ({ content: [], isError: false }),
        loadCatalog: async () => {
          throw new Error("secret-bearing upstream detail");
        },
      },
      registry,
      temporaryDirectory: directory,
    });
    assert.deepEqual(lease.args, []);
    assert.deepEqual(lease.env, {});
    assert.deepEqual(lease.diagnostics, [
      "Managed MCP discovery unavailable [reason=discovery_failed]",
    ]);
    assert.equal(JSON.stringify(lease).includes("secret-bearing"), false);
  } finally {
    await registry.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
