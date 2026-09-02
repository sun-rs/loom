import assert from "node:assert/strict";
import test from "node:test";
import { FakeRahClient, type RahClient } from "@rah-os/client-sdk";
import { FileUploadStore } from "../src/file-uploads.ts";

test("upload owner survives composer navigation, but removed generation never reappears", async () => {
  let resolvePrepare!: (value: unknown) => void;
  const canceled: string[] = [];
  const response = {
    attachmentId: "file-1",
    roomId: "room-a",
    filename: "test.txt",
    mimeType: "text/plain",
    size: 5,
    expiresAt: "2030-01-01T00:00:00.000Z",
    state: "pending",
  };
  const base = new FakeRahClient(async (operation, input) => {
    if (operation === "file.prepare")
      return new Promise((resolve) => {
        resolvePrepare = resolve;
      });
    if (operation === "file.cancel") {
      canceled.push((input as { attachmentId: string }).attachmentId);
      return { ...response, state: "canceled" };
    }
    throw new Error("unexpected operation");
  });
  const client: RahClient = {
    request: base.request.bind(base),
    files: {
      upload: async () => {
        throw new Error("canceled generation must not upload");
      },
      download: async () => new Blob(),
    },
  };
  const store = new FileUploadStore(client);
  const result = store.add(
    "room-a",
    "room-a",
    new File(["hello"], "test.txt", { type: "text/plain" }),
  );
  assert.equal(store.read("room-a").length, 1);
  assert.equal(store.read("room-b").length, 0);
  store.remove("room-a", store.read("room-a")[0]!.id);
  resolvePrepare(response);
  await result;
  assert.equal(store.read("room-a").length, 0);
  assert.deepEqual(canceled, ["file-1"]);
});

test("ready attachment draft is consumed only by successful submit snapshot", async () => {
  const response = {
    attachmentId: "file-1",
    roomId: "room-a",
    filename: "test.txt",
    mimeType: "text/plain",
    size: 5,
    expiresAt: "2030-01-01T00:00:00.000Z",
    state: "completed" as const,
  };
  const base = new FakeRahClient(async () => response);
  const client: RahClient = {
    request: base.request.bind(base),
    files: { upload: async () => response, download: async () => new Blob() },
  };
  const store = new FileUploadStore(client);
  await store.add(
    "room-a",
    "room-a",
    new File(["hello"], "test.txt", { type: "text/plain" }),
  );
  const submitted = store.read("room-a");
  assert.equal(submitted[0]?.status, "ready");
  await store.add(
    "room-a",
    "room-a",
    new File(["hello"], "later.txt", { type: "text/plain" }),
  );
  store.accept(
    "room-a",
    submitted.map((row) => row.id),
  );
  assert.deepEqual(
    store.read("room-a").map((row) => row.file.name),
    ["later.txt"],
  );
});

test("Room and Thread composers reserve in one Room without sharing draft rows", async () => {
  let next = 0;
  const base = new FakeRahClient(async (_operation, input) => ({
    attachmentId: `file-${String(++next)}`,
    roomId: (input as { roomId: string }).roomId,
    filename: "test.txt",
    mimeType: "text/plain",
    size: 5,
    expiresAt: "2030-01-01T00:00:00.000Z",
    state: "completed" as const,
  }));
  const client: RahClient = {
    request: base.request.bind(base),
    files: {
      upload: async (attachmentId) => ({
        attachmentId,
        roomId: "room-a",
        filename: "test.txt",
        mimeType: "text/plain",
        size: 5,
        expiresAt: "2030-01-01T00:00:00.000Z",
        state: "completed" as const,
      }),
      download: async () => new Blob(),
    },
  };
  const store = new FileUploadStore(client);
  await store.add(
    "room:room-a",
    "room-a",
    new File(["hello"], "room.txt", { type: "text/plain" }),
  );
  await store.add(
    "thread:message-root",
    "room-a",
    new File(["hello"], "thread.txt", { type: "text/plain" }),
  );
  assert.deepEqual(
    store.read("room:room-a").map((row) => row.file.name),
    ["room.txt"],
  );
  assert.deepEqual(
    store.read("thread:message-root").map((row) => row.file.name),
    ["thread.txt"],
  );
});
