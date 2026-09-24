// Test-only model fence for `codex app-server --listen unix://…` (the S2-a
// warm driver's transport: WebSocket over a Unix socket). The paid gate's
// guarded Codex shim listens on the driver's socket path, runs the real CLI on
// a sibling socket, and relays bytes unchanged. Every client→server text
// message is validated before any of its bytes reach Codex; a denial, an
// extension (compressed) frame or a binary message closes the connection.
import { createConnection, createServer } from "node:net";
import { existsSync, rmSync } from "node:fs";

const MAX_HANDSHAKE_BYTES = 16 * 1024;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

export function createClientMessageFilter({ forward, validate }) {
  let buffer = Buffer.alloc(0);
  let upgraded = false;
  let failed;
  let held = [];
  let payloads = [];
  let heldBytes = 0;
  const fail = (message) => {
    failed = new Error(message);
    throw failed;
  };
  function next() {
    if (buffer.length < 2) return undefined;
    const b0 = buffer[0];
    const b1 = buffer[1];
    let length = b1 & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) return undefined;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) return undefined;
      length = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }
    if (length > MAX_MESSAGE_BYTES) fail("WebSocket frame exceeds the limit");
    const masked = (b1 & 0x80) !== 0;
    const mask = masked ? buffer.subarray(offset, offset + 4) : undefined;
    if (masked) offset += 4;
    if (buffer.length < offset + length) return undefined;
    const raw = Buffer.from(buffer.subarray(0, offset + length));
    const payload = Buffer.from(raw.subarray(offset));
    if (mask)
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    buffer = buffer.subarray(offset + length);
    return {
      raw,
      payload,
      fin: (b0 & 0x80) !== 0,
      rsv: b0 & 0x70,
      opcode: b0 & 0x0f,
    };
  }
  return {
    push(chunk) {
      if (failed) throw failed;
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) {
          if (buffer.length > MAX_HANDSHAKE_BYTES)
            fail("WebSocket upgrade request is too large");
          return;
        }
        forward(Buffer.from(buffer.subarray(0, end + 4)));
        buffer = buffer.subarray(end + 4);
        upgraded = true;
      }
      for (let frame = next(); frame; frame = next()) {
        if (frame.rsv) fail("WebSocket extension frames cannot be inspected");
        if (frame.opcode >= 0x8) {
          forward(frame.raw); // close/ping/pong carry no request
          continue;
        }
        if (frame.opcode === 0x2) fail("WebSocket binary frames are refused");
        if (frame.opcode === 0x1 && held.length)
          fail("WebSocket message interleaved with an open fragment");
        if (frame.opcode === 0x0 && !held.length)
          fail("WebSocket continuation without a message");
        if (frame.opcode !== 0x0 && frame.opcode !== 0x1)
          fail("WebSocket opcode refused");
        held.push(frame.raw);
        payloads.push(frame.payload);
        heldBytes += frame.payload.length;
        if (heldBytes > MAX_MESSAGE_BYTES) fail("WebSocket message too large");
        if (!frame.fin) continue;
        const text = Buffer.concat(payloads).toString("utf8");
        const raws = held;
        held = [];
        payloads = [];
        heldBytes = 0;
        try {
          validate(text);
        } catch (error) {
          failed = error;
          throw error;
        }
        for (const raw of raws) forward(raw);
      }
    },
  };
}

// Listen on listenPath once upstreamPath exists (the driver waits for its
// socket file, so the proxy appears only when Codex is actually listening).
export async function startGuardedUnixProxy({
  listenPath,
  upstreamPath,
  validate,
  onDenied,
  waitMs = 60_000,
}) {
  const sockets = new Set();
  let timer;
  let closed = false;
  const server = createServer((client) => {
    const upstream = createConnection(upstreamPath);
    sockets.add(client).add(upstream);
    const end = () => {
      client.destroy();
      upstream.destroy();
    };
    const filter = createClientMessageFilter({
      forward: (bytes) => upstream.write(bytes),
      validate,
    });
    client.on("data", (chunk) => {
      try {
        filter.push(chunk);
      } catch (error) {
        end();
        onDenied?.(error);
      }
    });
    upstream.on("data", (chunk) => client.write(chunk));
    for (const s of [client, upstream]) {
      s.on("close", end);
      s.on("error", end);
    }
  });
  const ready = new Promise((resolve, reject) => {
    const deadline = Date.now() + waitMs;
    const poll = () => {
      if (closed) return reject(new Error("Proxy closed before upstream"));
      if (existsSync(upstreamPath)) {
        server.once("error", reject);
        server.listen(listenPath, () => resolve());
        return;
      }
      if (Date.now() > deadline)
        return reject(new Error("Upstream socket did not appear"));
      timer = setTimeout(poll, 20);
    };
    poll();
  });
  ready.catch(() => {});
  return {
    ready,
    close() {
      closed = true;
      clearTimeout(timer);
      for (const s of sockets) s.destroy();
      server.close();
      rmSync(listenPath, { force: true });
    },
  };
}
