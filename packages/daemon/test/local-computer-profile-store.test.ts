import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LocalComputerProfileStore,
  LocalComputerProfileStoreError,
} from "../src/local-computer-profile-store.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "rah-computer-profile-"));
  const stateDirectory = join(root, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  return {
    dispose: () => rmSync(root, { force: true, recursive: true }),
    path: join(stateDirectory, "computer-profiles.json"),
    root,
    stateDirectory,
  };
}

const update = {
  description: "用于本地开发和测试",
  displayName: "Mac Studio",
  expectedRevision: 0,
  hostId: "host_local",
  idempotencyKey: "computer-profile-update-1",
} as const;

test("Computer profile is durable, revisioned and idempotent", () => {
  const target = fixture();
  let now = Date.parse("2026-09-02T08:00:00.000Z");
  try {
    const store = new LocalComputerProfileStore({
      clock: () => now,
      path: target.path,
    });
    assert.equal(store.read(update.hostId), undefined);

    const first = store.update(update);
    assert.equal(first.deduplicated, false);
    assert.deepEqual(first.computer, {
      description: update.description,
      displayName: update.displayName,
      hostId: update.hostId,
      revision: 1,
      updatedAt: "2026-09-02T08:00:00.000Z",
    });
    assert.equal(store.update(update).deduplicated, true);

    now += 1_000;
    const reopened = new LocalComputerProfileStore({
      clock: () => now,
      path: target.path,
    });
    assert.deepEqual(reopened.read(update.hostId), first.computer);
    const second = reopened.update({
      ...update,
      description: "   ",
      displayName: " Mac Studio Pro ",
      expectedRevision: 1,
      idempotencyKey: "computer-profile-update-2",
    });
    assert.equal(second.computer.description, null);
    assert.equal(second.computer.displayName, "Mac Studio Pro");
    assert.equal(second.computer.revision, 2);
    assert.equal(second.computer.updatedAt, "2026-09-02T08:00:01.000Z");
    assert.equal(
      JSON.parse(readFileSync(target.path, "utf8")).schemaVersion,
      1,
    );
  } finally {
    target.dispose();
  }
});

test("Computer profile rejects stale revisions and conflicting idempotency", () => {
  const target = fixture();
  try {
    const store = new LocalComputerProfileStore({ path: target.path });
    store.update(update);
    assert.throws(
      () =>
        store.update({
          ...update,
          displayName: "Different",
        }),
      (error) =>
        error instanceof LocalComputerProfileStoreError &&
        error.code === "idempotency_conflict",
    );
    assert.throws(
      () =>
        store.update({
          ...update,
          displayName: "Stale",
          idempotencyKey: "computer-profile-update-stale",
        }),
      (error) =>
        error instanceof LocalComputerProfileStoreError &&
        error.code === "revision_conflict",
    );
  } finally {
    target.dispose();
  }
});

test("Computer profile does not publish an in-memory update when persistence fails", () => {
  const target = fixture();
  try {
    const store = new LocalComputerProfileStore({ path: target.path });
    rmSync(target.stateDirectory, { force: true, recursive: true });

    assert.throws(() => store.update(update));
    assert.equal(store.read(update.hostId), undefined);
  } finally {
    target.dispose();
  }
});

test("Computer profile state fails closed for unsafe or malformed persistence", () => {
  const cases: Array<(target: ReturnType<typeof fixture>) => void> = [
    (target) => {
      writeFileSync(target.path, '{"schemaVersion":2}\n', { mode: 0o600 });
    },
    (target) => {
      writeFileSync(target.path, "not-json\n", { mode: 0o600 });
    },
    (target) => {
      writeFileSync(target.path, '{"schemaVersion":1}\n', { mode: 0o666 });
    },
    (target) => {
      const outside = join(target.root, "outside.json");
      writeFileSync(outside, "{}\n", { mode: 0o600 });
      symlinkSync(outside, target.path);
    },
  ];

  for (const arrange of cases) {
    const target = fixture();
    try {
      arrange(target);
      assert.throws(() => new LocalComputerProfileStore({ path: target.path }));
    } finally {
      target.dispose();
    }
  }

  const unsafeParent = fixture();
  try {
    chmodSync(unsafeParent.stateDirectory, 0o755);
    assert.throws(
      () => new LocalComputerProfileStore({ path: unsafeParent.path }),
    );
  } finally {
    unsafeParent.dispose();
  }
});
