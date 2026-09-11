import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { attachCodexBusyInput } from "../src/codex-busy-input.js";

test("Raft Codex post-tool steering gate reopens on progress but never after turn completion", async () => {
  const input = new PassThrough();
  const requests: unknown[] = [];
  const receipts: { accepted: boolean }[] = [];
  const channel = attachCodexBusyInput({
    input,
    state: () => ({ threadId: "thread", turnId: "turn", stopping: false }),
    request: async (...args: unknown[]) => {
      requests.push(args);
    },
    receipt: (frame: { accepted: boolean }) => receipts.push(frame),
  });
  const send = async (id: string) => {
    input.write(
      JSON.stringify({
        protocol: "rah-runtime-notice/v1",
        id,
        fingerprint: id.padEnd(64, "0"),
        text: id,
      }) + "\n",
    );
    await new Promise((r) => setImmediate(r));
    return receipts.at(-1)?.accepted;
  };
  try {
    channel.observe({ method: "turn/started" });
    channel.observe({
      method: "item/completed",
      params: { item: { type: "commandExecution" } },
    });
    assert.equal(await send("at-tool-end"), false);
    channel.observe({
      method: "item/agentMessage/delta",
      params: { delta: "progress" },
    });
    assert.equal(await send("after-progress"), true);
    channel.observe({ method: "turn/completed", params: {} });
    channel.observe({
      method: "item/agentMessage/delta",
      params: { delta: "late-progress" },
    });
    assert.equal(await send("after-turn"), false);
    assert.equal(requests.length, 1);
  } finally {
    channel.close();
    input.destroy();
  }
});

test("accepted turn id alone is not ready and an ambiguous steer is not written twice", async () => {
  const input = new PassThrough();
  let requests = 0;
  const receipts: { accepted: boolean }[] = [];
  const channel = attachCodexBusyInput({
    input,
    state: () => ({ threadId: "thread", turnId: "turn", stopping: false }),
    request: async () => {
      requests++;
      throw new Error("RPC timed out after write");
    },
    receipt: (frame: { accepted: boolean }) => receipts.push(frame),
  });
  const send = async () => {
    input.write(
      JSON.stringify({
        protocol: "rah-runtime-notice/v1",
        id: "id",
        fingerprint: "a".repeat(64),
        text: "append",
      }) + "\n",
    );
    await new Promise((r) => setImmediate(r));
  };
  try {
    await send();
    assert.equal(requests, 0, "turn/start response is not turn/started");
    channel.observe({ method: "turn/started" });
    await send();
    await send();
    assert.equal(
      requests,
      1,
      "lost response must not duplicate a potentially accepted steer",
    );
  } finally {
    channel.close();
    input.destroy();
  }
});
