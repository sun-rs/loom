import assert from "node:assert/strict";
import { createServer as createNodeHttpServer } from "node:http";
import test from "node:test";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { ManagedMcpCatalogSchema } from "@rah-os/protocol";

import {
  ManagedMcpRuntimeProxyRegistry,
  nativeManagedMcpToolName,
} from "../src/index.ts";

test("managed MCP loopback proxy follows the Raft native-name and reload-per-call protocol", async () => {
  const registry = new ManagedMcpRuntimeProxyRegistry();
  const calls: Array<Record<string, unknown>> = [];
  let catalogLoads = 0;
  const catalog = ManagedMcpCatalogSchema.parse({
    catalogVersion: 1,
    tools: [
      {
        annotations: { readOnlyHint: true },
        assignmentVersion: 3,
        configVersion: 7,
        description: "Read canonical Room state.",
        inputSchema: {
          additionalProperties: false,
          properties: { roomId: { type: "string" } },
          required: ["roomId"],
          type: "object",
        },
        mcpServerId: "mcp-room-tools",
        runtimeName: "workspace-1/mcp-room-tools/room.snapshot",
        serverName: "RAH Room tools",
        title: "Read Room",
        toolName: "room.snapshot",
      },
    ],
  });
  const registration = await registry.register({
    callTool: async (request) => {
      calls.push(request);
      return {
        content: [{ text: "canonical room snapshot", type: "text" }],
        isError: false,
        structuredContent: { roomId: String(request.arguments.roomId) },
      };
    },
    loadCatalog: async () => {
      catalogLoads += 1;
      return catalog;
    },
  });
  const client = new Client({ name: "rah-mcp-proxy-test", version: "1.0.0" });
  try {
    assert.match(registration.name, /^rm[a-zA-Z0-9]{6}$/u);
    const parsedUrl = new URL(registration.url);
    assert.equal(parsedUrl.hostname, "127.0.0.1");
    assert.match(parsedUrl.pathname, /^\/mcp\/[a-zA-Z0-9_-]{43}$/u);
    const transport = new StreamableHTTPClientTransport(parsedUrl);
    await client.connect(transport);
    const tools = await client.listTools();
    const expectedNativeName = nativeManagedMcpToolName(
      catalog.tools[0]!.runtimeName,
      catalog.tools[0]!.toolName,
    );
    assert.equal(expectedNativeName.length <= 48, true);
    assert.equal(tools.tools[0]?.name, expectedNativeName);
    assert.equal(
      tools.tools[0]?.description,
      "Read canonical Room state.\n\nManaged MCP source: RAH Room tools / room.snapshot.",
    );
    const result = await client.callTool({
      arguments: { roomId: "room-1" },
      name: expectedNativeName,
    });
    assert.equal(result.isError, false);
    assert.equal(result.content[0]?.type, "text");
    assert.deepEqual(calls, [
      {
        arguments: { roomId: "room-1" },
        expectedAssignmentVersion: 3,
        expectedConfigVersion: 7,
        mcpServerId: "mcp-room-tools",
        toolName: "room.snapshot",
      },
    ]);
    assert.equal(catalogLoads, 2);

    const evilOrigin = await fetch(registration.url, {
      headers: { origin: "https://attacker.example" },
    });
    assert.equal(evilOrigin.status, 403);
    const oversized = await fetch(registration.url, {
      body: "x".repeat(1_024 * 1_024 + 1),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(oversized.status, 413);
  } finally {
    await client.close();
    await registration.release();
    assert.equal((await fetch(registration.url)).status, 404);
    await registry.close();
  }
});

test("managed MCP loopback proxy starts one shared listener under concurrent registrations", async () => {
  let listenersCreated = 0;
  const registry = new ManagedMcpRuntimeProxyRegistry({
    createServer: (...arguments_) => {
      listenersCreated += 1;
      return createNodeHttpServer(...arguments_);
    },
  });
  const workerClient = {
    callTool: async () => ({ content: [], isError: false }),
    loadCatalog: async () => ({ catalogVersion: 1 as const, tools: [] }),
  };
  const registrations = await Promise.all(
    Array.from({ length: 16 }, () => registry.register(workerClient)),
  );
  try {
    assert.equal(
      new Set(registrations.map(({ url }) => new URL(url).origin)).size,
      1,
    );
    assert.equal(listenersCreated, 1);
  } finally {
    await Promise.all(registrations.map(({ release }) => release()));
    await registry.close();
  }
});

test("managed MCP loopback proxy rejects a catalog collision introduced after launch", async () => {
  const registry = new ManagedMcpRuntimeProxyRegistry();
  let tools = [
    {
      assignmentVersion: 1,
      configVersion: 1,
      inputSchema: { type: "object" as const },
      mcpServerId: "mcp-dynamic",
      runtimeName: "same-runtime",
      serverName: "Dynamic MCP",
      toolName: "safe.name",
    },
  ];
  const registration = await registry.register({
    callTool: async () => ({ content: [], isError: false }),
    loadCatalog: async () => ({ catalogVersion: 1, tools }),
  });
  const client = new Client({ name: "rah-mcp-collision-test", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(registration.url)),
    );
    assert.equal((await client.listTools()).tools.length, 1);
    tools = [
      { ...tools[0]!, toolName: "same.name" },
      { ...tools[0]!, toolName: "same_name" },
    ];
    await assert.rejects(
      () => client.listTools(),
      /managed MCP native tool name collision/u,
    );
  } finally {
    await client.close();
    await registration.release();
    await registry.close();
  }
});

test("closing a managed MCP proxy fences an in-progress first registration", async () => {
  let releaseListen: (() => void) | undefined;
  let listenerReached!: () => void;
  const reached = new Promise<void>((resolve) => {
    listenerReached = resolve;
  });
  const registry = new ManagedMcpRuntimeProxyRegistry({
    createServer: (...arguments_) => {
      const server = createNodeHttpServer(...arguments_);
      const listen = server.listen.bind(server);
      server.listen = ((port: number, host: string, callback: () => void) =>
        listen(port, host, () => {
          releaseListen = callback;
          listenerReached();
        })) as typeof server.listen;
      return server;
    },
  });
  const registration = registry.register({
    callTool: async () => ({ content: [], isError: false }),
    loadCatalog: async () => ({ catalogVersion: 1, tools: [] }),
  });
  await reached;
  const closing = registry.close();
  releaseListen!();
  await closing;
  await assert.rejects(registration, /proxy registry is closed/u);
  await assert.rejects(
    () =>
      registry.register({
        callTool: async () => ({ content: [], isError: false }),
        loadCatalog: async () => ({ catalogVersion: 1, tools: [] }),
      }),
    /proxy registry is closed/u,
  );
});
