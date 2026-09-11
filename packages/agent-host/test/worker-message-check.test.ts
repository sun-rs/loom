import assert from "node:assert/strict";
import test from "node:test";
import { Writable } from "node:stream";
import {
  drainWorkerMessages,
  writeWorkerCheckOutput,
} from "../src/worker-message-check.ts";

const page = (cursorAfter: number, throughSeq = cursorAfter) => ({
  throughSeq,
  delivery: {
    cursorBefore: 0,
    cursorAfter,
    latestRoomSeq: throughSeq,
    snapshot: null,
    events: [],
  },
});

test("check waits for async output before acknowledging exactly the delivered page", async () => {
  const actions: string[] = [];
  let finish: ((error?: Error | null) => void) | undefined;
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      actions.push("write");
      finish = callback;
    },
  });
  const pending = drainWorkerMessages({
    send: async (request) => {
      actions.push(request.path);
      return request.path.endsWith("message-check")
        ? page(3)
        : { acknowledgedThrough: 3 };
    },
    write: (text) => writeWorkerCheckOutput(output, text),
    replay: false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(actions, ["/v1/worker/message-check", "write"]);
  finish!();
  await pending;
  assert.equal(actions[2], "/v1/worker/acknowledge");
});
test("async EPIPE is not ACKed", async () => {
  const requests: string[] = [];
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      setImmediate(() => callback(new Error("EPIPE")));
    },
  });
  await assert.rejects(
    drainWorkerMessages({
      send: async (request) => {
        requests.push(request.path);
        return page(2);
      },
      write: (text) => writeWorkerCheckOutput(output, text),
      replay: false,
    }),
    /EPIPE/,
  );
  assert.deepEqual(requests, ["/v1/worker/message-check"]);
});
test("partial drain retains acknowledged first page and fails honestly on later fetch", async () => {
  let read = 0;
  const acks: number[] = [];
  let output = "";
  await assert.rejects(
    drainWorkerMessages({
      send: async (request) => {
        if (request.path.endsWith("acknowledge")) {
          acks.push((request.body as { throughSeq: number }).throughSeq);
          return { acknowledgedThrough: 1 };
        }
        if (read++ === 0) return page(1, 2);
        throw new Error("network unavailable");
      },
      write: async (text) => {
        output += text;
      },
      replay: false,
    }),
    /network unavailable/,
  );
  assert.deepEqual(acks, [1]);
  assert.match(output, /current Activation/i);
});
test("check is bounded and does not accept an ACK that names another sequence", async () => {
  await assert.rejects(
    drainWorkerMessages({
      send: async (request) =>
        request.path.endsWith("message-check")
          ? page(2)
          : { acknowledgedThrough: 99 },
      write: async () => {},
      replay: false,
    }),
    /acknowledg/i,
  );
});

test("write timeout still handles a late EPIPE without an uncaught stream error", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const moduleUrl = new URL("../src/worker-message-check.ts", import.meta.url)
    .href;
  const script = `import {Writable} from 'node:stream';import {writeWorkerCheckOutput} from ${JSON.stringify(moduleUrl)};const out=new Writable({write(_c,_e,cb){setTimeout(()=>cb(new Error('LATE_EPIPE')),30);}});try{await writeWorkerCheckOutput(out,'page',2);}catch(e){console.log(e.message);}await new Promise(r=>setTimeout(r,70));`;
  const result = await promisify(execFile)(process.execPath, [
    "--input-type=module",
    "--eval",
    script,
  ]);
  assert.match(result.stdout, /timed out/);
  assert.equal(result.stderr, "");
});

test("byte budget leaves the unprinted page unacknowledged", async () => {
  const paths: string[] = [];
  let output = "";
  await drainWorkerMessages({
    send: async (request) => {
      paths.push(request.path);
      return page(1, 2);
    },
    write: async (text) => {
      output += text;
    },
    replay: false,
    maxBytes: 1,
  });
  assert.deepEqual(paths, ["/v1/worker/message-check"]);
  assert.match(output, /unacknowledged/);
});
test("round budget stops after the acknowledged page without swallowing later delivery", async () => {
  const paths: string[] = [];
  let output = "";
  await drainWorkerMessages({
    send: async (request) => {
      paths.push(request.path);
      return request.path.endsWith("message-check")
        ? page(1, 2)
        : { acknowledgedThrough: 1 };
    },
    write: async (text) => {
      output += text;
    },
    replay: false,
    maxRounds: 1,
  });
  assert.deepEqual(paths, [
    "/v1/worker/message-check",
    "/v1/worker/acknowledge",
  ]);
  assert.match(output, /drain limit/);
});
