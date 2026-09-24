// Minimal RFC 6455 text-frame transport over a Unix domain socket.
//
// `codex app-server --listen unix://PATH` (0.156.1) speaks WebSocket over the
// socket (HTTP/1.1 upgrade, then text frames carrying one JSON-RPC message
// each), verified on 2026-09-24 with a local `initialize` probe that ran no
// model. Node's global WebSocket cannot dial a Unix socket, so this module
// implements just what the driver needs: client handshake, masked text
// frames, fragmentation, ping/pong and close. The server half exists only so
// test fixtures can speak the same framing; it is not a production server.
import { createHash, randomBytes } from "node:crypto";
import { createConnection } from "node:net";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_HANDSHAKE_BYTES = 16 * 1024;

/**
 * Dial `socketPath`, upgrade, and resolve with a connection object:
 * `send(text)`, `close()`, and callbacks `onMessage(text)`, `onClose(error?)`.
 */
export function connectUnixWebSocket(socketPath, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const key = randomBytes(16).toString("base64");
    let handshake = Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(
      () => fail(new Error("WebSocket handshake timed out")),
      timeoutMs,
    );
    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    }
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.write(
        `GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    const onHandshake = (chunk) => {
      handshake = Buffer.concat([handshake, chunk]);
      if (handshake.byteLength > MAX_HANDSHAKE_BYTES)
        return fail(new Error("WebSocket handshake response is too large"));
      const end = handshake.indexOf("\r\n\r\n");
      if (end < 0) return;
      const head = handshake.subarray(0, end).toString("latin1");
      const rest = handshake.subarray(end + 4);
      const lines = head.split("\r\n");
      const accept = createHash("sha1")
        .update(key + GUID)
        .digest("base64");
      const headers = new Map(
        lines.slice(1).map((line) => {
          const colon = line.indexOf(":");
          return [
            line.slice(0, colon).trim().toLowerCase(),
            line.slice(colon + 1).trim(),
          ];
        }),
      );
      if (
        !/^HTTP\/1\.1 101\b/u.test(lines[0] ?? "") ||
        headers.get("sec-websocket-accept") !== accept
      )
        return fail(new Error(`WebSocket upgrade refused: ${lines[0]}`));
      settled = true;
      clearTimeout(timer);
      socket.removeListener("data", onHandshake);
      socket.removeListener("error", fail);
      const connection = createConnectionObject(socket, true);
      resolve(connection);
      if (rest.byteLength > 0) connection.feed(rest);
    };
    socket.on("data", onHandshake);
  });
}

/** Test-fixture server half: answer one upgrade request on `socket`. */
export function acceptUnixWebSocket(socket) {
  return new Promise((resolve, reject) => {
    let request = Buffer.alloc(0);
    const onData = (chunk) => {
      request = Buffer.concat([request, chunk]);
      if (request.byteLength > MAX_HANDSHAKE_BYTES) {
        socket.destroy();
        reject(new Error("upgrade request too large"));
        return;
      }
      const end = request.indexOf("\r\n\r\n");
      if (end < 0) return;
      socket.removeListener("data", onData);
      const head = request.subarray(0, end).toString("latin1");
      const rest = request.subarray(end + 4);
      const key = /sec-websocket-key:\s*(\S+)/iu.exec(head)?.[1];
      if (key === undefined) {
        socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        reject(new Error("missing Sec-WebSocket-Key"));
        return;
      }
      const accept = createHash("sha1")
        .update(key + GUID)
        .digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: websocket\r\nsec-websocket-accept: ${accept}\r\n\r\n`,
      );
      const connection = createConnectionObject(socket, false);
      resolve(connection);
      if (rest.byteLength > 0) connection.feed(rest);
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

function createConnectionObject(socket, isClient) {
  let buffer = Buffer.alloc(0);
  let fragments = [];
  let fragmentBytes = 0;
  let closed = false;
  // Messages (and a close) that arrive before the caller installs its
  // listener — e.g. coalesced with the upgrade response — are queued, never
  // handed to a default no-op callback.
  let messageListener;
  let closeListener;
  const queued = [];
  let pendingClose;
  const connection = {
    get onMessage() {
      return messageListener ?? (() => {});
    },
    set onMessage(listener) {
      messageListener = listener;
      while (messageListener !== undefined && queued.length > 0)
        messageListener(queued.shift());
    },
    get onClose() {
      return closeListener ?? (() => {});
    },
    set onClose(listener) {
      closeListener = listener;
      if (listener !== undefined && pendingClose !== undefined) {
        const { error } = pendingClose;
        pendingClose = undefined;
        listener(error);
      }
    },
    get open() {
      return !closed && !socket.destroyed;
    },
    send(text) {
      if (!connection.open) throw new Error("WebSocket is closed");
      socket.write(encodeFrame(0x1, Buffer.from(text, "utf8"), isClient));
    },
    close() {
      if (closed) return;
      try {
        socket.write(encodeFrame(0x8, Buffer.alloc(0), isClient));
      } catch {
        // Already gone.
      }
      finish();
      socket.end();
    },
    feed(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      drain();
    },
  };
  function finish(error) {
    if (closed) return;
    closed = true;
    if (closeListener === undefined) pendingClose = { error };
    else closeListener(error);
  }
  function drain() {
    for (;;) {
      const frame = decodeFrame(buffer);
      if (frame === undefined) return;
      if (frame.error !== undefined) {
        socket.destroy();
        finish(new Error(frame.error));
        return;
      }
      buffer = buffer.subarray(frame.consumed);
      const { opcode, fin, payload } = frame;
      if (opcode === 0x8) {
        if (!closed)
          try {
            socket.write(encodeFrame(0x8, Buffer.alloc(0), isClient));
          } catch {
            // Peer already gone.
          }
        socket.end();
        finish();
        return;
      }
      if (opcode === 0x9) {
        socket.write(encodeFrame(0xa, payload, isClient));
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x0) {
        fragments.push(payload);
        fragmentBytes += payload.byteLength;
        if (fragmentBytes > MAX_MESSAGE_BYTES) {
          socket.destroy();
          finish(new Error("WebSocket message exceeds the safe limit"));
          return;
        }
        if (fin) {
          const text = Buffer.concat(fragments).toString("utf8");
          fragments = [];
          fragmentBytes = 0;
          if (messageListener === undefined) queued.push(text);
          else messageListener(text);
        }
      }
    }
  }
  socket.on("data", (chunk) => connection.feed(chunk));
  socket.on("close", () => finish());
  socket.on("error", (error) => finish(error));
  return connection;
}

function encodeFrame(opcode, payload, masked) {
  const length = payload.byteLength;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, (masked ? 0x80 : 0) | length]);
  } else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = (masked ? 0x80 : 0) | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = (masked ? 0x80 : 0) | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  if (!masked) return Buffer.concat([header, payload]);
  const mask = randomBytes(4);
  const body = Buffer.from(payload);
  for (let index = 0; index < body.byteLength; index += 1)
    body[index] ^= mask[index % 4];
  return Buffer.concat([header, mask, body]);
}

function decodeFrame(buffer) {
  if (buffer.byteLength < 2) return undefined;
  const fin = (buffer[0] & 0x80) !== 0;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.byteLength < 4) return undefined;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.byteLength < 10) return undefined;
    const big = buffer.readBigUInt64BE(2);
    if (big > BigInt(MAX_MESSAGE_BYTES))
      return { error: "WebSocket frame exceeds the safe limit" };
    length = Number(big);
    offset = 10;
  }
  if (length > MAX_MESSAGE_BYTES)
    return { error: "WebSocket frame exceeds the safe limit" };
  const maskOffset = offset;
  if (masked) offset += 4;
  if (buffer.byteLength < offset + length) return undefined;
  let payload = buffer.subarray(offset, offset + length);
  if (masked) {
    const mask = buffer.subarray(maskOffset, maskOffset + 4);
    payload = Buffer.from(payload);
    for (let index = 0; index < payload.byteLength; index += 1)
      payload[index] ^= mask[index % 4];
  }
  return { consumed: offset + length, fin, opcode, payload };
}
