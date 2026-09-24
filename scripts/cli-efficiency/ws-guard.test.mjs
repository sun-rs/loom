import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createClientMessageFilter,
  startGuardedUnixProxy,
} from "./ws-guard.mjs";
import {
  acceptUnixWebSocket,
  connectUnixWebSocket,
} from "../../packages/agent-host/src/unix-websocket.mjs";

const HANDSHAKE = Buffer.from("GET / HTTP/1.1\r\nUpgrade: websocket\r\n\r\n");
function frame(opcode, text, { fin = true, rsv1 = false } = {}) {
  const payload = Buffer.from(text, "utf8");
  const mask = Buffer.from([1, 2, 3, 4]);
  const n = payload.byteLength;
  const len =
    n < 126
      ? Buffer.from([0x80 | n])
      : Buffer.from([0x80 | 126, n >> 8, n & 0xff]);
  const head = Buffer.from([(fin ? 0x80 : 0) | (rsv1 ? 0x40 : 0) | opcode]);
  const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
  return Buffer.concat([head, len, mask, masked]);
}
function filter() {
  const forwarded = [];
  const seen = [];
  const f = createClientMessageFilter({
    forward: (b) => forwarded.push(b),
    validate: (text) => {
      seen.push(text);
      if (text.includes("deny")) throw new Error("Unapproved model");
    },
  });
  return { f, forwarded, seen, bytes: () => Buffer.concat(forwarded) };
}

test("client filter forwards the upgrade raw, then validates each text message before forwarding it", () => {
  const { f, seen, bytes } = filter();
  const big = JSON.stringify({ method: "x", pad: "a".repeat(300) });
  const wire = Buffer.concat([HANDSHAKE, frame(1, '{"a":1}'), frame(1, big)]);
  // Arbitrary chunking, including a split inside the header and length.
  for (let i = 0; i < wire.length; i += 7) f.push(wire.subarray(i, i + 7));
  assert.deepEqual(seen, ['{"a":1}', big]);
  assert.deepEqual(bytes(), wire, "forwarded bytes are unchanged");
});

test("fragmented messages are held until complete; control frames pass immediately", () => {
  const { f, forwarded, seen, bytes } = filter();
  f.push(HANDSHAKE);
  const first = frame(1, '{"me', { fin: false });
  const ping = frame(9, "");
  const last = frame(0, 'thod":"ok"}');
  f.push(first);
  f.push(ping);
  assert.deepEqual(seen, []);
  assert.deepEqual(forwarded.at(-1), ping);
  f.push(last);
  assert.deepEqual(seen, ['{"method":"ok"}']);
  assert.deepEqual(bytes(), Buffer.concat([HANDSHAKE, ping, first, last]));
});

test("a denied or uninspectable message is never forwarded", () => {
  const denied = filter();
  denied.f.push(HANDSHAKE);
  assert.throws(() => denied.f.push(frame(1, '{"deny":1}')), /Unapproved/);
  assert.deepEqual(denied.bytes(), HANDSHAKE);
  const compressed = filter();
  compressed.f.push(HANDSHAKE);
  assert.throws(
    () => compressed.f.push(frame(1, "{}", { rsv1: true })),
    /extension/,
  );
  assert.deepEqual(compressed.bytes(), HANDSHAKE);
  const binary = filter();
  binary.f.push(HANDSHAKE);
  assert.throws(() => binary.f.push(frame(2, "{}")), /binary/);
});

test("the unix proxy relays allowed requests and responses and stops at a denial", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rah-wsg-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const upstreamPath = join(dir, "u.sock");
  const listenPath = join(dir, "a.sock");
  const received = [];
  const upstream = createServer(async (socket) => {
    const c = await acceptUnixWebSocket(socket);
    c.onMessage = (text) => {
      received.push(text);
      c.send(JSON.stringify({ echo: JSON.parse(text).id }));
    };
  });
  t.after(() => upstream.close());
  let denied;
  const proxy = await startGuardedUnixProxy({
    listenPath,
    upstreamPath,
    validate: (text) => {
      if (JSON.parse(text).model === "other") throw new Error("Unapproved");
    },
    onDenied: (e) => (denied = e),
    // Upstream appears after the proxy starts waiting, like codex startup.
    waitMs: 5000,
  });
  t.after(() => proxy.close());
  await new Promise((r) => upstream.listen(upstreamPath, r));
  await proxy.ready;
  const client = await connectUnixWebSocket(listenPath, { timeoutMs: 5000 });
  const replies = [];
  client.onMessage = (text) => replies.push(JSON.parse(text));
  client.send(JSON.stringify({ id: 1, model: "ok" }));
  await waitFor(() => replies.length === 1);
  assert.deepEqual(replies, [{ echo: 1 }]);
  const closed = new Promise((r) => (client.onClose = r));
  client.send(JSON.stringify({ id: 2, model: "other" }));
  await closed;
  assert.match(String(denied), /Unapproved/);
  assert.deepEqual(received, ['{"id":1,"model":"ok"}']);
});

async function waitFor(fn) {
  const end = Date.now() + 5000;
  while (!fn()) {
    assert.ok(Date.now() < end, "timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}
