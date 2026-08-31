import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, Server } from "@modelcontextprotocol/server";

import { NodeManagedMcpExecutorRegistry } from "../src/managed-mcp-executor-registry.ts";

test("managed MCP executor registry calls a real authenticated Streamable HTTP Server", async () => {
  const received: unknown[] = [];
  const handler = createMcpHandler(() => {
    const server = new Server(
      { name: "managed-mcp-fixture", version: "1" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler("tools/list", async () => ({
      tools: [
        {
          description: "Echo one canonical value.",
          inputSchema: {
            additionalProperties: false,
            properties: { value: { type: "string" } },
            required: ["value"],
            type: "object",
          },
          name: "fixture.echo",
          title: "Echo",
        },
      ],
    }));
    server.setRequestHandler("tools/call", async (request) => {
      received.push(request.params);
      return {
        content: [
          { text: String(request.params.arguments?.value), type: "text" },
        ],
        isError: false,
        structuredContent: { echoed: request.params.arguments?.value },
      };
    });
    return server;
  });
  const nodeHandler = toNodeHandler(handler);
  const httpServer = createServer((request, response) => {
    if (request.headers.authorization !== "Bearer executor-secret") {
      response.writeHead(401).end();
      return;
    }
    if (request.method === undefined || request.url === undefined) {
      response.writeHead(400).end();
      return;
    }
    void nodeHandler(
      request as typeof request & { method: string; url: string },
      response,
    );
  });
  await new Promise<void>((resolve) =>
    httpServer.listen(0, "127.0.0.1", resolve),
  );
  const port = (httpServer.address() as AddressInfo).port;
  const registry = new NodeManagedMcpExecutorRegistry([
    {
      bearerToken: "executor-secret",
      executorRef: "fixture-executor",
      url: `http://127.0.0.1:${String(port)}/mcp`,
    },
  ]);
  try {
    assert.deepEqual(registry.listExecutors(), [
      {
        executorRef: "fixture-executor",
        transportKind: "streamable-http",
      },
    ]);
    const tools = await registry.discover("fixture-executor", {
      signal: new AbortController().signal,
    });
    assert.deepEqual(tools, [
      {
        description: "Echo one canonical value.",
        inputSchema: {
          additionalProperties: false,
          properties: { value: { type: "string" } },
          required: ["value"],
          type: "object",
        },
        runtimeName: "fixture.echo",
        title: "Echo",
        toolName: "fixture.echo",
      },
    ]);
    const result = await registry.call(
      {
        arguments: { value: "canonical" },
        assignmentVersion: 1,
        configVersion: 1,
        executorRef: "fixture-executor",
        managedMcpCallId: "call-fixture",
        mcpServerId: "mcp-fixture",
        participantId: "agent-fixture",
        roomId: "room-fixture",
        runAttemptId: "run-fixture",
        toolName: "fixture.echo",
      },
      { signal: new AbortController().signal },
    );
    assert.deepEqual(result, {
      content: [{ text: "canonical", type: "text" }],
      isError: false,
      structuredContent: { echoed: "canonical" },
    });
    assert.equal(received.length, 1);
  } finally {
    await registry.close();
    await handler.close();
    await new Promise<void>((resolve, reject) =>
      httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("managed MCP executor registry fails closed on ambiguous routing", async () => {
  assert.throws(
    () =>
      new NodeManagedMcpExecutorRegistry([
        {
          executorRef: "remote",
          url: "http://mcp.example.test/mcp",
        },
      ]),
    /HTTPS or loopback HTTP/u,
  );
  assert.throws(
    () =>
      new NodeManagedMcpExecutorRegistry([
        { executorRef: "same", url: "https://one.example/mcp" },
        { executorRef: "same", url: "https://two.example/mcp" },
      ]),
    /duplicate managed MCP executorRef/u,
  );
  const registry = new NodeManagedMcpExecutorRegistry([]);
  await assert.rejects(
    () =>
      registry.call(
        {
          arguments: {},
          assignmentVersion: 1,
          configVersion: 1,
          executorRef: "absent",
          managedMcpCallId: "call-absent",
          mcpServerId: "mcp-absent",
          participantId: "agent",
          roomId: "room",
          runAttemptId: "run",
          toolName: "absent",
        },
        { signal: new AbortController().signal },
      ),
    /managed MCP executor absent is not configured/u,
  );
});
