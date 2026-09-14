import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  utimes,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  rotateLogIfNeeded,
  openServiceLogs,
} from "../src/service-log-rotation.ts";

const now = new Date("2026-09-13T12:00:00Z");
test("Raft rotation keeps threshold bytes, rotates above it and never overwrites same-day archives", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rah-rotation-"));
  const path = join(dir, "core.stdout.log");
  try {
    await writeFile(path, "1234");
    await utimes(path, now, now);
    assert.equal(
      await rotateLogIfNeeded(path, { now, maxBytes: 4 }),
      undefined,
    );
    for (const [index, body] of ["first", "second"].entries()) {
      await writeFile(path, body);
      await utimes(path, now, now);
      const archive = await rotateLogIfNeeded(path, { now, maxBytes: 4 });
      assert.equal(
        archive,
        join(dir, `core.stdout.2026-09-13${index ? ".1" : ""}.log`),
      );
      assert.equal(await readFile(archive!, "utf8"), body);
    }
    assert.equal(
      await readFile(join(dir, "core.stdout.2026-09-13.log"), "utf8"),
      "first",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("UTC day change rotates small files, 14-day pruning is exact and does not touch unrelated files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rah-rotation-"));
  const path = join(dir, "core.stderr.log");
  try {
    for (const name of [
      "core.stderr.2026-08-29.log",
      "core.stderr.2026-08-29.1.log",
      "core.stderr.2026-08-30.log",
      "core.stderr.2026-08-30.1.log",
      "other.2026-08-01.log",
      "core.stderr.not-a-date.log",
    ])
      await writeFile(join(dir, name), "keep");
    await writeFile(path, "yesterday");
    await utimes(
      path,
      new Date("2026-09-12T23:59:59Z"),
      new Date("2026-09-12T23:59:59Z"),
    );
    assert.equal(
      await rotateLogIfNeeded(path, { now }),
      join(dir, "core.stderr.2026-09-12.log"),
    );
    assert.deepEqual(
      (await readdir(dir)).sort(),
      [
        "core.stderr.2026-08-30.1.log",
        "core.stderr.2026-08-30.log",
        "core.stderr.2026-09-12.log",
        "core.stderr.not-a-date.log",
        "other.2026-08-01.log",
      ].sort(),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("service startup opens fresh log descriptors after rotation, preserving archived bytes", async () => {
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "rah-rotation-"));
  try {
    const path = join(dir, "core.stdout.log");
    await writeFile(path, "previous");
    await utimes(path, now, now);
    const logs = await openServiceLogs(dir, "core", { now, maxBytes: 4 });
    try {
      assert.equal(
        spawnSync(
          process.execPath,
          ["-e", "process.stdout.write('new');process.stderr.write('err')"],
          { stdio: ["ignore", logs.stdout.fd, logs.stderr.fd] },
        ).status,
        0,
      );
    } finally {
      await logs.close();
    }
    assert.equal(await readFile(path, "utf8"), "new");
    assert.equal(
      await readFile(join(dir, "core.stdout.2026-09-13.log"), "utf8"),
      "previous",
    );
    assert.equal(await readFile(join(dir, "core.stderr.log"), "utf8"), "err");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("rotation refuses links and propagates filesystem failures without deleting the source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rah-rotation-"));
  try {
    await writeFile(join(dir, "target"), "untouched");
    await symlink(join(dir, "target"), join(dir, "service.log"));
    await assert.rejects(
      rotateLogIfNeeded(join(dir, "service.log"), { now }),
      /regular/,
    );
    assert.equal(await readFile(join(dir, "target"), "utf8"), "untouched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the production default rotates only above 64 MiB", async () => {
  const { truncate, stat } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "rah-log-limit-"));
  const path = join(dir, "service.log");
  try {
    await writeFile(path, "");
    await truncate(path, 64 * 1024 * 1024);
    await utimes(path, now, now);
    assert.equal(await rotateLogIfNeeded(path, { now }), undefined);
    await truncate(path, 64 * 1024 * 1024 + 1);
    await utimes(path, now, now);
    const archive = await rotateLogIfNeeded(path, { now });
    assert.equal((await stat(archive!)).size, 64 * 1024 * 1024 + 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
