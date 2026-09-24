import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";

import { connectUnixWebSocket } from "../src/unix-websocket.mjs";

/**
 * S2-a review (Unix WebSocket P2): a text frame that arrives in the same
 * packet as the upgrade response must reach the listener installed after
 * `await connectUnixWebSocket(...)`, never a default no-op callback.
 */
test("a frame coalesced with the upgrade response is delivered once a listener is installed", async () => {
  const directory = mkdtempSync("/tmp/lws-");
  const socketPath = join(directory, "s.sock");
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    let request = "";
    socket.on("data", (chunk) => {
      request += chunk.toString("latin1");
      if (!request.includes("\r\n\r\n")) return;
      const key = /sec-websocket-key:\s*(\S+)/iu.exec(request)![1]!;
      const accept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      const payload = Buffer.from('{"early":true}', "utf8");
      socket.write(
        Buffer.concat([
          Buffer.from(
            `HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${accept}\r\n\r\n`,
            "latin1",
          ),
          Buffer.from([0x81, payload.byteLength]),
          payload,
        ]),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  try {
    const connection = await connectUnixWebSocket(socketPath, {
      timeoutMs: 2_000,
    });
    const received = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("the early frame was dropped")),
        1_000,
      );
      connection.onMessage = (text: string) => {
        clearTimeout(timer);
        resolve(text);
      };
    });
    assert.equal(received, '{"early":true}');
    connection.close();
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
