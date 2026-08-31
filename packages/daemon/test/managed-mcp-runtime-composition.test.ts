import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GenericProcessAdapter,
  ManagedMcpRuntimeProxyRegistry,
  RuntimeCredentialEnvironmentBinding,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import type { WorkerApplicationService } from "@rah-os/application-service";
import { RoomKernel } from "@rah-os/kernel";
import type { RuntimeProfileManifestV2 } from "@rah-os/protocol";

import { createConfiguredRuntime } from "../src/runtime-profile-composition.ts";

const mcpClientModuleUrl = import.meta.resolve("@modelcontextprotocol/client");
const childScript = `
const { readFile } = await import("node:fs/promises");
const override = process.argv.find((argument) => argument.startsWith("mcp_servers."));
if (!override) throw new Error("managed MCP Codex override is missing");
const url = JSON.parse(override.slice(override.indexOf("=") + 1));
const { Client, StreamableHTTPClientTransport } = await import(${JSON.stringify(mcpClientModuleUrl)});
const client = new Client({ name: "rah-managed-mcp-runtime-gate", version: "1.0.0" });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const catalog = await client.listTools();
  const result = await client.callTool({
    arguments: { roomId: "room-composition" },
    name: catalog.tools[0].name,
  });
  const memoryIndexPath = process.env.RAH_AGENT_MEMORY_INDEX;
  process.stdout.write(JSON.stringify({
    memory: await readFile(memoryIndexPath, "utf8"),
    memoryDirectory: process.env.RAH_AGENT_MEMORY_DIR,
    memoryIndexPath,
    result,
    tools: catalog.tools.map(({ name }) => name),
    url,
  }));
} finally {
  await client.close();
}
`;

function manifest(): RuntimeProfileManifestV2 {
  return {
    adapter: {
      config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
      executable: process.execPath,
      fixedArgs: ["--input-type=module", "-e", childScript, "--"],
      kind: "generic-process/v1",
    },
    credentialSlots: [],
    declaredCapabilities: ["worker_commands"],
    displayName: "Managed MCP composition fixture",
    managedMcpAdapter: { kind: "codex-cli/v1" },
    manifestVersion: 2,
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: "managed-mcp-composition",
    staticEnv: {},
    workspacePolicy: { allowedModes: ["in_place"] },
  };
}

test("configured Runtime exposes a version-fenced managed MCP tool to a real child process", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-mcp-composition-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const profileRegistry = new RuntimeProfileRegistry({
    databasePath: join(directory, "runtime-registry.db"),
    hostId: "managed-mcp-composition-host",
  });
  const proxyRegistry = new ManagedMcpRuntimeProxyRegistry();
  const workerRequests: Array<{
    body: Record<string, unknown>;
    path: string;
    token: string | undefined;
  }> = [];
  const workerServer = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
    workerRequests.push({
      body,
      path: request.url ?? "",
      token: request.headers.authorization,
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify(
        request.url === "/v1/worker/mcp/tools"
          ? {
              catalogVersion: 1,
              tools: [
                {
                  assignmentVersion: 3,
                  configVersion: 7,
                  inputSchema: {
                    properties: { roomId: { type: "string" } },
                    required: ["roomId"],
                    type: "object",
                  },
                  mcpServerId: "room-tools",
                  runtimeName: "room-tools",
                  serverName: "Room tools",
                  toolName: "room.snapshot",
                },
              ],
            }
          : {
              content: [{ text: "canonical Room snapshot", type: "text" }],
              isError: false,
              structuredContent: { roomId: "room-composition" },
            },
      ),
    );
  });
  let revoked = 0;
  try {
    kernel.initialize();
    profileRegistry.initialize();
    await new Promise<void>((resolve, reject) => {
      workerServer.once("error", reject);
      workerServer.listen(0, "127.0.0.1", () => {
        workerServer.off("error", reject);
        resolve();
      });
    });
    const workerAddress = workerServer.address() as AddressInfo;
    const workerOrigin = `http://127.0.0.1:${String(workerAddress.port)}`;
    const imported = profileRegistry.importManifest(manifest());
    const implementations = new RuntimeImplementationRegistry();
    const probeReport = profileRegistry.recordProbeReport(
      await implementations.probeRevision(imported, { cwd: directory }),
    );
    const active = profileRegistry.activateRevision({
      contentDigest: imported.contentDigest,
      runtimeProfileRevisionId: imported.runtimeProfileRevisionId,
    });
    const principal = kernel.provisionPrincipal({
      handle: "managed-mcp-composition-agent",
      kind: "agent",
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "managed-mcp-composition-host",
        participantIds: [principal.principal.principalId],
      }).accessToken,
    );
    const accessToken = "rah_wat_managed_mcp_composition_0123456789";
    const workerService = {
      issueActivationCredential: () => ({
        accessToken,
        expiresAt: "2099-01-01T00:00:00.000Z",
        revoke: () => {
          revoked += 1;
        },
      }),
      origin: workerOrigin,
    } as unknown as WorkerApplicationService;
    const runtime = createConfiguredRuntime({
      credentialEnvironment: new RuntimeCredentialEnvironmentBinding({
        manifest: active.manifest,
        resolvers: {},
      }),
      cwd: directory,
      host,
      implementations,
      managedMcpProxyRegistry: proxyRegistry,
      probeReport,
      runtimeProfileRegistry: profileRegistry,
      runtimeProfileRevision: active,
      supervisorDirectory: join(directory, "supervisors"),
      workerService,
    });
    const run = await runtime.start(
      {
        activationId: "activation-managed-mcp-composition",
        consumerId: "managed-mcp-composition-consumer",
        fromSeq: 1,
        hostId: host.hostId,
        participantId: principal.principal.principalId,
        reason: "manual",
        roomId: "room-composition",
        runAttemptId: "run-managed-mcp-composition",
        toSeq: 1,
        agent: {
          agentDefinitionRevision: {
            agentDefinitionId: "agent-definition-managed-mcp",
            agentDefinitionRevisionId: "agent-revision-managed-mcp-v1",
            contentDigest: `sha256:${"1".repeat(64)}`,
            createdAt: "2026-08-29T12:00:00.000+08:00",
            createdBy: "human-owner",
            displayName: "Managed MCP Agent",
            executionPolicyRevisionId: "execution-full-access-v1",
            instructionRefs: [],
            memoryPolicyRef: {
              artifactId: "memory-policy",
              contentDigest: `sha256:${"2".repeat(64)}`,
              versionId: "memory-policy-v1",
            },
            revision: 1,
            role: "Persistent Agent",
            skillRefs: [],
          },
          handle: "managed-mcp-agent",
          participantId: principal.principal.principalId,
          schemaVersion: 1,
        },
      },
      { registerPrepared: async () => undefined },
    );
    const exit = await runtime.reap(run);
    assert.ok(runtime instanceof GenericProcessAdapter);
    const runtimeDiagnostics = runtime.diagnostics(run);
    assert.equal(exit.code, 0, runtimeDiagnostics.stderr);
    const output = JSON.parse(runtimeDiagnostics.stdout) as {
      result: { isError: boolean; structuredContent: { roomId: string } };
      memory: string;
      memoryDirectory: string;
      memoryIndexPath: string;
      tools: string[];
      url: string;
    };
    assert.equal(output.result.isError, false);
    assert.equal(output.result.structuredContent.roomId, "room-composition");
    assert.match(output.memory, /^# Managed MCP Agent$/mu);
    assert.match(output.memory, /^## Role\nPersistent Agent$/mu);
    assert.equal(
      output.memoryIndexPath,
      join(output.memoryDirectory, "MEMORY.md"),
    );
    assert.match(
      output.memoryDirectory,
      /supervisors\/agent-memory\/[a-f0-9]{64}$/u,
    );
    assert.match(output.tools[0] ?? "", /^r[0-9a-f]{8}_room_snapshot$/u);
    assert.equal(revoked, 1);
    assert.deepEqual(
      workerRequests.map(({ body, path, token }) => ({ body, path, token })),
      [
        {
          body: {},
          path: "/v1/worker/mcp/tools",
          token: `Bearer ${accessToken}`,
        },
        {
          body: {},
          path: "/v1/worker/mcp/tools",
          token: `Bearer ${accessToken}`,
        },
        {
          body: {},
          path: "/v1/worker/mcp/tools",
          token: `Bearer ${accessToken}`,
        },
        {
          body: {
            arguments: { roomId: "room-composition" },
            expectedAssignmentVersion: 3,
            expectedConfigVersion: 7,
            mcpServerId: "room-tools",
            toolName: "room.snapshot",
          },
          path: "/v1/worker/mcp/call",
          token: `Bearer ${accessToken}`,
        },
      ],
    );
    assert.equal((await fetch(output.url)).status, 404);
  } finally {
    await proxyRegistry.close();
    await new Promise<void>((resolve, reject) => {
      workerServer.close((error) => (error ? reject(error) : resolve()));
    });
    profileRegistry.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
