import assert from "node:assert/strict";
import {
  existsSync,
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
  prepareRahDataHome,
  resolveRahDataHome,
} from "../src/rah-data-home.ts";

test("RAH OS uses the stable ~/.rah data root without its current product name", () => {
  assert.equal(
    resolveRahDataHome({ environment: {}, userHomeDirectory: "/Users/test" }),
    "/Users/test/.rah",
  );
});

test("RAH_DATA_HOME is canonical and RAH_OS_HOME remains a direct-root alias", () => {
  assert.equal(
    resolveRahDataHome({
      environment: { RAH_DATA_HOME: "/data/rah" },
      userHomeDirectory: "/Users/test",
    }),
    "/data/rah",
  );
  assert.equal(
    resolveRahDataHome({
      environment: { RAH_OS_HOME: "/legacy/direct-root" },
      userHomeDirectory: "/Users/test",
    }),
    "/legacy/direct-root",
  );
  assert.throws(
    () =>
      resolveRahDataHome({
        environment: {
          RAH_DATA_HOME: "/data/rah",
          RAH_OS_HOME: "/other/root",
        },
        userHomeDirectory: "/Users/test",
      }),
    /conflicting RAH data roots/u,
  );
});

test("first default start atomically adopts the legacy Application Support root", async () => {
  const userHomeDirectory = mkdtempSync(join(tmpdir(), "rah-data-home-"));
  const legacy = join(
    userHomeDirectory,
    "Library",
    "Application Support",
    "RAH OS",
  );
  mkdirSync(join(legacy, "state"), { recursive: true });
  writeFileSync(join(legacy, "state", "room.db"), "ledger");
  try {
    const dataRoot = await prepareRahDataHome({
      environment: {},
      userHomeDirectory,
    });
    assert.equal(dataRoot, join(userHomeDirectory, ".rah"));
    assert.equal(
      readFileSync(join(dataRoot, "state", "room.db"), "utf8"),
      "ledger",
    );
    assert.equal(existsSync(legacy), false);
  } finally {
    rmSync(userHomeDirectory, { force: true, recursive: true });
  }
});

test("migration safely merges RAH OS state beside existing legacy RAH data", async () => {
  const userHomeDirectory = mkdtempSync(join(tmpdir(), "rah-data-home-"));
  const dataRoot = join(userHomeDirectory, ".rah");
  const legacy = join(
    userHomeDirectory,
    "Library",
    "Application Support",
    "RAH OS",
  );
  mkdirSync(join(dataRoot, "runtime-daemon"), { recursive: true });
  mkdirSync(join(dataRoot, "logs"), { recursive: true });
  writeFileSync(
    join(dataRoot, "runtime-daemon", "workbench-state.json"),
    "old-rah",
  );
  writeFileSync(join(dataRoot, "logs", "workbench.out.log"), "old-log");
  mkdirSync(join(legacy, "state"), { recursive: true });
  mkdirSync(join(legacy, "logs"), { recursive: true });
  writeFileSync(join(legacy, "state", "room.db"), "room-first");
  writeFileSync(join(legacy, "logs", "formal-workbench.log"), "new-log");
  try {
    await prepareRahDataHome({ environment: {}, userHomeDirectory });
    assert.equal(
      readFileSync(
        join(dataRoot, "runtime-daemon", "workbench-state.json"),
        "utf8",
      ),
      "old-rah",
    );
    assert.equal(
      readFileSync(join(dataRoot, "state", "room.db"), "utf8"),
      "room-first",
    );
    assert.equal(
      readFileSync(join(dataRoot, "logs", "workbench.out.log"), "utf8"),
      "old-log",
    );
    assert.equal(
      readFileSync(join(dataRoot, "logs", "formal-workbench.log"), "utf8"),
      "new-log",
    );
    assert.equal(existsSync(legacy), false);
  } finally {
    rmSync(userHomeDirectory, { force: true, recursive: true });
  }
});

test("migration detects a collision before moving either data tree", async () => {
  const userHomeDirectory = mkdtempSync(join(tmpdir(), "rah-data-home-"));
  const dataRoot = join(userHomeDirectory, ".rah");
  const legacy = join(
    userHomeDirectory,
    "Library",
    "Application Support",
    "RAH OS",
  );
  mkdirSync(join(dataRoot, "state"), { recursive: true });
  mkdirSync(join(legacy, "state"), { recursive: true });
  writeFileSync(join(dataRoot, "state", "room.db"), "target");
  writeFileSync(join(legacy, "state", "room.db"), "legacy");
  try {
    await assert.rejects(
      prepareRahDataHome({ environment: {}, userHomeDirectory }),
      /migration conflict/u,
    );
    assert.equal(
      readFileSync(join(dataRoot, "state", "room.db"), "utf8"),
      "target",
    );
    assert.equal(
      readFileSync(join(legacy, "state", "room.db"), "utf8"),
      "legacy",
    );
  } finally {
    rmSync(userHomeDirectory, { force: true, recursive: true });
  }
});

test("migration rejects a nested symbolic link before moving the legacy root", async () => {
  const userHomeDirectory = mkdtempSync(join(tmpdir(), "rah-data-home-"));
  const legacy = join(
    userHomeDirectory,
    "Library",
    "Application Support",
    "RAH OS",
  );
  mkdirSync(join(legacy, "state", "nested"), { recursive: true });
  symlinkSync(
    join(userHomeDirectory, "outside"),
    join(legacy, "state", "nested", "alias"),
  );
  try {
    await assert.rejects(
      prepareRahDataHome({ environment: {}, userHomeDirectory }),
      /symbolic link is not accepted/u,
    );
    assert.equal(existsSync(legacy), true);
    assert.equal(existsSync(join(userHomeDirectory, ".rah")), false);
  } finally {
    rmSync(userHomeDirectory, { force: true, recursive: true });
  }
});

test("an interrupted staged merge resumes without the legacy source", async () => {
  const userHomeDirectory = mkdtempSync(join(tmpdir(), "rah-data-home-"));
  const dataRoot = join(userHomeDirectory, ".rah");
  const staging = join(dataRoot, ".local-core-migration-v1");
  mkdirSync(join(staging, "state"), { recursive: true });
  writeFileSync(join(staging, "state", "room.db"), "resumed");
  try {
    await prepareRahDataHome({ environment: {}, userHomeDirectory });
    assert.equal(
      readFileSync(join(dataRoot, "state", "room.db"), "utf8"),
      "resumed",
    );
    assert.equal(existsSync(staging), false);
  } finally {
    rmSync(userHomeDirectory, { force: true, recursive: true });
  }
});

test("an explicit data root never imports the old default implicitly", async () => {
  const userHomeDirectory = mkdtempSync(join(tmpdir(), "rah-data-home-"));
  const explicit = join(userHomeDirectory, "explicit");
  const legacy = join(
    userHomeDirectory,
    "Library",
    "Application Support",
    "RAH OS",
  );
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, "sentinel"), "keep");
  try {
    assert.equal(
      await prepareRahDataHome({
        environment: { RAH_DATA_HOME: explicit },
        userHomeDirectory,
      }),
      explicit,
    );
    assert.equal(readFileSync(join(legacy, "sentinel"), "utf8"), "keep");
    assert.equal(existsSync(explicit), false);
  } finally {
    rmSync(userHomeDirectory, { force: true, recursive: true });
  }
});
