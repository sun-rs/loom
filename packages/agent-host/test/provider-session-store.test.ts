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

test("Provider continuity quarantine replays the same durable operation after a process restart", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-provider-session-quarantine-replay-"),
  );
  const rootDirectory = join(directory, "sessions");
  const aliceSecondKey = {
    ...key,
    provider: "kimi-acp/v1",
    runtimeProfileRevisionId: "profile-kimi-v1",
  } as const;
  try {
    const first = new ProviderSessionStore({ rootDirectory });
    await first.record(key, "codex-thread-1");
    await first.record(aliceSecondKey, "kimi-session-1");
    const interrupted = await first.quarantineParticipant(
      "agent-alice",
      "execution-reset-operation-replay",
    );
    assert.equal(interrupted.recordCount, 2);

    const recovered = new ProviderSessionStore({ rootDirectory });
    const replay = await recovered.quarantineParticipant(
      "agent-alice",
      "execution-reset-operation-replay",
    );
    assert.equal(replay.recordCount, 2);
    assert.equal(await recovered.load(key), null);
    assert.equal(await recovered.load(aliceSecondKey), null);
    await assert.rejects(
      recovered.quarantineParticipant(
        "agent-bob",
        "execution-reset-operation-replay",
      ),
      /different immutable participant/u,
    );

    await replay.rollback();
    assert.equal(
      (await recovered.load(key))?.providerSessionId,
      "codex-thread-1",
    );
    assert.equal(
      (await recovered.load(aliceSecondKey))?.providerSessionId,
      "kimi-session-1",
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the standing prompt digest is part of Provider session locality", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-provider-session-digest-"));
  const rootDirectory = join(directory, "sessions");
  try {
    const store = new ProviderSessionStore({
      now: () => new Date("2026-09-08T08:00:00.000Z"),
      rootDirectory,
    });
    const original = { ...key, standingPromptDigest: "digest-role-v1" };
    await store.record(original, "codex-thread-role-v1");
    assert.equal(
      (await store.load(original))?.providerSessionId,
      "codex-thread-role-v1",
    );
    assert.equal(
      await store.load({ ...original, standingPromptDigest: "digest-role-v2" }),
      null,
      "an edited Agent role cannot resume the previous Provider session",
    );
    assert.equal(
      await store.load(key),
      null,
      "a digest-free legacy key stays a distinct record",
    );
    await store.record(key, "codex-thread-legacy");
    assert.equal(
      (await store.load(original))?.providerSessionId,
      "codex-thread-role-v1",
    );
    assert.equal(readdirSync(rootDirectory).length, 2);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("native system memory digest is optional transport metadata and survives a store reload", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-session-memory-"));
  try {
    const store = new ProviderSessionStore({ rootDirectory: directory });
    await store.record(key, "native-memory-session", {
      systemMemorySha256: "a".repeat(64),
    });
    assert.equal((await store.load(key))?.systemMemorySha256, "a".repeat(64));
    await store.record(key, "legacy-session");
    assert.equal((await store.load(key))?.systemMemorySha256, undefined);
    await assert.rejects(
      store.record(key, "bad", { systemMemorySha256: "not-a-digest" }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("instance session survives configuration key changes and Host restart without replacing identity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-instance-session-"));
  try {
    const store = new ProviderSessionStore({ rootDirectory: directory });
    // Adopt an existing MVP session, without creating a new provider session.
    await store.record(key, "original-session", {
      systemMemorySha256: "a".repeat(64),
    });
    const changed = {
      ...key,
      runtimeProfileRevisionId: "profile-v2",
      workspaceMountRevisionId: "mount-v2",
      standingPromptDigest: "changed-prompt",
    };
    const adopted = await store.load(changed, { instance: true });
    assert.equal(adopted?.providerSessionId, "original-session");
    assert.equal(adopted?.systemMemorySha256, "a".repeat(64));
    await store.record(changed, "original-session", { instance: true });
    const restarted = new ProviderSessionStore({ rootDirectory: directory });
    assert.equal(
      (await restarted.load(key, { instance: true }))?.providerSessionId,
      "original-session",
    );
    await assert.rejects(
      restarted.record(changed, "silent-replacement", { instance: true }),
      /continuity/i,
    );
    await assert.rejects(
      restarted.load(
        { ...changed, provider: "other-cli/v1" },
        { instance: true },
      ),
      /continuity/i,
    );
    assert.equal(
      (await restarted.load(changed, { instance: true }))?.providerSessionId,
      "original-session",
    );
    // Legacy Agents still resolve exact configuration keys.
    assert.equal(await restarted.load(changed), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("instance adoption refuses ambiguous histories and keeps participants separate", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-instance-session-conflict-"),
  );
  try {
    const store = new ProviderSessionStore({ rootDirectory: directory });
    await store.record(key, "first-session");
    await store.record(
      { ...key, standingPromptDigest: "other" },
      "second-session",
    );
    await assert.rejects(store.load(key, { instance: true }), /continuity/i);
    assert.equal(
      await store.load(
        { ...key, participantId: "new-instance" },
        { instance: true },
      ),
      null,
    );
    await store.record(
      { ...key, participantId: "new-instance" },
      "independent-session",
      { instance: true },
    );
    assert.equal(
      (
        await store.load(
          { ...key, participantId: "new-instance" },
          { instance: true },
        )
      )?.providerSessionId,
      "independent-session",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("previously launched instance cannot silently restart after binding record loss", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-instance-lost-binding-"));
  try {
    const store = new ProviderSessionStore({ rootDirectory: directory });
    assert.equal(await store.load(key, { instance: true }), null);
    await store.record(key, "bound-session", { instance: true });
    assert.equal(
      (await store.load(key, { instance: true, requireExisting: true }))
        ?.providerSessionId,
      "bound-session",
    );
    for (const file of readdirSync(directory)) rmSync(join(directory, file));
    await assert.rejects(
      new ProviderSessionStore({ rootDirectory: directory }).load(key, {
        instance: true,
        requireExisting: true,
      }),
      /RAH_SESSION_CONTINUITY_REQUIRED/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
