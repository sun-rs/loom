import assert from "node:assert/strict";
import test from "node:test";

import { NodeHttpManagedMcpWorkerClient } from "../src/index.ts";

test("managed MCP Worker client sends only fixed versioned routes and bounded responses", async () => {
  const requests: Array<{ body: unknown; headers: Headers; url: string }> = [];
  const client = new NodeHttpManagedMcpWorkerClient({
    accessToken: "worker-secret",
    fetch: async (input, init) => {
      requests.push({
        body: JSON.parse(String(init?.body ?? "{}")) as unknown,
        headers: new Headers(init?.headers),
        url: String(input),
      });
      return new Response(
        JSON.stringify(
          requests.length === 1
            ? { catalogVersion: 1, tools: [] }
            : {
                content: [{ text: "ok", type: "text" }],
                isError: false,
              },
        ),
        { status: 200 },
      );
    },
    origin: "http://127.0.0.1:43123",
  });
  assert.deepEqual(await client.loadCatalog(), {
    catalogVersion: 1,
    tools: [],
  });
  assert.equal(
    (
      await client.callTool({
        arguments: { roomId: "room-1" },
        expectedAssignmentVersion: 3,
        expectedConfigVersion: 7,
        mcpServerId: "mcp-room-tools",
        toolName: "room.snapshot",
      })
    ).isError,
    false,
  );
  assert.deepEqual(
    requests.map(({ url }) => url),
    [
      "http://127.0.0.1:43123/v1/worker/mcp/tools",
      "http://127.0.0.1:43123/v1/worker/mcp/call",
    ],
  );
  assert.equal(
    requests.every(
      ({ headers }) => headers.get("authorization") === "Bearer worker-secret",
    ),
    true,
  );
  assert.deepEqual(requests[1]?.body, {
    arguments: { roomId: "room-1" },
    expectedAssignmentVersion: 3,
    expectedConfigVersion: 7,
    mcpServerId: "mcp-room-tools",
    toolName: "room.snapshot",
  });
});

test("managed MCP Worker client rejects insecure remote origins and cancels oversized responses", async () => {
  assert.throws(
    () =>
      new NodeHttpManagedMcpWorkerClient({
        accessToken: "worker-secret",
        origin: "http://192.0.2.10:43123",
      }),
    /HTTPS/u,
  );
  let cancelled = false;
  const client = new NodeHttpManagedMcpWorkerClient({
    accessToken: "worker-secret",
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          cancel: () => {
            cancelled = true;
          },
          start: (controller) => {
            controller.enqueue(new Uint8Array(512 * 1_024 + 1));
          },
        }),
        { status: 200 },
      ),
    origin: "https://worker.example.test",
  });
  await assert.rejects(() => client.loadCatalog(), /exceeds 512 KiB/u);
  assert.equal(cancelled, true);
});
