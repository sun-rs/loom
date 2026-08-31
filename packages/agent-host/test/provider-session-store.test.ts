import assert from "node:assert/strict";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProviderSessionStore } from "../src/provider-session-store.ts";

const key = {
  participantId: "agent-alice",
  provider: "codex-app-server/v1",
  runtimeProfileRevisionId: "profile-codex-v1",
  workspaceMountRevisionId: "workspace-mount-v1",
} as const;

test("Provider sessions are owner-private, durable, and keyed by immutable runtime locality", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-provider-session-store-"));
  const rootDirectory = join(directory, "sessions");
  try {
    const first = new ProviderSessionStore({
      now: () => new Date("2026-08-29T08:00:00.000Z"),
      rootDirectory,
    });
    assert.equal(await first.load(key), null);
    await first.record(key, "codex-thread-1");

    const second = new ProviderSessionStore({ rootDirectory });
    assert.deepEqual(await second.load(key), {
      ...key,
      providerSessionId: "codex-thread-1",
      recordedAt: "2026-08-29T08:00:00.000Z",
      schemaVersion: 1,
    });
    assert.equal(lstatSync(rootDirectory).mode & 0o077, 0);
    const files = readdirSync(rootDirectory);
    assert.equal(files.length, 1);
    assert.doesNotMatch(files[0]!, /alice|codex-thread/u);
    assert.equal(lstatSync(join(rootDirectory, files[0]!)).mode & 0o077, 0);

    await second.record(key, "codex-thread-2");
    assert.equal((await first.load(key))?.providerSessionId, "codex-thread-2");
    await second.invalidate(key);
    assert.equal(await first.load(key), null);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Provider session storage fails closed on an aliased root", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-provider-session-symlink-"),
  );
  const realRoot = join(directory, "real");
  const aliasRoot = join(directory, "alias");
  try {
    const real = new ProviderSessionStore({ rootDirectory: realRoot });
    await real.record(key, "codex-thread-1");
    await symlink(realRoot, aliasRoot);
    const aliased = new ProviderSessionStore({ rootDirectory: aliasRoot });
    await assert.rejects(() => aliased.load(key), /private|symbolic/u);
    assert.match(
      readFileSync(join(realRoot, readdirSync(realRoot)[0]!), "utf8"),
      /codex-thread-1/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Provider sessions can quarantine and roll back every continuity record for one Agent", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-provider-session-quarantine-"),
  );
  const rootDirectory = join(directory, "sessions");
  const store = new ProviderSessionStore({ rootDirectory });
  const aliceSecondKey = {
    ...key,
    provider: "kimi-acp/v1",
    runtimeProfileRevisionId: "profile-kimi-v1",
  } as const;
  const bobKey = { ...key, participantId: "agent-bob" } as const;
  try {
    await store.record(key, "codex-thread-1");
    await store.record(aliceSecondKey, "kimi-session-1");
    await store.record(bobKey, "bob-thread-1");

    const quarantine = await store.quarantineParticipant(
      "agent-alice",
      "memory-reset-operation-1",
    );
    assert.equal(quarantine.recordCount, 2);
    assert.equal(await store.load(key), null);
    assert.equal(await store.load(aliceSecondKey), null);
    assert.equal((await store.load(bobKey))?.providerSessionId, "bob-thread-1");

    await quarantine.rollback();
    assert.equal((await store.load(key))?.providerSessionId, "codex-thread-1");
    assert.equal(
      (await store.load(aliceSecondKey))?.providerSessionId,
      "kimi-session-1",
    );
    assert.equal((await store.load(bobKey))?.providerSessionId, "bob-thread-1");
    await quarantine.rollback();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
