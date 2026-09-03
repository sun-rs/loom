import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { afterEach } from "node:test";

import type {
  RuntimeProfileManifestV1,
  RuntimeProfileManifestV2,
} from "@rah-os/protocol";

import {
  computeRuntimeProfileProbeDigest,
  computeRuntimeProfileManifestDigest,
  normalizeRuntimeProfileManifestV1,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
  RUNTIME_PROFILE_REGISTRY_SCHEMA_VERSION,
} from "../src/index.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { force: true, recursive: true });
  }
});

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-runtime-registry-"));
  temporaryDirectories.push(directory);
  chmodSync(directory, 0o700);
  return directory;
}

function manifest(
  overrides: Partial<RuntimeProfileManifestV1> = {},
): RuntimeProfileManifestV1 {
  return {
    adapter: {
      config: {
        diagnosticByteLimit: 262_144,
        terminationGraceMs: 5_000,
      },
      executable: "codex",
      fixedArgs: ["exec", "--ephemeral"],
      kind: "generic-process/v1",
    },
    declaredCapabilities: ["worker_commands", "session_resume"],
    displayName: "Codex main",
    manifestVersion: 1,
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers: ["rah-process-supervisor-v1"],
    runtimeProfileId: "codex-main",
    workspacePolicy: {
      allowedModes: ["in_place", "worktree"],
    },
    ...overrides,
  };
}

function manifestV2(
  overrides: Partial<RuntimeProfileManifestV2> = {},
): RuntimeProfileManifestV2 {
  return {
    ...manifest(),
    credentialSlots: [
      {
        slotId: "provider-token",
        target: { kind: "environment", variable: "PROVIDER_TOKEN" },
      },
    ],
    manifestVersion: 2,
    staticEnv: { PROVIDER_MODE: "plan" },
    ...overrides,
  };
}

function createRegistry() {
  const directory = createDirectory();
  let nowMs = Date.parse("2026-08-26T00:00:00.000Z");
  const databasePath = join(directory, "runtime-registry.db");
  const registry = new RuntimeProfileRegistry({
    databasePath,
    hostId: "host-main",
    now: () => new Date(nowMs),
  });
  registry.initialize();
  return {
    advance: (milliseconds: number) => {
      nowMs += milliseconds;
    },
    databasePath,
    registry,
  };
}

test("manifest canonicalization is versioned and set-order independent", () => {
  const original = manifest();
  const reordered = manifest({
    declaredCapabilities: ["session_resume", "worker_commands"],
    recoveryDrivers: ["rah-process-supervisor-v1"],
    workspacePolicy: { allowedModes: ["worktree", "in_place"] },
  });

  assert.deepEqual(
    normalizeRuntimeProfileManifestV1(reordered),
    normalizeRuntimeProfileManifestV1(original),
  );
  assert.equal(
    computeRuntimeProfileManifestDigest(reordered),
    computeRuntimeProfileManifestDigest(original),
  );
  assert.equal(
    computeRuntimeProfileManifestDigest(original),
    "sha256:3985e9694eca4b2a51a752a4169ee7f71843170c4e48c86b22ed3ae47ad14533",
  );
  assert.notEqual(
    computeRuntimeProfileManifestDigest(
      manifest({
        adapter: {
          ...original.adapter,
          fixedArgs: ["exec", "--ephemeral", "--json"],
        },
      }),
    ),
    computeRuntimeProfileManifestDigest(original),
  );
});

test("manifest import is idempotent and creates immutable semantic revisions", () => {
  const { advance, registry } = createRegistry();
  const first = registry.importManifest(manifest());
  const replay = registry.importManifest(
    manifest({
      declaredCapabilities: ["session_resume", "worker_commands"],
      workspacePolicy: { allowedModes: ["worktree", "in_place"] },
    }),
  );
  assert.equal(replay.runtimeProfileRevisionId, first.runtimeProfileRevisionId);
  assert.equal(registry.listAuditEntries().length, 1);

  advance(1_000);
  const second = registry.importManifest(
    manifest({
      adapter: {
        ...manifest().adapter,
        fixedArgs: ["exec", "--ephemeral", "--json"],
      },
    }),
  );
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.notEqual(second.contentDigest, first.contentDigest);
  assert.deepEqual(
    registry.getRevision(first.runtimeProfileRevisionId).manifest.adapter
      .fixedArgs,
    ["exec", "--ephemeral"],
  );
  assert.equal(
    registry.getProfile(first.runtimeProfileId).activeRevisionId,
    undefined,
  );
  registry.close();
});

test("activation and deprecation are explicit, idempotent, and audited", () => {
  const { advance, databasePath, registry } = createRegistry();
  const first = registry.importManifest(manifest());
  advance(1);
  const second = registry.importManifest(
    manifest({ displayName: "Codex main revision two" }),
  );

  advance(1);
  registry.activateRevision({
    contentDigest: first.contentDigest,
    runtimeProfileRevisionId: first.runtimeProfileRevisionId,
  });
  registry.activateRevision({
    contentDigest: first.contentDigest,
    runtimeProfileRevisionId: first.runtimeProfileRevisionId,
  });
  assert.equal(
    registry.getProfile(first.runtimeProfileId).activeRevisionId,
    first.runtimeProfileRevisionId,
  );

  advance(1);
  registry.activateRevision({
    contentDigest: second.contentDigest,
    runtimeProfileRevisionId: second.runtimeProfileRevisionId,
  });
  assert.equal(
    registry.getRevision(first.runtimeProfileRevisionId).state,
    "inactive",
  );
  assert.equal(
    registry.getRevision(second.runtimeProfileRevisionId).state,
    "active",
  );

  advance(1);
  registry.deprecateRevision({
    contentDigest: second.contentDigest,
    reason: "superseded after local validation",
    runtimeProfileRevisionId: second.runtimeProfileRevisionId,
  });
  assert.equal(
    registry.getProfile(first.runtimeProfileId).activeRevisionId,
    undefined,
  );
  assert.equal(
    registry.getRevision(second.runtimeProfileRevisionId).state,
    "deprecated",
  );
  assert.throws(() =>
    registry.activateRevision({
      contentDigest: second.contentDigest,
      runtimeProfileRevisionId: second.runtimeProfileRevisionId,
    }),
  );
  assert.throws(() =>
    registry.activateRevision({
      contentDigest: `sha256:${"0".repeat(64)}`,
      runtimeProfileRevisionId: first.runtimeProfileRevisionId,
    }),
  );
  assert.deepEqual(
    registry.listAuditEntries().map((entry) => entry.action),
    ["imported", "imported", "activated", "activated", "deprecated"],
  );
  registry.close();

  const reopened = new RuntimeProfileRegistry({
    databasePath,
    hostId: "host-main",
  });
  reopened.initialize();
  assert.equal(
    reopened.getRevision(first.runtimeProfileRevisionId).contentDigest,
    first.contentDigest,
  );
  assert.equal(
    reopened.getRevision(second.runtimeProfileRevisionId).state,
    "deprecated",
  );
  reopened.close();

  const raw = new DatabaseSync(databasePath);
  assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
  assert.throws(() =>
    raw.exec(
      "UPDATE runtime_profile_revisions SET manifest_json = '{}' WHERE revision = 1",
    ),
  );
  assert.throws(() => raw.exec("DELETE FROM runtime_profile_audit_entries"));
  raw.close();
});

test("two registry connections replay one imported revision", () => {
  const directory = createDirectory();
  const databasePath = join(directory, "runtime-registry.db");
  const first = new RuntimeProfileRegistry({
    databasePath,
    hostId: "host-concurrent",
  });
  first.initialize();
  const second = new RuntimeProfileRegistry({
    databasePath,
    hostId: "host-concurrent",
  });
  second.initialize();

  const firstImport = first.importManifest(manifest());
  const secondImport = second.importManifest(manifest());
  assert.equal(
    secondImport.runtimeProfileRevisionId,
    firstImport.runtimeProfileRevisionId,
  );
  assert.equal(first.listRevisions().length, 1);
  assert.equal(second.listAuditEntries().length, 1);
  first.close();
  second.close();
});

test("owner-private manifest file imports create revisions without storing the path", () => {
  const { databasePath, registry } = createRegistry();
  const manifestDirectory = createDirectory();
  const manifestPath = join(manifestDirectory, "codex.json");
  writeFileSync(manifestPath, JSON.stringify(manifest()), { mode: 0o600 });
  const first = registry.importManifestFile(manifestPath);

  writeFileSync(
    manifestPath,
    JSON.stringify(manifest({ displayName: "Codex changed on disk" })),
    { mode: 0o600 },
  );
  const second = registry.importManifestFile(manifestPath);
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal(
    registry.getRevision(first.runtimeProfileRevisionId).manifest.displayName,
    "Codex main",
  );
  assert.equal(
    registry
      .listAuditEntries()
      .some((entry) => JSON.stringify(entry).includes(manifestPath)),
    false,
  );

  chmodSync(manifestPath, 0o644);
  assert.throws(
    () => registry.importManifestFile(manifestPath),
    /owner-private/,
  );
  chmodSync(manifestPath, 0o600);
  chmodSync(manifestDirectory, 0o755);
  assert.throws(
    () => registry.importManifestFile(manifestPath),
    /owner-private/,
  );
  registry.close();

  const raw = new DatabaseSync(databasePath);
  assert.equal(
    (
      raw
        .prepare(
          "SELECT COUNT(*) AS count FROM runtime_profile_revisions WHERE manifest_json LIKE ?",
        )
        .get(`%${manifestPath}%`) as { count: number }
    ).count,
    0,
  );
  raw.close();
});

test("registry storage must remain owner-private and rejects newer schemas", () => {
  const publicDirectory = createDirectory();
  chmodSync(publicDirectory, 0o755);
  assert.throws(
    () =>
      new RuntimeProfileRegistry({
        databasePath: join(publicDirectory, "runtime-registry.db"),
        hostId: "host-public-directory",
      }),
    /owner-private/,
  );

  const symlinkDirectory = createDirectory();
  const targetPath = join(symlinkDirectory, "target.db");
  const target = new DatabaseSync(targetPath);
  target.close();
  chmodSync(targetPath, 0o600);
  const symlinkPath = join(symlinkDirectory, "runtime-registry.db");
  symlinkSync(targetPath, symlinkPath);
  assert.throws(
    () =>
      new RuntimeProfileRegistry({
        databasePath: symlinkPath,
        hostId: "host-symlink",
      }),
    /regular file/,
  );

  const publicDatabaseDirectory = createDirectory();
  const publicDatabasePath = join(
    publicDatabaseDirectory,
    "runtime-registry.db",
  );
  const publicDatabase = new DatabaseSync(publicDatabasePath);
  publicDatabase.close();
  chmodSync(publicDatabasePath, 0o644);
  assert.throws(
    () =>
      new RuntimeProfileRegistry({
        databasePath: publicDatabasePath,
        hostId: "host-public-database",
      }),
    /owner-private regular file/,
  );

  const newerDirectory = createDirectory();
  const newerPath = join(newerDirectory, "runtime-registry.db");
  const newer = new DatabaseSync(newerPath);
  newer.exec(
    `PRAGMA user_version = ${String(RUNTIME_PROFILE_REGISTRY_SCHEMA_VERSION + 1)}`,
  );
  newer.close();
  chmodSync(newerPath, 0o600);
  const registry = new RuntimeProfileRegistry({
    databasePath: newerPath,
    hostId: "host-newer-schema",
  });
  assert.throws(() => registry.initialize(), /newer Runtime Registry schema/);
  registry.close();

  const privateFixture = createRegistry();
  assert.equal(lstatSync(privateFixture.databasePath).mode & 0o077, 0);
  privateFixture.registry.close();
});

test("a Runtime Registry is durably bound to one Host identity", () => {
  const directory = createDirectory();
  const databasePath = join(directory, "runtime-registry.db");
  const original = new RuntimeProfileRegistry({
    databasePath,
    hostId: "host-original",
  });
  original.initialize();
  original.importManifest(manifest());
  original.close();

  const wrongHost = new RuntimeProfileRegistry({
    databasePath,
    hostId: "host-wrong",
  });
  assert.throws(() => wrongHost.initialize(), /belongs to Host host-original/);
  wrongHost.close();

  const originalHost = new RuntimeProfileRegistry({
    databasePath,
    hostId: "host-original",
  });
  originalHost.initialize();
  assert.equal(originalHost.listRevisions().length, 1);
  originalHost.close();
});

test("v2 revisions require immutable matching probe evidence before activation", async () => {
  const { advance, databasePath, registry } = createRegistry();
  const revision = registry.importManifest(
    manifestV2({
      adapter: {
        ...manifestV2().adapter,
        executable: process.execPath,
        fixedArgs: [],
      },
      recoveryDrivers:
        process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    }),
  );
  assert.throws(
    () =>
      registry.activateRevision({
        contentDigest: revision.contentDigest,
        runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
      }),
    /successful latest probe report/,
  );

  assert.throws(
    () =>
      registry.recordProbeReport({
        adapter: {
          implementationVersion: "generic-process-adapter/v1",
          kind: "generic-process/v1",
        },
        available: true,
        contentDigest: revision.contentDigest,
        executableIdentity: {
          byteLength: 42,
          contentDigest: `sha256:${"1".repeat(64)}`,
          requestedExecutable: process.execPath,
          resolvedExecutablePath: process.execPath,
        },
        modelBindings: [],
        recoveryDrivers: [],
        runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
      }),
    /issued by RuntimeImplementationRegistry/,
  );
  const report = registry.recordProbeReport(
    await new RuntimeImplementationRegistry().probeRevision(revision, {
      cwd: dirname(databasePath),
    }),
  );
  assert.equal(
    computeRuntimeProfileProbeDigest({
      ...report,
      probeDigest: undefined,
    }),
    report.probeDigest,
  );
  assert.equal(registry.listProbeReports().length, 1);
  registry.activateRevision({
    contentDigest: revision.contentDigest,
    runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
  });
  assert.equal(
    registry.getActiveRevision(revision.runtimeProfileId)?.state,
    "active",
  );

  advance(1);
  registry.close();

  const raw = new DatabaseSync(databasePath);
  assert.throws(() =>
    raw
      .prepare(
        `UPDATE runtime_profile_probe_payloads
         SET payload_json = '{}'
         WHERE payload_digest = (
           SELECT payload_digest FROM runtime_profile_probe_reports
           WHERE probe_report_id = ?
         )`,
      )
      .run(report.probeReportId),
  );
  assert.throws(() =>
    raw
      .prepare(
        "DELETE FROM runtime_profile_probe_reports WHERE probe_report_id = ?",
      )
      .run(report.probeReportId),
  );
  raw.close();
});

test("equivalent probes advance validation freshness without duplicating reports or audits", async () => {
  const { advance, databasePath, registry } = createRegistry();
  const revision = registry.importManifest(
    manifestV2({
      adapter: {
        ...manifestV2().adapter,
        executable: process.execPath,
        fixedArgs: [],
      },
      recoveryDrivers:
        process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    }),
  );
  const implementations = new RuntimeImplementationRegistry();
  const first = registry.recordProbeReport(
    await implementations.probeRevision(revision, {
      cwd: dirname(databasePath),
    }),
  );
  advance(30_000);
  const second = registry.recordProbeReport(
    await implementations.probeRevision(revision, {
      cwd: dirname(databasePath),
    }),
  );

  assert.equal(second.probeReportId, first.probeReportId);
  assert.equal(second.observedAt, first.observedAt);
  assert.equal(
    registry.listProbeReports(revision.runtimeProfileRevisionId).length,
    1,
  );
  assert.deepEqual(
    registry.getProbeValidation(revision.runtimeProfileRevisionId),
    {
      lastValidatedAt: "2026-08-26T00:00:30.000Z",
      probeReportId: first.probeReportId,
      validationCount: 2,
    },
  );
  assert.equal(
    registry
      .listAuditEntries(revision.runtimeProfileId)
      .filter(({ action }) => action === "probe_recorded").length,
    1,
  );
  registry.close();

  const raw = new DatabaseSync(databasePath);
  assert.equal(
    (
      raw
        .prepare("SELECT COUNT(*) AS count FROM runtime_profile_probe_payloads")
        .get() as { count: number }
    ).count,
    1,
  );
  raw.close();
});

test("an exact schema v1 registry migrates to v3 before accepting probe-backed manifests", async () => {
  const directory = createDirectory();
  const databasePath = join(directory, "runtime-registry.db");
  writeFileSync(databasePath, "", { mode: 0o600 });
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE runtime_registry_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      registry_id TEXT NOT NULL UNIQUE,
      host_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE runtime_profiles (
      runtime_profile_id TEXT PRIMARY KEY,
      active_revision_id TEXT REFERENCES runtime_profile_revisions(runtime_profile_revision_id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE runtime_profile_revisions (
      runtime_profile_revision_id TEXT PRIMARY KEY,
      runtime_profile_id TEXT NOT NULL REFERENCES runtime_profiles(runtime_profile_id),
      revision INTEGER NOT NULL CHECK (revision > 0),
      content_digest TEXT NOT NULL,
      manifest_version INTEGER NOT NULL CHECK (manifest_version = 1),
      manifest_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('inactive', 'active', 'deprecated')),
      imported_at TEXT NOT NULL,
      activated_at TEXT,
      deprecated_at TEXT,
      UNIQUE (runtime_profile_id, revision),
      UNIQUE (runtime_profile_id, content_digest)
    ) STRICT;
    CREATE INDEX idx_runtime_profile_revisions_profile
      ON runtime_profile_revisions(runtime_profile_id, revision);
    CREATE TABLE runtime_profile_audit_entries (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_entry_id TEXT NOT NULL UNIQUE,
      action TEXT NOT NULL CHECK (action IN ('imported', 'activated', 'deprecated')),
      runtime_profile_id TEXT NOT NULL REFERENCES runtime_profiles(runtime_profile_id),
      runtime_profile_revision_id TEXT NOT NULL REFERENCES runtime_profile_revisions(runtime_profile_revision_id),
      content_digest TEXT NOT NULL,
      reason TEXT,
      occurred_at TEXT NOT NULL
    ) STRICT;
    CREATE TRIGGER runtime_profile_revision_content_immutable
    BEFORE UPDATE ON runtime_profile_revisions
    WHEN OLD.runtime_profile_id <> NEW.runtime_profile_id
      OR OLD.revision <> NEW.revision
      OR OLD.content_digest <> NEW.content_digest
      OR OLD.manifest_version <> NEW.manifest_version
      OR OLD.manifest_json <> NEW.manifest_json
      OR OLD.imported_at <> NEW.imported_at
    BEGIN
      SELECT RAISE(ABORT, 'RuntimeProfileRevision content is immutable');
    END;
    CREATE TRIGGER runtime_profile_revision_no_delete
    BEFORE DELETE ON runtime_profile_revisions
    BEGIN
      SELECT RAISE(ABORT, 'RuntimeProfileRevision cannot be deleted');
    END;
    CREATE TRIGGER runtime_profile_audit_no_update
    BEFORE UPDATE ON runtime_profile_audit_entries
    BEGIN
      SELECT RAISE(ABORT, 'Runtime Profile audit is append-only');
    END;
    CREATE TRIGGER runtime_profile_audit_no_delete
    BEFORE DELETE ON runtime_profile_audit_entries
    BEGIN
      SELECT RAISE(ABORT, 'Runtime Profile audit is append-only');
    END;
    PRAGMA user_version = 1;
  `);
  const legacyManifest = normalizeRuntimeProfileManifestV1(
    manifest({ runtimeProfileId: "legacy-profile" }),
  );
  const legacyDigest = computeRuntimeProfileManifestDigest(legacyManifest);
  const legacyRevisionId = "legacy-profile-revision-1";
  const occurredAt = "2026-08-26T00:00:00.000Z";
  legacy
    .prepare(
      "INSERT INTO runtime_registry_metadata(singleton, registry_id, host_id, created_at) VALUES(1, ?, ?, ?)",
    )
    .run("legacy-registry", "host-registry-migration", occurredAt);
  legacy
    .prepare(
      "INSERT INTO runtime_profiles(runtime_profile_id, active_revision_id, created_at, updated_at) VALUES(?, NULL, ?, ?)",
    )
    .run(legacyManifest.runtimeProfileId, occurredAt, occurredAt);
  legacy
    .prepare(
      `INSERT INTO runtime_profile_revisions(
         runtime_profile_revision_id, runtime_profile_id, revision,
         content_digest, manifest_version, manifest_json, state,
         imported_at, activated_at, deprecated_at
       ) VALUES(?, ?, 1, ?, 1, ?, 'active', ?, ?, NULL)`,
    )
    .run(
      legacyRevisionId,
      legacyManifest.runtimeProfileId,
      legacyDigest,
      JSON.stringify(legacyManifest),
      occurredAt,
      occurredAt,
    );
  legacy
    .prepare(
      "UPDATE runtime_profiles SET active_revision_id = ? WHERE runtime_profile_id = ?",
    )
    .run(legacyRevisionId, legacyManifest.runtimeProfileId);
  for (const [auditEntryId, action] of [
    ["legacy-import-audit", "imported"],
    ["legacy-activation-audit", "activated"],
  ] as const) {
    legacy
      .prepare(
        `INSERT INTO runtime_profile_audit_entries(
           audit_entry_id, action, runtime_profile_id,
           runtime_profile_revision_id, content_digest, reason, occurred_at
         ) VALUES(?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        auditEntryId,
        action,
        legacyManifest.runtimeProfileId,
        legacyRevisionId,
        legacyDigest,
        occurredAt,
      );
  }
  legacy.close();

  const migrated = new RuntimeProfileRegistry({
    databasePath,
    hostId: "host-registry-migration",
  });
  migrated.initialize();
  assert.equal(
    migrated.getRevision(legacyRevisionId).contentDigest,
    legacyDigest,
  );
  const v2Revision = migrated.importManifest(
    manifestV2({
      adapter: {
        ...manifestV2().adapter,
        executable: process.execPath,
      },
      recoveryDrivers:
        process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
      runtimeProfileId: "profile-after-migration",
    }),
  );
  assert.equal(v2Revision.manifest.manifestVersion, 2);
  const implementations = new RuntimeImplementationRegistry();
  const report = migrated.recordProbeReport(
    await implementations.probeRevision(v2Revision, { cwd: directory }),
  );
  assert.equal(report.available, true);
  assert.equal(
    migrated.listProbeReports(v2Revision.runtimeProfileRevisionId).length,
    1,
  );
  migrated.close();

  const verified = new DatabaseSync(databasePath);
  assert.equal(
    (
      verified.prepare("PRAGMA user_version").get() as {
        user_version: number;
      }
    ).user_version,
    RUNTIME_PROFILE_REGISTRY_SCHEMA_VERSION,
  );
  assert.deepEqual(verified.prepare("PRAGMA foreign_key_check").all(), []);
  verified.close();
});

test("an exact schema v2 registry preserves probe envelopes while payload-deduping into v4", () => {
  const directory = createDirectory();
  const databasePath = join(directory, "runtime-registry.db");
  writeFileSync(databasePath, "", { mode: 0o600 });
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE runtime_registry_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      registry_id TEXT NOT NULL UNIQUE,
      host_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE runtime_profiles (
      runtime_profile_id TEXT PRIMARY KEY,
      active_revision_id TEXT REFERENCES runtime_profile_revisions(runtime_profile_revision_id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE runtime_profile_revisions (
      runtime_profile_revision_id TEXT PRIMARY KEY,
      runtime_profile_id TEXT NOT NULL REFERENCES runtime_profiles(runtime_profile_id),
      revision INTEGER NOT NULL CHECK (revision > 0),
      content_digest TEXT NOT NULL,
      manifest_version INTEGER NOT NULL CHECK (manifest_version IN (1, 2)),
      manifest_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('inactive', 'active', 'deprecated')),
      imported_at TEXT NOT NULL,
      activated_at TEXT,
      deprecated_at TEXT,
      UNIQUE (runtime_profile_id, revision),
      UNIQUE (runtime_profile_id, content_digest)
    ) STRICT;
    CREATE TABLE runtime_profile_audit_entries (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_entry_id TEXT NOT NULL UNIQUE,
      action TEXT NOT NULL CHECK (action IN ('imported', 'probe_recorded', 'activated', 'deprecated')),
      runtime_profile_id TEXT NOT NULL REFERENCES runtime_profiles(runtime_profile_id),
      runtime_profile_revision_id TEXT NOT NULL REFERENCES runtime_profile_revisions(runtime_profile_revision_id),
      content_digest TEXT NOT NULL,
      reason TEXT,
      occurred_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE runtime_profile_probe_reports (
      probe_report_id TEXT PRIMARY KEY,
      probe_digest TEXT NOT NULL UNIQUE,
      runtime_profile_id TEXT NOT NULL REFERENCES runtime_profiles(runtime_profile_id),
      runtime_profile_revision_id TEXT NOT NULL REFERENCES runtime_profile_revisions(runtime_profile_revision_id),
      runtime_profile_digest TEXT NOT NULL,
      available INTEGER NOT NULL CHECK (available IN (0, 1)),
      observed_at TEXT NOT NULL,
      report_json TEXT NOT NULL
    ) STRICT;
    PRAGMA user_version = 2;
  `);
  const occurredAt = "2026-08-26T00:00:00.000Z";
  const legacyManifest = manifestV2({
    adapter: {
      ...manifestV2().adapter,
      executable: process.execPath,
      fixedArgs: [],
    },
    recoveryDrivers: [],
    runtimeProfileId: "legacy-v2-profile",
  });
  const legacyDigest = computeRuntimeProfileManifestDigest(legacyManifest);
  const legacyRevisionId = "legacy-v2-revision";
  const reportWithoutDigest = {
    adapter: {
      implementationVersion: "generic-process-adapter/v1",
      kind: "generic-process/v1",
    },
    available: true,
    executableIdentity: {
      byteLength: 42,
      contentDigest: `sha256:${"1".repeat(64)}`,
      requestedExecutable: process.execPath,
      resolvedExecutablePath: process.execPath,
    },
    observedAt: occurredAt,
    probeReportId: "legacy-v1-probe-report",
    recoveryDrivers: [],
    reportVersion: 1 as const,
    runtimeProfileDigest: legacyDigest,
    runtimeProfileId: legacyManifest.runtimeProfileId,
    runtimeProfileRevisionId: legacyRevisionId,
  };
  const legacyReport = {
    ...reportWithoutDigest,
    probeDigest: computeRuntimeProfileProbeDigest(reportWithoutDigest),
  };
  const repeatedReportWithoutDigest = {
    ...reportWithoutDigest,
    observedAt: "2026-08-26T00:00:30.000Z",
    probeReportId: "legacy-v1-probe-report-repeat",
  };
  const repeatedReport = {
    ...repeatedReportWithoutDigest,
    probeDigest: computeRuntimeProfileProbeDigest(repeatedReportWithoutDigest),
  };
  legacy
    .prepare(
      "INSERT INTO runtime_registry_metadata(singleton, registry_id, host_id, created_at) VALUES(1, ?, ?, ?)",
    )
    .run("legacy-v2-registry", "host-v2-migration", occurredAt);
  legacy
    .prepare(
      "INSERT INTO runtime_profiles(runtime_profile_id, active_revision_id, created_at, updated_at) VALUES(?, NULL, ?, ?)",
    )
    .run(legacyManifest.runtimeProfileId, occurredAt, occurredAt);
  legacy
    .prepare(
      `INSERT INTO runtime_profile_revisions(
        runtime_profile_revision_id, runtime_profile_id, revision,
        content_digest, manifest_version, manifest_json, state,
        imported_at, activated_at, deprecated_at
      ) VALUES(?, ?, 1, ?, 2, ?, 'active', ?, ?, NULL)`,
    )
    .run(
      legacyRevisionId,
      legacyManifest.runtimeProfileId,
      legacyDigest,
      JSON.stringify(legacyManifest),
      occurredAt,
      occurredAt,
    );
  legacy
    .prepare(
      "UPDATE runtime_profiles SET active_revision_id = ? WHERE runtime_profile_id = ?",
    )
    .run(legacyRevisionId, legacyManifest.runtimeProfileId);
  legacy
    .prepare(
      `INSERT INTO runtime_profile_audit_entries(
        audit_entry_id, action, runtime_profile_id, runtime_profile_revision_id,
        content_digest, reason, occurred_at
      ) VALUES('legacy-v2-import', 'imported', ?, ?, ?, NULL, ?)`,
    )
    .run(
      legacyManifest.runtimeProfileId,
      legacyRevisionId,
      legacyDigest,
      occurredAt,
    );
  legacy
    .prepare(
      `INSERT INTO runtime_profile_probe_reports(
        probe_report_id, probe_digest, runtime_profile_id,
        runtime_profile_revision_id, runtime_profile_digest,
        available, observed_at, report_json
      ) VALUES(?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      legacyReport.probeReportId,
      legacyReport.probeDigest,
      legacyReport.runtimeProfileId,
      legacyReport.runtimeProfileRevisionId,
      legacyReport.runtimeProfileDigest,
      legacyReport.observedAt,
      JSON.stringify(legacyReport),
    );
  legacy
    .prepare(
      `INSERT INTO runtime_profile_probe_reports(
        probe_report_id, probe_digest, runtime_profile_id,
        runtime_profile_revision_id, runtime_profile_digest,
        available, observed_at, report_json
      ) VALUES(?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      repeatedReport.probeReportId,
      repeatedReport.probeDigest,
      repeatedReport.runtimeProfileId,
      repeatedReport.runtimeProfileRevisionId,
      repeatedReport.runtimeProfileDigest,
      repeatedReport.observedAt,
      JSON.stringify(repeatedReport),
    );
  legacy.close();

  const migrated = new RuntimeProfileRegistry({
    databasePath,
    hostId: "host-v2-migration",
  });
  migrated.initialize();
  assert.equal(
    migrated.getProbeReport(legacyReport.probeReportId).probeDigest,
    legacyReport.probeDigest,
  );
  assert.equal(
    migrated.getProbeReport(repeatedReport.probeReportId).probeDigest,
    repeatedReport.probeDigest,
  );
  assert.deepEqual(migrated.getProbeValidation(legacyRevisionId), {
    lastValidatedAt: repeatedReport.observedAt,
    probeReportId: repeatedReport.probeReportId,
    validationCount: 2,
  });
  assert.equal(
    migrated.getActiveRevision(legacyManifest.runtimeProfileId)?.contentDigest,
    legacyDigest,
  );
  migrated.close();

  const verified = new DatabaseSync(databasePath);
  assert.equal(
    (
      verified
        .prepare("SELECT COUNT(*) AS count FROM runtime_profile_probe_reports")
        .get() as { count: number }
    ).count,
    2,
  );
  assert.equal(
    (
      verified
        .prepare("SELECT COUNT(*) AS count FROM runtime_profile_probe_payloads")
        .get() as { count: number }
    ).count,
    1,
  );
  verified.close();
});
