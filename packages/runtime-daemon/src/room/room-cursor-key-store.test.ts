import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { RoomCursorKeyStore } from "./room-cursor-key-store";
import { RoomReadCursorCodec } from "./room-read-cursor";

const execFileAsync = promisify(execFile);

async function crashRotationAt(
  keyPath: string,
  expectedGeneration: string,
  phase: "locked" | "key_published",
): Promise<void> {
  const moduleUrl = pathToFileURL(
    path.join(import.meta.dirname, "room-cursor-key-store.ts"),
  ).href;
  const worker = `
    import { RoomCursorKeyStore } from ${JSON.stringify(moduleUrl)};
    const store = new RoomCursorKeyStore(process.argv[1], {
      onRotationPhase(value) {
        if (value === process.argv[3]) process.kill(process.pid, "SIGKILL");
      },
    });
    store.rotate(process.argv[2]);
  `;
  await assert.rejects(execFileAsync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    worker,
    keyPath,
    expectedGeneration,
    phase,
  ], { timeout: 5_000 }));
}

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

test("Room cursor generation invalidates cursors even when key bytes are unchanged", () => {
  const secret = Buffer.from("same-secret-for-two-generations-123", "utf8");
  const before = new RoomReadCursorCodec({ generation: "generation-before", secret });
  const after = new RoomReadCursorCodec({ generation: "generation-after", secret });
  const cursor = before.encodeInbox({
    subject: before.subject("human-owner"),
    position: 17,
  });

  assert.throws(
    () => after.decodeInbox(cursor, after.subject("human-owner")),
    /cursor is invalid/,
  );
});

test("RoomCursorKeyStore fails closed and resumes a rotation interrupted before key publish", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-cursor-recover-before-"));
  const keyPath = path.join(root, "room-cursor-key.json");
  const lockPath = `${keyPath}.rotate.lock`;
  try {
    const store = new RoomCursorKeyStore(keyPath);
    const before = store.loadOrCreate();
    const oldCodec = new RoomReadCursorCodec(before);
    const oldCursor = oldCodec.encodeInbox({
      subject: oldCodec.subject("human-owner"),
      position: 11,
    });

    await crashRotationAt(keyPath, before.generation, "locked");
    assert.equal(existsSync(lockPath), true);
    assert.throws(
      () => new RoomCursorKeyStore(keyPath).loadOrCreate(),
      /interrupted.*recovery required/i,
    );

    const recovered = new RoomCursorKeyStore(keyPath)
      .recoverInterruptedRotation(before.generation);
    assert.notEqual(recovered.generation, before.generation);
    assert.equal(existsSync(lockPath), false);
    assert.throws(
      () => new RoomReadCursorCodec(recovered).decodeInbox(
        oldCursor,
        new RoomReadCursorCodec(recovered).subject("human-owner"),
      ),
      /cursor is invalid/,
    );
    const restarted = new RoomCursorKeyStore(keyPath).loadOrCreate();
    assert.equal(restarted.generation, recovered.generation);
    assert.deepEqual(Buffer.from(restarted.secret), Buffer.from(recovered.secret));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RoomCursorKeyStore finalizes a rotation interrupted after key publish", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-cursor-recover-after-"));
  const keyPath = path.join(root, "room-cursor-key.json");
  const lockPath = `${keyPath}.rotate.lock`;
  try {
    const before = new RoomCursorKeyStore(keyPath).loadOrCreate();
    await crashRotationAt(keyPath, before.generation, "key_published");
    const published = JSON.parse(readFileSync(keyPath, "utf8")) as { generation: string };
    assert.notEqual(published.generation, before.generation);
    assert.equal(existsSync(lockPath), true);
    assert.throws(
      () => new RoomCursorKeyStore(keyPath).loadOrCreate(),
      /interrupted.*recovery required/i,
    );

    const recovered = new RoomCursorKeyStore(keyPath)
      .recoverInterruptedRotation(before.generation);
    assert.equal(recovered.generation, published.generation);
    assert.equal(existsSync(lockPath), false);
    assert.equal(
      new RoomCursorKeyStore(keyPath).loadOrCreate().generation,
      recovered.generation,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RoomCursorKeyStore refuses corrupt interrupted-rotation evidence", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-cursor-recover-corrupt-"));
  const keyPath = path.join(root, "room-cursor-key.json");
  const lockPath = `${keyPath}.rotate.lock`;
  try {
    const before = new RoomCursorKeyStore(keyPath).loadOrCreate();
    writeFileSync(lockPath, "{not-json", { mode: 0o600 });
    assert.throws(
      () => new RoomCursorKeyStore(keyPath).loadOrCreate(),
      /interrupted.*recovery required/i,
    );
    assert.throws(
      () => new RoomCursorKeyStore(keyPath).recoverInterruptedRotation(before.generation),
      /invalid|corrupt/i,
    );
    assert.equal(readFileSync(lockPath, "utf8"), "{not-json");
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

test("RoomCursorKeyStore permits exactly one concurrent offline rotation", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-cursor-rotate-race-"));
  const keyPath = path.join(root, "room-cursor-key.json");
  try {
    const before = new RoomCursorKeyStore(keyPath).loadOrCreate();
    const moduleUrl = pathToFileURL(
      path.join(import.meta.dirname, "room-cursor-key-store.ts"),
    ).href;
    const worker = `
      import { RoomCursorKeyStore } from ${JSON.stringify(moduleUrl)};
      const material = new RoomCursorKeyStore(process.argv[1]).rotate(process.argv[2]);
      process.stdout.write(material.generation);
    `;
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, () => execFileAsync(process.execPath, [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        worker,
        keyPath,
        before.generation,
      ])),
    );
    const succeeded = results.filter(
      (result): result is PromiseFulfilledResult<{ stdout: string; stderr: string }> =>
        result.status === "fulfilled",
    );
    assert.equal(succeeded.length, 1);
    assert.equal(
      new RoomCursorKeyStore(keyPath).loadOrCreate().generation,
      succeeded[0]?.value.stdout,
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

test("RoomCursorKeyStore refuses oversized key state before parsing", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-cursor-oversized-"));
  const keyPath = path.join(root, "room-cursor-key.json");
  try {
    writeFileSync(keyPath, "x".repeat(4_097), { mode: 0o600 });
    assert.throws(
      () => new RoomCursorKeyStore(keyPath).loadOrCreate(),
      /bounded|invalid|corrupt/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
