import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { RoomCursorKeyStore } from "./room-cursor-key-store";
import { RoomReadCursorCodec } from "./room-read-cursor";

const execFileAsync = promisify(execFile);

test("RoomCursorKeyStore survives normal restart and writes owner-only key material", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-cursor-key-"));
  const keyPath = path.join(root, "secrets", "room-cursor-key.json");
  try {
    const first = new RoomCursorKeyStore(keyPath).loadOrCreate();
    const second = new RoomCursorKeyStore(keyPath).loadOrCreate();
    assert.equal(second.generation, first.generation);
    assert.deepEqual(Buffer.from(second.secret), Buffer.from(first.secret));
    assert.equal(statSync(keyPath).mode & 0o077, 0);
    const persisted = JSON.parse(readFileSync(keyPath, "utf8")) as Record<string, unknown>;
    assert.equal(persisted.schemaVersion, 1);
    assert.equal(typeof persisted.secret, "string");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RoomCursorKeyStore rotation changes generation and invalidates pre-restore cursors", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-cursor-rotate-"));
  const keyPath = path.join(root, "room-cursor-key.json");
  try {
    const store = new RoomCursorKeyStore(keyPath);
    const before = store.loadOrCreate();
    const oldCodec = new RoomReadCursorCodec(before);
    const cursor = oldCodec.encodeInbox({ subject: oldCodec.subject("human-owner"), position: 9 });
    const after = store.rotate(before.generation);
    assert.notEqual(after.generation, before.generation);
    assert.notDeepEqual(Buffer.from(after.secret), Buffer.from(before.secret));
    const newCodec = new RoomReadCursorCodec(after);
    assert.throws(
      () => newCodec.decodeInbox(cursor, newCodec.subject("human-owner")),
      /cursor is invalid/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RoomCursorKeyStore publishes one winner across simultaneous daemon starts", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-cursor-race-"));
  const keyPath = path.join(root, "room-cursor-key.json");
  try {
    const moduleUrl = pathToFileURL(
      path.join(import.meta.dirname, "room-cursor-key-store.ts"),
    ).href;
    const worker = `
      import { RoomCursorKeyStore } from ${JSON.stringify(moduleUrl)};
      const material = new RoomCursorKeyStore(process.argv[1]).loadOrCreate();
      process.stdout.write(material.generation + ":" + Buffer.from(material.secret).toString("base64url"));
    `;
    const results = await Promise.all(
      Array.from({ length: 16 }, () => execFileAsync(process.execPath, [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        worker,
        keyPath,
      ])),
    );
    const observed = new Set(results.map((result) => result.stdout));
    assert.equal(observed.size, 1);
    const persisted = new RoomCursorKeyStore(keyPath).loadOrCreate();
    assert.equal(
      [...observed][0],
      `${persisted.generation}:${Buffer.from(persisted.secret).toString("base64url")}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RoomCursorKeyStore refuses corrupt state instead of silently replacing trust material", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-cursor-corrupt-"));
  const keyPath = path.join(root, "room-cursor-key.json");
  try {
    writeFileSync(keyPath, "{not-json", { mode: 0o600 });
    assert.throws(() => new RoomCursorKeyStore(keyPath).loadOrCreate(), /invalid|corrupt/i);
    assert.equal(readFileSync(keyPath, "utf8"), "{not-json");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
