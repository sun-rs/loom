import assert from "node:assert/strict";
import test from "node:test";
import {
  settingsFormFrom,
  buildSettingsUpdate,
} from "../../frontends/raft/loom/runtime-settings-form.ts";
const base = {
  revision: 7,
  maxConcurrentRuns: 4,
  maxConcurrentStarts: 2,
  minStartIntervalMs: 100,
  wakeGuard: { instanceChainLimit: 10 },
  watchdog: {
    noProgressWarnMs: 900000,
    queuedStallTerminateMs: 900000,
    maxRunMs: 14400000,
  },
  prewarm: { enabled: false, recentActiveHours: 24 },
  runtimes: [
    {
      runtimeProfileId: "fixture",
      runtimeOfferId: "offer",
      maxConcurrentRuns: 2,
      offerMaxConcurrent: 4,
    },
  ],
};
test("settings emit only changed fields bound to the editor revision", () => {
  const form = settingsFormFrom(base);
  assert.equal(buildSettingsUpdate(base, form).ok, false);
  form.maxConcurrentStarts = "3";
  form.noProgressWarnMinutes = "1.5";
  form.prewarmEnabled = "1";
  form.runtimes.fixture = "3";
  assert.deepEqual(buildSettingsUpdate(base, form), {
    ok: true,
    value: {
      expectedRevision: 7,
      maxConcurrentStarts: 3,
      watchdog: { noProgressWarnMs: 90000 },
      prewarm: { enabled: true },
      runtimes: [{ runtimeProfileId: "fixture", maxConcurrentRuns: 3 }],
    },
  });
});
test("invalid values never become a runtime patch", () => {
  for (const [key, value] of [
    ["maxConcurrentRuns", "65"],
    ["maxConcurrentStarts", "0"],
    ["minStartIntervalMs", "60001"],
    ["wakeChainLimit", "1001"],
    ["maxRunMinutes", "10081"],
    ["noProgressWarnMinutes", "0"],
    ["queuedStallTerminateMinutes", "1441"],
    ["prewarmRecentHours", "721"],
    ["prewarmEnabled", "maybe"],
    ["maxConcurrentRuns", ""],
  ]) {
    const form = settingsFormFrom(base);
    form[key] = value;
    assert.equal(buildSettingsUpdate(base, form).ok, false, key);
  }
});
