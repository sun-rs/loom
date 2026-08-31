import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AgentMemoryCleanerRuntime } from "../src/agent-memory-cleaner.ts";

test("App Inbox check is non-draining; ack confirms only the observed notification", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rah-app-inbox-"));
  const path = join(directory, "MEMORY.md");
  let wakes = 0;
  const cleaner = new AgentMemoryCleanerRuntime({
    wake: () => {
      wakes++;
      return true;
    },
  });
  try {
    const source = "x".repeat(5_000);
    await writeFile(path, source, { mode: 0o600 });
    for (const owner of ["alice", "bob"])
      cleaner.applyConfig({
        enabled: true,
        intervalMs: 900_000,
        memoryIndexPath: path,
        ownerParticipantId: owner,
        revision: 1,
        thresholdBytes: 4_096,
      });
    assert.deepEqual(
      await cleaner.checkInbox("alice"),
      { items: [] },
      "Raft check only peeks: it must not measure or mint",
    );
    const checked = await cleaner.recheckInbox("alice");
    assert.equal(checked.measurement, "over_threshold");
    assert.equal(checked.items.length, 1);
    assert.equal(wakes, 0, "checking must not recursively wake a Runtime");
    const item = checked.items[0]!;
    assert.ok(Number.isSafeInteger(item.version));
    assert.deepEqual(
      await cleaner.checkInbox("alice"),
      { items: checked.items },
      "read does not drain or renew an unchanged item",
    );
    assert.equal(
      cleaner.acknowledgeHint("bob", item.itemId, item.version).acknowledged,
      false,
    );
    assert.equal(
      cleaner.acknowledgeHint("alice", item.itemId, item.version + 1)
        .acknowledged,
      false,
    );
    assert.deepEqual(
      cleaner.acknowledgeHint("alice", item.itemId, item.version),
      {
        acknowledged: true,
        proofScope: "notification_acknowledged_not_memory_cleaned",
      },
    );
    assert.deepEqual(cleaner.listHints("alice"), []);
    assert.deepEqual(
      await cleaner.checkInbox("alice"),
      { items: [] },
      "check after ack must not immediately recreate the notification",
    );
    assert.equal(
      cleaner.acknowledgeHint("alice", item.itemId, item.version).acknowledged,
      false,
    );
    assert.equal(
      await readFile(path, "utf8"),
      source,
      "Computer never edits the memory source",
    );
    const renewed = (await cleaner.recheckInbox("alice")).items[0]!;
    assert.equal(
      renewed.itemId,
      item.itemId,
      "Raft source identity remains stable",
    );
    assert.notEqual(
      renewed.version,
      item.version,
      "recreated notification rejects an old ack",
    );
    assert.equal(
      cleaner.acknowledgeHint("alice", item.itemId, item.version).acknowledged,
      false,
    );
    await writeFile(path, "# Concise index\n");
    assert.equal(
      (await cleaner.checkInbox("alice")).items.length,
      1,
      "only an explicit recheck or scheduled measurement reconciles the source",
    );
    assert.deepEqual(await cleaner.recheckInbox("alice"), {
      measurement: "under_threshold",
      items: [],
    });
    await rm(path);
    assert.deepEqual(
      await cleaner.recheckInbox("alice"),
      { measurement: "not_established", items: [] },
      "unreadable is not successful cleanup",
    );
  } finally {
    await cleaner.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a slow earlier measurement cannot replace a newer result or resurrect an acknowledged hint", async () => {
  type Inspection =
    | {
        bytes: number;
        thresholdBytes: number;
        kind: "over_threshold";
        summary: string;
        title: string;
      }
    | { bytes: number; thresholdBytes: number; kind: "within_threshold" };
  const pending: Array<(value: Inspection) => void> = [];
  const cleaner = new AgentMemoryCleanerRuntime({
    inspectIndex: () => new Promise((resolve) => pending.push(resolve)),
    wake: () => true,
  });
  const over: Inspection = {
    bytes: 5_000,
    thresholdBytes: 4_096,
    kind: "over_threshold",
    summary: "over",
    title: "over",
  };
  cleaner.applyConfig({
    enabled: true,
    intervalMs: 900_000,
    memoryIndexPath: "/isolated/MEMORY.md",
    ownerParticipantId: "alice",
    revision: 1,
    thresholdBytes: 4_096,
  });
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  try {
    const old = cleaner.recheckInbox("alice");
    await tick();
    const newer = cleaner.recheckInbox("alice");
    await tick();
    pending[1]!({ bytes: 10, thresholdBytes: 4_096, kind: "within_threshold" });
    assert.equal((await newer).measurement, "under_threshold");
    pending[0]!(over);
    assert.equal((await old).measurement, "not_established");
    assert.deepEqual(cleaner.listHints("alice"), []);
    const first = cleaner.recheckInbox("alice");
    await tick();
    pending[2]!(over);
    const item = (await first).items[0]!;
    const inflight = cleaner.recheckInbox("alice");
    await tick();
    assert.equal(
      cleaner.acknowledgeHint("alice", item.itemId, item.version).acknowledged,
      true,
    );
    pending[3]!(over);
    assert.equal((await inflight).measurement, "not_established");
    assert.deepEqual(cleaner.listHints("alice"), []);
  } finally {
    await cleaner.close();
  }
});
