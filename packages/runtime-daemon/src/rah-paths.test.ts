import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import {
  assertRahInstallDataSeparation,
  resolveRahDataHome,
  resolveRahRuntimeHome,
  resolveRahStorageLayout,
} from "./rah-paths.mjs";

test("RAH data defaults to the stable ~/.rah root", () => {
  assert.equal(
    resolveRahDataHome({ environment: {}, userHomeDirectory: "/Users/test" }),
    "/Users/test/.rah",
  );
  assert.equal(
    resolveRahRuntimeHome({
      environment: {},
      userHomeDirectory: "/Users/test",
    }),
    "/Users/test/.rah/runtime-daemon",
  );
});

test("RAH_DATA_HOME is canonical and RAH_HOME remains a compatible alias", () => {
  assert.equal(
    resolveRahDataHome({
      environment: { RAH_DATA_HOME: "/data/rah" },
      userHomeDirectory: "/Users/test",
    }),
    "/data/rah",
  );
  assert.equal(
    resolveRahDataHome({
      environment: { RAH_HOME: "/legacy/rah" },
      userHomeDirectory: "/Users/test",
    }),
    "/legacy/rah",
  );
  assert.throws(
    () =>
      resolveRahDataHome({
        environment: {
          RAH_DATA_HOME: "/data/rah",
          RAH_HOME: "/other/rah",
        },
        userHomeDirectory: "/Users/test",
      }),
    /conflicting RAH data roots/u,
  );
  assert.throws(
    () =>
      resolveRahDataHome({
        environment: { RAH_DATA_HOME: "relative" },
        userHomeDirectory: "/Users/test",
      }),
    /absolute path/u,
  );
});

test("install artifacts cannot contain or be contained by durable data", () => {
  assert.doesNotThrow(() =>
    assertRahInstallDataSeparation("/Applications/RAH.app", "/Users/test/.rah"),
  );
  assert.throws(
    () => assertRahInstallDataSeparation("/Users/test/.rah", "/Users/test/.rah"),
    /must be separate/u,
  );
  assert.throws(
    () =>
      assertRahInstallDataSeparation(
        "/Users/test/.rah/program",
        "/Users/test/.rah",
      ),
    /must be separate/u,
  );
  assert.throws(
    () =>
      assertRahInstallDataSeparation(
        "/Applications/RAH.app",
        "/Applications/RAH.app/data",
      ),
    /must be separate/u,
  );
});

test("storage layout gives durable owners stable subdirectories", () => {
  const layout = resolveRahStorageLayout({
    environment: { RAH_DATA_HOME: "/data/rah" },
    installRoot: "/opt/rah",
    userHomeDirectory: "/Users/test",
  });
  assert.deepEqual(layout, {
    attachmentsRoot: join("/data/rah", "attachments"),
    authRoot: join("/data/rah", "auth"),
    councilRoot: join("/data/rah", "council"),
    dataRoot: "/data/rah",
    installRoot: "/opt/rah",
    runtimeRoot: join("/data/rah", "runtime-daemon"),
  });
});
