import assert from "node:assert/strict";
import test from "node:test";
import type { RahClient } from "@rah-os/client-sdk";
import { MessageSocialStore } from "../src/message-social-store.ts";
test("late social polls cannot overwrite a completed save", async () => {
  let resolveRead: (value: unknown) => void = () => {};
  const item = { messageId: "m", version: 0, saved: false, reactions: [] };
  const client = {
    request: async (op: string) =>
      op === "message.social"
        ? await new Promise((resolve) => {
            resolveRead = resolve;
          })
        : { ...item, saved: true },
  } as unknown as RahClient;
  const store = new MessageSocialStore(client);
  const release = store.watch("room", "m");
  const reading = store.refresh();
  await store.mutate(
    { roomId: "room", messageId: "m", roomSeq: 1 },
    "save",
    true,
  );
  resolveRead({ items: [item] });
  await reading;
  assert.equal(store.read("room", "m")?.data?.saved, true);
  release();
  assert.equal(store.size, 0);
  store.dispose();
});

test("background social read failures do not repeat a transport error under every message", async () => {
  const client = {
    request: async () => {
      throw new Error("session expired");
    },
  } as unknown as RahClient;
  const store = new MessageSocialStore(client);
  const releaseA = store.watch("room", "message-a");
  const releaseB = store.watch("room", "message-b");
  await store.refresh();
  assert.equal(store.read("room", "message-a"), undefined);
  assert.equal(store.read("room", "message-b"), undefined);
  releaseA();
  releaseB();
  store.dispose();
});
test("unmounted requests cannot overwrite a fresh mount of the same message", async () => {
  let resolveRead: (value: unknown) => void = () => {};
  const client = {
    request: async () =>
      await new Promise((resolve) => {
        resolveRead = resolve;
      }),
  } as unknown as RahClient;
  const store = new MessageSocialStore(client);
  const release = store.watch("r", "m");
  const reading = store.refresh();
  release();
  store.watch("r", "m");
  resolveRead({
    items: [{ messageId: "m", version: 0, saved: true, reactions: [] }],
  });
  await reading;
  assert.equal(store.read("r", "m"), undefined);
  store.dispose();
});
