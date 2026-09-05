import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { RoomApplicationLease } from "./room-application-lease";

test("RoomApplicationLease permits one Room application owner per durable root", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "rah-room-lease-"));
  const root = path.join(base, "room");
  mkdirSync(root);
  const first = await RoomApplicationLease.acquire(root);
  try {
    await assert.rejects(
      RoomApplicationLease.acquire(root),
      /another Room application owner is active/u,
    );
  } finally {
    await first.close();
  }

  const replacement = await RoomApplicationLease.acquire(root);
  await replacement.close();
  await replacement.close();
  rmSync(base, { recursive: true, force: true });
});

test("RoomApplicationLease holds both stable-location and movable-root owner artifacts", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "rah-room-lease-path-"));
  const root = path.join(base, "room");
  mkdirSync(root);
  const lease = await RoomApplicationLease.acquire(root);
  try {
    assert.equal(lease.leasePaths.length, 2);
    assert.equal(
      path.dirname(lease.leasePaths[0]!),
      path.join(path.dirname(realpathSync.native(root)), ".rah-room-locks"),
    );
    assert.match(path.basename(lease.leasePaths[0]!), /^[a-f0-9]{40}\.sqlite$/u);
    assert.equal(
      lease.leasePaths[1],
      path.join(realpathSync.native(root), ".rah-room-owner.sqlite"),
    );
  } finally {
    await lease.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test(
  "RoomApplicationLease keeps a renamed Room root owned across processes",
  { timeout: 10_000 },
  async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), "rah-room-lease-moved-"));
    const root = path.join(base, "room");
    const movedRoot = path.join(base, "room.old");
    mkdirSync(root);
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        [
          'import { RoomApplicationLease } from "./packages/runtime-daemon/src/room/room-application-lease.ts";',
          "await RoomApplicationLease.acquire(process.argv[1]);",
          'process.stdout.write("ready\\n");',
          "setInterval(() => {}, 60_000);",
        ].join(" "),
        root,
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("child lease did not become ready")),
          5_000,
        );
        child.once("error", reject);
        child.stdout.once("data", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      renameSync(root, movedRoot);
      await assert.rejects(
        RoomApplicationLease.acquire(movedRoot),
        /another Room application owner is active/u,
      );

      child.kill("SIGKILL");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
      const recovered = await RoomApplicationLease.acquire(movedRoot);
      await recovered.close();
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test("RoomApplicationLease survives atomic replacement of the Room data root", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "rah-room-lease-replace-"));
  const root = path.join(base, "room");
  const replacedRoot = path.join(base, "room.old");
  mkdirSync(root);
  const first = await RoomApplicationLease.acquire(root);
  try {
    renameSync(root, replacedRoot);
    mkdirSync(root);
    await assert.rejects(
      RoomApplicationLease.acquire(root),
      /another Room application owner is active/u,
    );
  } finally {
    await first.close();
  }

  const replacement = await RoomApplicationLease.acquire(root);
  await replacement.close();
  rmSync(base, { recursive: true, force: true });
});

test(
  "RoomApplicationLease elects exactly one owner after a crash under concurrent recovery",
  { timeout: 30_000 },
  async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), "rah-room-lease-race-"));
    const root = path.join(base, "room");
    mkdirSync(root);
    const barrier = path.join(base, "start");
    const owner = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        [
          'import { RoomApplicationLease } from "./packages/runtime-daemon/src/room/room-application-lease.ts";',
          "await RoomApplicationLease.acquire(process.argv[1]);",
          'process.stdout.write("ready\\n");',
          "setInterval(() => {}, 60_000);",
        ].join(" "),
        root,
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    );
    const contenders: Array<ReturnType<typeof spawn>> = [];
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("crash owner did not become ready")),
          5_000,
        );
        owner.once("error", reject);
        owner.stdout.once("data", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      owner.kill("SIGKILL");
      await new Promise<void>((resolve) => owner.once("exit", () => resolve()));

      const waiting: Array<Promise<void>> = [];
      const outcomes: Array<Promise<"acquired" | "rejected">> = [];
      for (let index = 0; index < 16; index += 1) {
        const contender = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "--input-type=module",
            "--eval",
            [
              'import { existsSync } from "node:fs";',
              'import { setTimeout as delay } from "node:timers/promises";',
              'import { RoomApplicationLease } from "./packages/runtime-daemon/src/room/room-application-lease.ts";',
              'process.stdout.write("waiting\\n");',
              "while (!existsSync(process.argv[2])) await delay(5);",
              "try {",
              "  await RoomApplicationLease.acquire(process.argv[1]);",
              '  process.stdout.write("acquired\\n");',
              "  setInterval(() => {}, 60_000);",
              "} catch {",
              '  process.stdout.write("rejected\\n");',
              "}",
            ].join(" "),
            root,
            barrier,
          ],
          { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
        );
        contenders.push(contender);
        let output = "";
        const outputChanged: Array<() => void> = [];
        contender.stdout.on("data", (chunk) => {
          output += String(chunk);
          for (const notify of outputChanged.splice(0)) notify();
        });
        const waitFor = async (pattern: RegExp): Promise<void> => {
          const deadline = Date.now() + 10_000;
          while (!pattern.test(output)) {
            if (Date.now() >= deadline) {
              throw new Error(`contender output timeout: ${output}`);
            }
            await new Promise<void>((resolve) => {
              outputChanged.push(resolve);
              setTimeout(resolve, 100).unref?.();
            });
          }
        };
        waiting.push(waitFor(/waiting/u));
        outcomes.push(
          waitFor(/acquired|rejected/u).then(() =>
            /acquired/u.test(output) ? "acquired" : "rejected",
          ),
        );
      }

      await Promise.all(waiting);
      writeFileSync(barrier, "go", "utf8");
      const results = await Promise.all(outcomes);
      assert.equal(results.filter((result) => result === "acquired").length, 1);
      assert.equal(results.filter((result) => result === "rejected").length, 15);
    } finally {
      if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
      for (const contender of contenders) {
        if (contender.exitCode === null && contender.signalCode === null) {
          contender.kill("SIGKILL");
        }
      }
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test("RoomApplicationLease excludes another process and recovers after SIGKILL", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "rah-room-lease-process-"));
  const root = path.join(base, "room");
  mkdirSync(root);
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      [
        'import { RoomApplicationLease } from "./packages/runtime-daemon/src/room/room-application-lease.ts";',
        "const lease = await RoomApplicationLease.acquire(process.argv[1]);",
        'process.stdout.write("ready\\n");',
        "setInterval(() => {}, 60_000);",
      ].join(" "),
      root,
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("child lease did not become ready")), 5_000);
      child.once("error", reject);
      child.stdout.once("data", (chunk) => {
        clearTimeout(timer);
        assert.match(String(chunk), /ready/u);
        resolve();
      });
    });
    await assert.rejects(
      RoomApplicationLease.acquire(root),
      /another Room application owner is active/u,
    );
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));

    const recovered = await RoomApplicationLease.acquire(root);
    await recovered.close();
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    rmSync(base, { recursive: true, force: true });
  }
});

test("RoomApplicationLease treats symlink aliases as one physical owner root", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "rah-room-lease-alias-"));
  const physicalParent = path.join(base, "physical");
  const aliasParent = path.join(base, "alias");
  mkdirSync(physicalParent);
  symlinkSync(physicalParent, aliasParent, "dir");
  const physicalRoom = path.join(physicalParent, "room");
  const aliasRoom = path.join(aliasParent, "room");

  const lease = await RoomApplicationLease.acquire(physicalRoom);
  try {
    await assert.rejects(
      RoomApplicationLease.acquire(aliasRoom),
      /another Room application owner is active/u,
    );
  } finally {
    await lease.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("RoomApplicationLease also excludes a symlink at the Room root itself", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "rah-room-lease-root-alias-"));
  const physicalRoom = path.join(base, "physical-room");
  const aliasRoom = path.join(base, "alias-room");
  mkdirSync(physicalRoom);
  symlinkSync(physicalRoom, aliasRoom, "dir");

  const lease = await RoomApplicationLease.acquire(physicalRoom);
  try {
    await assert.rejects(
      RoomApplicationLease.acquire(aliasRoom),
      /another Room application owner is active/u,
    );
  } finally {
    await lease.close();
    rmSync(base, { recursive: true, force: true });
  }
});
