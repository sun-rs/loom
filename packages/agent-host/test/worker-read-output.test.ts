import assert from "node:assert/strict";
import test from "node:test";
import { Writable } from "node:stream";
import { writeWorkerReadResult } from "../src/worker-read-output.ts";
const readReceiptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const base = {
  request: { path: "/v1/worker/messages/history", body: {} },
  result: { messages: [], frozenThroughRoomSeq: 1, readReceiptId },
  jsonOutput: false,
};
test("a read receipt is sent only after output completes and is hidden from the model", async () => {
  let finish: ((error?: Error | null) => void) | undefined;
  let output = "";
  let calls = 0;
  const stdout = new Writable({
    write(chunk, _enc, callback) {
      output += chunk;
      finish = callback;
    },
  });
  const pending = writeWorkerReadResult({
    ...base,
    stdout,
    send: async (request) => {
      calls++;
      assert.deepEqual(request, {
        path: "/v1/worker/read-received",
        body: { readReceiptId },
      });
      return { received: true };
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 0);
  assert.ok(!output.includes(readReceiptId));
  finish!();
  await pending;
  assert.equal(calls, 1);
});
test("an async output failure never acknowledges a read result", async () => {
  let calls = 0;
  const stdout = new Writable({
    write(_chunk, _enc, callback) {
      setImmediate(() => callback(new Error("EPIPE")));
    },
  });
  await assert.rejects(
    writeWorkerReadResult({
      ...base,
      stdout,
      send: async () => {
        calls++;
        return { received: true };
      },
    }),
    /EPIPE/,
  );
  assert.equal(calls, 0);
});
test("receipt loss is a tool error, not a fabricated acknowledgement", async () => {
  await assert.rejects(
    writeWorkerReadResult({
      ...base,
      stdout: { write: () => {} },
      send: async () => {
        throw new Error("network lost");
      },
    }),
    /network lost/,
  );
});
