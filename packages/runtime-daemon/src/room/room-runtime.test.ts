import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { RoomCursorKeyStore } from "./room-cursor-key-store";
import {
  createRoomApplicationRuntime,
  resolveRoomStorageLayout,
  runRoomCursorMaintenance,
} from "./room-runtime";

test("Room runtime owns the canonical database and cursor key below roomRoot", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "rah-room-runtime-"));
  const roomRoot = path.join(base, "room");
  mkdirSync(roomRoot);
  const layout = resolveRoomStorageLayout(roomRoot);
  const physicalRoot = realpathSync.native(roomRoot);
  assert.deepEqual(layout, {
    roomRoot: physicalRoot,
    databasePath: path.join(physicalRoot, "room.db"),
    cursorKeyPath: path.join(physicalRoot, "cursor-key.json"),
  });

  const runtime = await createRoomApplicationRuntime({ roomRoot });
  assert.equal(runtime.layout.roomRoot, physicalRoot);
  assert.ok(runtime.cursorGeneration);
  await runtime.close();
  rmSync(base, { recursive: true, force: true });
});

test("symlink aliases cannot bypass active runtime exclusion for cursor maintenance", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "rah-room-runtime-alias-"));
  const physicalParent = path.join(base, "physical");
  const aliasParent = path.join(base, "alias");
  mkdirSync(physicalParent);
  symlinkSync(physicalParent, aliasParent, "dir");
  const physicalRoom = path.join(physicalParent, "room");
  const aliasRoom = path.join(aliasParent, "room");
  const runtime = await createRoomApplicationRuntime({ roomRoot: physicalRoom });
  try {
    await assert.rejects(
      runRoomCursorMaintenance({
        roomRoot: aliasRoom,
        operation: "rotate",
        expectedGeneration: runtime.cursorGeneration,
      }),
      /another Room application owner is active/u,
    );
  } finally {
    await runtime.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("renaming an active Room root and linking its old data back cannot create a second runtime", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "rah-room-runtime-relinked-"));
  const roomRoot = path.join(base, "room");
  const oldRoomRoot = path.join(base, "room.old");
  mkdirSync(roomRoot);
  const runtime = await createRoomApplicationRuntime({ roomRoot });
  try {
    renameSync(roomRoot, oldRoomRoot);
    symlinkSync(oldRoomRoot, roomRoot, "dir");
    await assert.rejects(
      createRoomApplicationRuntime({ roomRoot }),
      /another Room application owner is active/u,
    );
  } finally {
    await runtime.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("cursor maintenance is excluded while a Room application port is active", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "rah-room-runtime-active-"));
  const roomRoot = path.join(base, "room");
  const runtime = await createRoomApplicationRuntime({ roomRoot });
  try {
    await assert.rejects(
      runRoomCursorMaintenance({
        roomRoot,
        operation: "rotate",
        expectedGeneration: runtime.cursorGeneration,
      }),
      /another Room application owner is active/u,
    );
  } finally {
    await runtime.close();
  }

  const rotated = await runRoomCursorMaintenance({
    roomRoot,
    operation: "rotate",
    expectedGeneration: runtime.cursorGeneration,
  });
  assert.notEqual(rotated.generation, runtime.cursorGeneration);

  const replacement = await createRoomApplicationRuntime({ roomRoot });
  assert.equal(replacement.cursorGeneration, rotated.generation);
  await replacement.close();
  rmSync(base, { recursive: true, force: true });
});

test("Room runtime fails closed until interrupted cursor rotation is recovered offline", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "rah-room-runtime-recover-"));
  const roomRoot = path.join(base, "room");
  const layout = resolveRoomStorageLayout(roomRoot);
  const store = new RoomCursorKeyStore(layout.cursorKeyPath, {
    onRotationPhase(phase) {
      if (phase === "locked") throw new Error("simulated crash");
    },
  });
  const initial = store.loadOrCreate();
  assert.throws(() => store.rotate(initial.generation), /simulated crash/u);

  await assert.rejects(
    createRoomApplicationRuntime({ roomRoot }),
    /offline recovery required/u,
  );
  const recovered = await runRoomCursorMaintenance({
    roomRoot,
    operation: "recover",
    expectedGeneration: initial.generation,
  });
  assert.notEqual(recovered.generation, initial.generation);

  const runtime = await createRoomApplicationRuntime({ roomRoot });
  assert.equal(runtime.cursorGeneration, recovered.generation);
  await runtime.close();
  rmSync(base, { recursive: true, force: true });
});
