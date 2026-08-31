import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { AgentMemoryConfigStore } from "../src/agent-memory-config-store.ts";

test("Cleaner defaults are lazy, revisions independent, persisted CAS and unset restore Raft defaults", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-cleaner-config-"));
  const rootDirectory = join(directory, "memory");
  try {
    const first = new AgentMemoryConfigStore(rootDirectory);
    assert.deepEqual(first.get("alice"), {
      appId: "system.cleaner",
      ownerParticipantId: "alice",
      revision: 0,
      overrides: {},
      effective: {
        enabled: true,
        threshold_bytes: 65536,
        interval_ms: 3600000,
      },
    });
    assert.equal(existsSync(rootDirectory), false);
    const next = first.patch("alice", {
      expectedRevision: 0,
      set: { threshold_bytes: 8192, enabled: false },
    });
    assert.equal(next.revision, 1);
    const second = new AgentMemoryConfigStore(rootDirectory);
    assert.deepEqual(second.get("alice"), next);
    assert.equal(second.get("bob").revision, 0);
    assert.throws(
      () =>
        second.patch("alice", { expectedRevision: 0, set: { enabled: true } }),
      /revision conflict/,
    );
    for (const patch of [
      { expectedRevision: 1, set: { threshold_bytes: 4095 } },
      { expectedRevision: 1, set: { interval_ms: 1 } },
      { expectedRevision: 1, set: { enabled: true }, unset: ["enabled"] },
      { expectedRevision: 1, unset: ["enabled", "enabled"] },
      { expectedRevision: 1, set: { unknown: true } },
    ])
      assert.throws(() => first.patch("alice", patch as never));
    assert.deepEqual(first.get("alice"), next);
    const restored = second.patch("alice", {
      expectedRevision: 1,
      unset: ["enabled", "threshold_bytes"],
    });
    assert.equal(restored.revision, 2);
    assert.deepEqual(restored.overrides, {});
    assert.equal(
      statSync(join(rootDirectory, ".cleaner-config.sqlite")).mode & 0o777,
      0o600,
    );
    assert.equal(existsSync(join(rootDirectory, "alice")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Cleaner config refuses unsafe roots and symlink stores without following or replacing them", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-cleaner-security-"));
  try {
    const store = new AgentMemoryConfigStore(directory);
    store.patch("alice", { expectedRevision: 0, set: { enabled: false } });
    chmodSync(directory, 0o755);
    assert.throws(() => store.get("alice"), /private/);
    chmodSync(directory, 0o700);
    const dbPath = join(directory, ".cleaner-config.sqlite");
    const linkRoot = join(directory, "linked");
    symlinkSync(directory, linkRoot);
    assert.throws(
      () => new AgentMemoryConfigStore(linkRoot).get("alice"),
      /private/,
    );
    assert.equal(statSync(dbPath).isFile(), true);
    const fileLinkRoot = join(directory, "file-link-root");
    mkdirSync(fileLinkRoot, { mode: 0o700 });
    symlinkSync(dbPath, join(fileLinkRoot, ".cleaner-config.sqlite"));
    assert.throws(
      () => new AgentMemoryConfigStore(fileLinkRoot).get("alice"),
      /private/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Two actual processes using the same expected revision produce exactly one committed winner", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-cleaner-cas-process-"));
  try {
    const script = `import { AgentMemoryConfigStore } from ${JSON.stringify(new URL("../src/agent-memory-config-store.ts", import.meta.url).href)};
      try { new AgentMemoryConfigStore(process.argv[1]).patch('alice', { expectedRevision: 0, set: { enabled: false } }); process.stdout.write('committed'); }
      catch (e) { if (e.code !== 'agent_memory_config_conflict') throw e; process.stdout.write('conflict'); }`;
    const results = await Promise.all(
      [1, 2].map(() =>
        promisify(execFile)(
          process.execPath,
          ["--input-type=module", "-e", script, directory],
          { timeout: 10000 },
        ),
      ),
    );
    assert.deepEqual(results.map((result) => result.stdout).sort(), [
      "committed",
      "conflict",
    ]);
    assert.equal(
      new AgentMemoryConfigStore(directory).get("alice").revision,
      1,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("A SQLite write failure rolls back the entire config update", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-cleaner-rollback-"));
  try {
    const store = new AgentMemoryConfigStore(directory);
    const original = store.patch("alice", {
      expectedRevision: 0,
      set: { enabled: false },
    });
    const database = new DatabaseSync(
      join(directory, ".cleaner-config.sqlite"),
    );
    try {
      database.exec(
        "CREATE TRIGGER reject_config BEFORE UPDATE ON cleaner_config BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END",
      );
    } finally {
      database.close();
    }
    assert.throws(
      () =>
        store.patch("alice", { expectedRevision: 1, set: { enabled: true } }),
      /simulated write failure/,
    );
    assert.deepEqual(store.get("alice"), original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
