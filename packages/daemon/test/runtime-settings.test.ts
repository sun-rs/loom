import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";
import type { RuntimeSettings as View } from "@rah-os/protocol";

import type { DaemonConfig } from "../src/config.ts";
import {
  DaemonRuntimeSettings,
  openDaemonRuntimeSettings,
} from "../src/daemon-runtime-settings.ts";
import {
  DEFAULT_PER_CLI_MAX_CONCURRENT_RUNS,
  RuntimeSettings,
} from "../src/runtime-settings.ts";

const runtimes = [
  {
    offerMaxConcurrent: 64,
    runtimeOfferId: "offer-codex",
    runtimeProfileId: "profile-codex",
  },
  {
    offerMaxConcurrent: 64,
    runtimeOfferId: "offer-claude",
    runtimeProfileId: "profile-claude",
  },
];

test("concurrency settings default to the Host cap, a conservative per-CLI cap and Raft's start gate", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-concurrency-settings-"));
  try {
    const settings = new RuntimeSettings({
      defaults: {
        maxConcurrentRuns: 20,
        maxConcurrentStarts: 5,
        minStartIntervalMs: 500,
      },
      path: join(directory, "runtime-settings.json"),
      runtimes,
    });
    assert.equal(DEFAULT_PER_CLI_MAX_CONCURRENT_RUNS, 4);
    assert.deepEqual(settings.read(), {
      maxConcurrentRuns: 20,
      maxConcurrentStarts: 5,
      minStartIntervalMs: 500,
      revision: 0,
      runtimes: runtimes.map((runtime) => ({
        ...runtime,
        maxConcurrentRuns: 4,
      })),
      wakeGuard: { instanceChainLimit: 10 },
      watchdog: {
        maxRunMs: 4 * 60 * 60_000,
        noProgressWarnMs: 15 * 60_000,
        queuedStallTerminateMs: 15 * 60_000,
      },
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a concurrency update is validated, persisted owner-private, applied to listeners and survives a restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-concurrency-settings-"));
  const path = join(directory, "runtime-settings.json");
  const defaults = {
    maxConcurrentRuns: 20,
    maxConcurrentStarts: 5,
    minStartIntervalMs: 500,
  };
  try {
    const settings = new RuntimeSettings({
      defaults,
      path,
      runtimes,
    });
    const applied: View[] = [];
    settings.onChange((view) => applied.push(view));

    const updated = settings.update({
      expectedRevision: 0,
      maxConcurrentRuns: 8,
      maxConcurrentStarts: 2,
      minStartIntervalMs: 0,
      runtimes: [{ maxConcurrentRuns: 1, runtimeProfileId: "profile-claude" }],
    });
    assert.equal(updated.revision, 1);
    assert.equal(updated.maxConcurrentRuns, 8);
    assert.equal(updated.maxConcurrentStarts, 2);
    assert.equal(updated.minStartIntervalMs, 0);
    assert.deepEqual(
      updated.runtimes.map((runtime) => runtime.maxConcurrentRuns),
      [4, 1],
    );
    assert.deepEqual(applied, [updated]);
    assert.equal(statSync(path).mode & 0o777, 0o600);

    assert.throws(
      () => settings.update({ expectedRevision: 0, maxConcurrentRuns: 3 }),
      /revision/u,
    );
    assert.throws(
      () =>
        settings.update({
          expectedRevision: 1,
          runtimes: [{ maxConcurrentRuns: 2, runtimeProfileId: "missing" }],
        }),
      /missing/u,
    );
    assert.throws(() =>
      settings.update({ expectedRevision: 1, maxConcurrentRuns: 0 }),
    );
    assert.equal(
      settings.read().revision,
      1,
      "rejected updates change nothing",
    );
    assert.equal(applied.length, 1);

    const restarted = new RuntimeSettings({
      defaults,
      path,
      runtimes,
    });
    assert.deepEqual(restarted.read(), updated);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the daemon reads runtime-settings.json and migrates a legacy runtime-concurrency.json once, atomically, keeping the legacy file", () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), "loom-runtime-settings-"));
  const legacyPath = join(stateDirectory, "runtime-concurrency.json");
  const path = join(stateDirectory, "runtime-settings.json");
  // Only the fields the daemon opener reads (v4 Host cap, runtimes, state).
  const config = {
    host: { hostId: "host-1", maxConcurrent: 20 },
    runtimes: runtimes.map((runtime) => ({
      offer: {
        maxConcurrent: runtime.offerMaxConcurrent,
        runtimeOfferId: runtime.runtimeOfferId,
      },
      runtimeProfileId: runtime.runtimeProfileId,
    })),
    schemaVersion: 4,
    stateDirectory,
  } as unknown as DaemonConfig;
  try {
    const legacy = JSON.stringify({
      maxConcurrentRuns: 6,
      revision: 3,
      runtimeMaxConcurrentRuns: { "profile-codex": 2 },
      wakeGuard: { instanceChainLimit: 7 },
    });
    writeFileSync(legacyPath, legacy, { mode: 0o600 });

    const migrated = openDaemonRuntimeSettings(config)!.settings;
    assert.equal(migrated.path, path);
    const view = migrated.read();
    assert.equal(view.revision, 3);
    assert.equal(view.maxConcurrentRuns, 6);
    assert.deepEqual(
      view.runtimes.map((runtime) => runtime.maxConcurrentRuns),
      [2, 4],
    );
    assert.equal(view.wakeGuard.instanceChainLimit, 7);
    assert.ok(existsSync(path), "the new file is written at startup");
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(
      JSON.parse(readFileSync(path, "utf8")),
      JSON.parse(legacy),
    );
    assert.equal(
      readFileSync(legacyPath, "utf8"),
      legacy,
      "the legacy file is kept unchanged",
    );

    const updated = migrated.update({
      expectedRevision: 3,
      maxConcurrentRuns: 9,
    });
    assert.equal(updated.revision, 4);
    assert.equal(readFileSync(legacyPath, "utf8"), legacy);

    // Once the new file exists the legacy one is never read again.
    const reopened = openDaemonRuntimeSettings(config)!.settings.read();
    assert.deepEqual(reopened, updated);

    rmSync(legacyPath);
    rmSync(path);
    assert.equal(
      openDaemonRuntimeSettings(config)!.settings.read().revision,
      0,
      "neither file: defaults",
    );
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

/**
 * evo §37 C: the wake-guard and watchdog groups share the concurrency
 * settings' document, revision and API; a change is validated, persisted,
 * pushed to the Kernel at once and survives a restart.
 */
test("the wakeGuard and watchdog groups update partially under the shared revision, persist and survive a restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-run-guard-settings-"));
  const path = join(directory, "runtime-settings.json");
  const defaults = {
    maxConcurrentRuns: 20,
    maxConcurrentStarts: 5,
    minStartIntervalMs: 500,
  };
  try {
    const settings = new RuntimeSettings({
      defaults,
      path,
      runtimes,
    });
    const first = settings.update({
      expectedRevision: 0,
      wakeGuard: { instanceChainLimit: 4 },
    });
    assert.equal(first.revision, 1);
    assert.deepEqual(first.wakeGuard, { instanceChainLimit: 4 });
    assert.equal(first.maxConcurrentRuns, 20, "other groups are untouched");
    const second = settings.update({
      expectedRevision: 1,
      watchdog: { maxRunMs: 60 * 60_000 },
    });
    assert.deepEqual(second.watchdog, {
      maxRunMs: 60 * 60_000,
      noProgressWarnMs: 15 * 60_000,
      queuedStallTerminateMs: 15 * 60_000,
    });
    assert.deepEqual(second.wakeGuard, { instanceChainLimit: 4 });
    for (const bad of [
      { wakeGuard: { instanceChainLimit: 0 } },
      { watchdog: { maxRunMs: 1_000 } },
      { watchdog: { noProgressWarnMs: 2 * 24 * 60 * 60_000 } },
    ])
      assert.throws(
        () => settings.update({ expectedRevision: 2, ...bad }),
        JSON.stringify(bad),
      );
    assert.equal(
      settings.read().revision,
      2,
      "rejected updates change nothing",
    );
    const restarted = new RuntimeSettings({
      defaults,
      path,
      runtimes,
    });
    assert.deepEqual(restarted.read(), second);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("attaching the settings pushes the wakeGuard and watchdog groups into the Kernel now and on every update", () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-run-guard-attach-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  kernel.initialize();
  try {
    const settings = new RuntimeSettings({
      defaults: {
        maxConcurrentRuns: 2,
        maxConcurrentStarts: 5,
        minStartIntervalMs: 500,
      },
      path: join(directory, "runtime-settings.json"),
      runtimes,
    });
    settings.update({
      expectedRevision: 0,
      watchdog: { noProgressWarnMs: 5 * 60_000 },
    });
    new DaemonRuntimeSettings("host-1", settings).attach({
      kernel,
      lanes: undefined,
      pool: undefined,
    });
    assert.equal(kernel.runGuards.watchdog().noProgressWarnMs, 5 * 60_000);
    settings.update({
      expectedRevision: 1,
      wakeGuard: { instanceChainLimit: 3 },
    });
    assert.equal(kernel.runGuards.wakeGuard().instanceChainLimit, 3);
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
