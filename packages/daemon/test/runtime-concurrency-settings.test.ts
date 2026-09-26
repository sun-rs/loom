import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RuntimeConcurrencySettings as View } from "@rah-os/protocol";

import {
  DEFAULT_PER_CLI_MAX_CONCURRENT_RUNS,
  RuntimeConcurrencySettings,
} from "../src/runtime-concurrency-settings.ts";

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
    const settings = new RuntimeConcurrencySettings({
      defaults: {
        maxConcurrentRuns: 20,
        maxConcurrentStarts: 5,
        minStartIntervalMs: 500,
      },
      path: join(directory, "runtime-concurrency.json"),
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
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a concurrency update is validated, persisted owner-private, applied to listeners and survives a restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-concurrency-settings-"));
  const path = join(directory, "runtime-concurrency.json");
  const defaults = {
    maxConcurrentRuns: 20,
    maxConcurrentStarts: 5,
    minStartIntervalMs: 500,
  };
  try {
    const settings = new RuntimeConcurrencySettings({
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

    const restarted = new RuntimeConcurrencySettings({
      defaults,
      path,
      runtimes,
    });
    assert.deepEqual(restarted.read(), updated);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
