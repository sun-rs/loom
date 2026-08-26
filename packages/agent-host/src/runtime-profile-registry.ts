import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  type Stats,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  RuntimeProfileAuditEntrySchema,
  RuntimeProfileManifestSchema,
  RuntimeProfileManifestV1Schema,
  RuntimeProfileProbeReportSchema,
  RuntimeProfileRevisionSchema,
  RuntimeProfileSchema,
  type RuntimeProfile,
  type RuntimeProfileAuditAction,
  type RuntimeProfileAuditEntry,
  type RuntimeProfileManifest,
  type RuntimeProfileManifestV1,
  type RuntimeProfileProbeReport,
  type RuntimeProfileRevision,
} from "@rah-os/protocol";

import { isIssuedRuntimeProfileProbeObservation } from "./runtime-probe-authority.ts";

export const RUNTIME_PROFILE_REGISTRY_SCHEMA_VERSION = 2;
const RUNTIME_PROFILE_MANIFEST_V1_DIGEST_DOMAIN =
  "rah/runtime-profile-manifest/v1";
const RUNTIME_PROFILE_MANIFEST_V2_DIGEST_DOMAIN =
  "rah/runtime-profile-manifest/v2";
const RUNTIME_PROFILE_PROBE_DIGEST_DOMAIN = "rah/runtime-profile-probe/v1";
const EMPTY_SHA256_DIGEST = `sha256:${"0".repeat(64)}`;

type Row = Record<string, unknown>;

export type RuntimeProfileRegistryOptions = {
  databasePath: string;
  hostId: string;
  now?: () => Date;
};

export type RuntimeProfileProbeObservation = {
  adapter: RuntimeProfileProbeReport["adapter"];
  available: boolean;
  contentDigest: string;
  executableIdentity?: NonNullable<
    RuntimeProfileProbeReport["executableIdentity"]
  >;
  failureCode?: NonNullable<RuntimeProfileProbeReport["failureCode"]>;
  recoveryDrivers: RuntimeProfileProbeReport["recoveryDrivers"];
  runtimeProfileRevisionId: string;
};

export class RuntimeProfileRegistrySecurityError extends Error {}
export class RuntimeProfileRegistryConflictError extends Error {}
export class RuntimeProfileRegistryNotFoundError extends Error {}

export function normalizeRuntimeProfileManifestV1(
  uncheckedManifest: unknown,
): RuntimeProfileManifestV1 {
  const manifest = RuntimeProfileManifestV1Schema.parse(uncheckedManifest);
  return RuntimeProfileManifestV1Schema.parse({
    ...manifest,
    declaredCapabilities: [...manifest.declaredCapabilities].sort(),
    recoveryDrivers: [...manifest.recoveryDrivers].sort(),
    workspacePolicy: {
      allowedModes: [...manifest.workspacePolicy.allowedModes].sort(),
    },
  });
}

export function normalizeRuntimeProfileManifest(
  uncheckedManifest: unknown,
): RuntimeProfileManifest {
  const manifest = RuntimeProfileManifestSchema.parse(uncheckedManifest);
  if (manifest.manifestVersion === 1) {
    return normalizeRuntimeProfileManifestV1(manifest);
  }
  return RuntimeProfileManifestSchema.parse({
    ...manifest,
    credentialSlots: [...manifest.credentialSlots].sort((left, right) =>
      left.slotId.localeCompare(right.slotId),
    ),
    declaredCapabilities: [...manifest.declaredCapabilities].sort(),
    recoveryDrivers: [...manifest.recoveryDrivers].sort(),
    staticEnv: Object.fromEntries(
      Object.entries(manifest.staticEnv).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    workspacePolicy: {
      allowedModes: [...manifest.workspacePolicy.allowedModes].sort(),
    },
  });
}

export function computeRuntimeProfileManifestDigest(
  uncheckedManifest: unknown,
): string {
  const manifest = normalizeRuntimeProfileManifest(uncheckedManifest);
  const domain =
    manifest.manifestVersion === 1
      ? RUNTIME_PROFILE_MANIFEST_V1_DIGEST_DOMAIN
      : RUNTIME_PROFILE_MANIFEST_V2_DIGEST_DOMAIN;
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify(
        canonicalValue({
          domain,
          manifest,
        }),
      ),
      "utf8",
    )
    .digest("hex")}`;
}

export function computeRuntimeProfileProbeDigest(
  uncheckedReport: Omit<RuntimeProfileProbeReport, "probeDigest"> & {
    probeDigest?: undefined;
  },
): string {
  const parsed = RuntimeProfileProbeReportSchema.parse({
    ...uncheckedReport,
    probeDigest: EMPTY_SHA256_DIGEST,
  });
  const { probeDigest: _discarded, ...report } = parsed;
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify(
        canonicalValue({
          domain: RUNTIME_PROFILE_PROBE_DIGEST_DOMAIN,
          report,
        }),
      ),
      "utf8",
    )
    .digest("hex")}`;
}

export class RuntimeProfileRegistry {
  readonly databasePath: string;
  readonly hostId: string;
  readonly #database: DatabaseSync;
  readonly #now: () => Date;

  constructor(options: RuntimeProfileRegistryOptions) {
    if (!isAbsolute(options.databasePath)) {
      throw new RuntimeProfileRegistrySecurityError(
        "Runtime Registry databasePath must be absolute",
      );
    }
    this.databasePath = resolve(options.databasePath);
    this.hostId = options.hostId.trim();
    if (this.hostId.length === 0 || this.hostId.includes("\0")) {
      throw new RuntimeProfileRegistrySecurityError(
        "Runtime Registry hostId is required",
      );
    }
    this.#now = options.now ?? (() => new Date());
    requireOwnerPrivateDirectory(dirname(this.databasePath));
    if (!existsSync(this.databasePath)) {
      try {
        const descriptor = openSync(
          this.databasePath,
          constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
          0o600,
        );
        closeSync(descriptor);
      } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) throw error;
      }
    }
    requireOwnerPrivateRegularFile(this.databasePath);
    this.#database = new DatabaseSync(this.databasePath, { timeout: 5_000 });
  }

  initialize(): void {
    const versionRow = this.#database.prepare("PRAGMA user_version").get();
    const version = versionRow ? integer(versionRow, "user_version") : 0;
    if (version > RUNTIME_PROFILE_REGISTRY_SCHEMA_VERSION) {
      throw new Error(
        `database uses newer Runtime Registry schema ${String(version)}; this build supports ${String(RUNTIME_PROFILE_REGISTRY_SCHEMA_VERSION)}`,
      );
    }
    if (version === 1) this.#migrateSchemaV1ToV2();
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS runtime_registry_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        registry_id TEXT NOT NULL UNIQUE,
        host_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS runtime_profiles (
        runtime_profile_id TEXT PRIMARY KEY,
        active_revision_id TEXT REFERENCES runtime_profile_revisions(runtime_profile_revision_id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS runtime_profile_revisions (
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

      CREATE INDEX IF NOT EXISTS idx_runtime_profile_revisions_profile
        ON runtime_profile_revisions(runtime_profile_id, revision);

      CREATE TABLE IF NOT EXISTS runtime_profile_audit_entries (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        audit_entry_id TEXT NOT NULL UNIQUE,
        action TEXT NOT NULL CHECK (action IN ('imported', 'probe_recorded', 'activated', 'deprecated')),
        runtime_profile_id TEXT NOT NULL REFERENCES runtime_profiles(runtime_profile_id),
        runtime_profile_revision_id TEXT NOT NULL REFERENCES runtime_profile_revisions(runtime_profile_revision_id),
        content_digest TEXT NOT NULL,
        reason TEXT,
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS runtime_profile_probe_reports (
        probe_report_id TEXT PRIMARY KEY,
        probe_digest TEXT NOT NULL UNIQUE,
        runtime_profile_id TEXT NOT NULL REFERENCES runtime_profiles(runtime_profile_id),
        runtime_profile_revision_id TEXT NOT NULL REFERENCES runtime_profile_revisions(runtime_profile_revision_id),
        runtime_profile_digest TEXT NOT NULL,
        available INTEGER NOT NULL CHECK (available IN (0, 1)),
        observed_at TEXT NOT NULL,
        report_json TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_runtime_profile_probe_reports_revision
        ON runtime_profile_probe_reports(runtime_profile_revision_id, observed_at, probe_report_id);

      CREATE TRIGGER IF NOT EXISTS runtime_profile_revision_content_immutable
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

      CREATE TRIGGER IF NOT EXISTS runtime_profile_revision_no_delete
      BEFORE DELETE ON runtime_profile_revisions
      BEGIN
        SELECT RAISE(ABORT, 'RuntimeProfileRevision cannot be deleted');
      END;

      CREATE TRIGGER IF NOT EXISTS runtime_profile_audit_no_update
      BEFORE UPDATE ON runtime_profile_audit_entries
      BEGIN
        SELECT RAISE(ABORT, 'Runtime Profile audit is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS runtime_profile_audit_no_delete
      BEFORE DELETE ON runtime_profile_audit_entries
      BEGIN
        SELECT RAISE(ABORT, 'Runtime Profile audit is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS runtime_profile_probe_report_no_update
      BEFORE UPDATE ON runtime_profile_probe_reports
      BEGIN
        SELECT RAISE(ABORT, 'Runtime Profile probe report is immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS runtime_profile_probe_report_no_delete
      BEFORE DELETE ON runtime_profile_probe_reports
      BEGIN
        SELECT RAISE(ABORT, 'Runtime Profile probe report is immutable');
      END;
    `);
    this.#database
      .prepare(
        "INSERT OR IGNORE INTO runtime_registry_metadata(singleton, registry_id, host_id, created_at) VALUES(1, ?, ?, ?)",
      )
      .run(`runtime_registry_${randomUUID()}`, this.hostId, this.#timestamp());
    const metadata = this.#database
      .prepare("SELECT * FROM runtime_registry_metadata WHERE singleton = 1")
      .get();
    if (metadata === undefined) {
      throw new Error("Runtime Registry metadata was not initialized");
    }
    const storedHostId = text(metadata, "host_id");
    if (storedHostId !== this.hostId) {
      throw new RuntimeProfileRegistryConflictError(
        `Runtime Registry belongs to Host ${storedHostId}, not ${this.hostId}`,
      );
    }
    const foreignKeyFailures = this.#database
      .prepare("PRAGMA foreign_key_check")
      .all();
    if (foreignKeyFailures.length > 0) {
      throw new RuntimeProfileRegistryConflictError(
        "Runtime Registry foreign-key integrity check failed",
      );
    }
    this.#database.exec(
      `PRAGMA user_version = ${String(RUNTIME_PROFILE_REGISTRY_SCHEMA_VERSION)}`,
    );
  }

  close(): void {
    this.#database.close();
  }

  importManifest(uncheckedManifest: unknown): RuntimeProfileRevision {
    const manifest = normalizeRuntimeProfileManifest(uncheckedManifest);
    const contentDigest = computeRuntimeProfileManifestDigest(manifest);
    return this.#transaction(() => {
      const existing = this.#database
        .prepare(
          "SELECT * FROM runtime_profile_revisions WHERE runtime_profile_id = ? AND content_digest = ?",
        )
        .get(manifest.runtimeProfileId, contentDigest);
      if (existing !== undefined) return this.#revisionFromRow(existing);

      const importedAt = this.#timestamp();
      this.#database
        .prepare(
          "INSERT OR IGNORE INTO runtime_profiles(runtime_profile_id, active_revision_id, created_at, updated_at) VALUES(?, NULL, ?, ?)",
        )
        .run(manifest.runtimeProfileId, importedAt, importedAt);
      const revisionRow = this.#database
        .prepare(
          "SELECT COALESCE(MAX(revision), 0) AS maximum_revision FROM runtime_profile_revisions WHERE runtime_profile_id = ?",
        )
        .get(manifest.runtimeProfileId);
      const revision =
        (revisionRow ? integer(revisionRow, "maximum_revision") : 0) + 1;
      const runtimeProfileRevisionId = `runtime_profile_revision_${randomUUID()}`;
      this.#database
        .prepare(
          `INSERT INTO runtime_profile_revisions(
             runtime_profile_revision_id, runtime_profile_id, revision,
             content_digest, manifest_version, manifest_json, state,
             imported_at, activated_at, deprecated_at
           ) VALUES(?, ?, ?, ?, ?, ?, 'inactive', ?, NULL, NULL)`,
        )
        .run(
          runtimeProfileRevisionId,
          manifest.runtimeProfileId,
          revision,
          contentDigest,
          manifest.manifestVersion,
          JSON.stringify(manifest),
          importedAt,
        );
      this.#database
        .prepare(
          "UPDATE runtime_profiles SET updated_at = ? WHERE runtime_profile_id = ?",
        )
        .run(importedAt, manifest.runtimeProfileId);
      this.#appendAudit({
        action: "imported",
        contentDigest,
        occurredAt: importedAt,
        runtimeProfileId: manifest.runtimeProfileId,
        runtimeProfileRevisionId,
      });
      return this.getRevision(runtimeProfileRevisionId);
    });
  }

  importManifestFile(manifestPath: string): RuntimeProfileRevision {
    if (!isAbsolute(manifestPath)) {
      throw new RuntimeProfileRegistrySecurityError(
        "Runtime Profile manifest path must be absolute",
      );
    }
    const resolvedPath = resolve(manifestPath);
    requireOwnerPrivateDirectory(dirname(resolvedPath));
    requireOwnerPrivateRegularFile(resolvedPath);
    const metadata = lstatSync(resolvedPath);
    if (metadata.size > 1_048_576) {
      throw new RuntimeProfileRegistrySecurityError(
        "Runtime Profile manifest exceeds the 1 MiB limit",
      );
    }
    const serialized = readFileSync(resolvedPath, "utf8");
    return this.importManifest(JSON.parse(serialized) as unknown);
  }

  activateRevision(input: {
    contentDigest: string;
    runtimeProfileRevisionId: string;
  }): RuntimeProfileRevision {
    return this.#transaction(() => {
      const row = this.#requireRevisionRow(input.runtimeProfileRevisionId);
      this.#requireMatchingDigest(row, input.contentDigest);
      const state = text(row, "state");
      if (state === "deprecated") {
        throw new RuntimeProfileRegistryConflictError(
          `RuntimeProfileRevision ${input.runtimeProfileRevisionId} is deprecated`,
        );
      }
      const revision = this.#revisionFromRow(row);
      if (revision.manifest.manifestVersion === 2) {
        const latestProbe = this.#database
          .prepare(
            `SELECT probe_report_id, available
             FROM runtime_profile_probe_reports
             WHERE runtime_profile_revision_id = ?
               AND runtime_profile_digest = ?
             ORDER BY rowid DESC
             LIMIT 1`,
          )
          .get(revision.runtimeProfileRevisionId, revision.contentDigest);
        if (latestProbe === undefined) {
          throw new RuntimeProfileRegistryConflictError(
            `RuntimeProfileRevision ${input.runtimeProfileRevisionId} requires a successful latest probe report before activation`,
          );
        }
        if (integer(latestProbe, "available") !== 1) {
          throw new RuntimeProfileRegistryConflictError(
            `RuntimeProfileRevision ${input.runtimeProfileRevisionId} latest probe report is not successful`,
          );
        }
      }
      if (state === "active") return revision;

      const runtimeProfileId = text(row, "runtime_profile_id");
      const activatedAt = this.#timestamp();
      this.#database
        .prepare(
          "UPDATE runtime_profile_revisions SET state = 'inactive' WHERE runtime_profile_id = ? AND state = 'active'",
        )
        .run(runtimeProfileId);
      this.#database
        .prepare(
          "UPDATE runtime_profile_revisions SET state = 'active', activated_at = ? WHERE runtime_profile_revision_id = ?",
        )
        .run(activatedAt, input.runtimeProfileRevisionId);
      this.#database
        .prepare(
          "UPDATE runtime_profiles SET active_revision_id = ?, updated_at = ? WHERE runtime_profile_id = ?",
        )
        .run(input.runtimeProfileRevisionId, activatedAt, runtimeProfileId);
      this.#appendAudit({
        action: "activated",
        contentDigest: text(row, "content_digest"),
        occurredAt: activatedAt,
        runtimeProfileId,
        runtimeProfileRevisionId: input.runtimeProfileRevisionId,
      });
      return this.getRevision(input.runtimeProfileRevisionId);
    });
  }

  deprecateRevision(input: {
    contentDigest: string;
    reason: string;
    runtimeProfileRevisionId: string;
  }): RuntimeProfileRevision {
    const reason = input.reason.trim();
    if (reason.length === 0) {
      throw new Error("deprecation reason is required");
    }
    return this.#transaction(() => {
      const row = this.#requireRevisionRow(input.runtimeProfileRevisionId);
      this.#requireMatchingDigest(row, input.contentDigest);
      if (text(row, "state") === "deprecated") {
        return this.#revisionFromRow(row);
      }
      const runtimeProfileId = text(row, "runtime_profile_id");
      const deprecatedAt = this.#timestamp();
      this.#database
        .prepare(
          "UPDATE runtime_profile_revisions SET state = 'deprecated', deprecated_at = ? WHERE runtime_profile_revision_id = ?",
        )
        .run(deprecatedAt, input.runtimeProfileRevisionId);
      this.#database
        .prepare(
          "UPDATE runtime_profiles SET active_revision_id = CASE WHEN active_revision_id = ? THEN NULL ELSE active_revision_id END, updated_at = ? WHERE runtime_profile_id = ?",
        )
        .run(input.runtimeProfileRevisionId, deprecatedAt, runtimeProfileId);
      this.#appendAudit({
        action: "deprecated",
        contentDigest: text(row, "content_digest"),
        occurredAt: deprecatedAt,
        reason,
        runtimeProfileId,
        runtimeProfileRevisionId: input.runtimeProfileRevisionId,
      });
      return this.getRevision(input.runtimeProfileRevisionId);
    });
  }

  getProfile(runtimeProfileId: string): RuntimeProfile {
    const row = this.#database
      .prepare("SELECT * FROM runtime_profiles WHERE runtime_profile_id = ?")
      .get(runtimeProfileId);
    if (row === undefined) {
      throw new RuntimeProfileRegistryNotFoundError(
        `RuntimeProfile ${runtimeProfileId} was not found`,
      );
    }
    return this.#profileFromRow(row);
  }

  getActiveRevision(runtimeProfileId: string): RuntimeProfileRevision | null {
    const profile = this.getProfile(runtimeProfileId);
    return profile.activeRevisionId === undefined
      ? null
      : this.getRevision(profile.activeRevisionId);
  }

  getRevision(runtimeProfileRevisionId: string): RuntimeProfileRevision {
    return this.#revisionFromRow(
      this.#requireRevisionRow(runtimeProfileRevisionId),
    );
  }

  listProfiles(): RuntimeProfile[] {
    return this.#database
      .prepare("SELECT * FROM runtime_profiles ORDER BY runtime_profile_id")
      .all()
      .map((row) => this.#profileFromRow(row));
  }

  listRevisions(runtimeProfileId?: string): RuntimeProfileRevision[] {
    const rows =
      runtimeProfileId === undefined
        ? this.#database
            .prepare(
              "SELECT * FROM runtime_profile_revisions ORDER BY runtime_profile_id, revision",
            )
            .all()
        : this.#database
            .prepare(
              "SELECT * FROM runtime_profile_revisions WHERE runtime_profile_id = ? ORDER BY revision",
            )
            .all(runtimeProfileId);
    return rows.map((row) => this.#revisionFromRow(row));
  }

  listAuditEntries(runtimeProfileId?: string): RuntimeProfileAuditEntry[] {
    const rows =
      runtimeProfileId === undefined
        ? this.#database
            .prepare(
              "SELECT * FROM runtime_profile_audit_entries ORDER BY sequence",
            )
            .all()
        : this.#database
            .prepare(
              "SELECT * FROM runtime_profile_audit_entries WHERE runtime_profile_id = ? ORDER BY sequence",
            )
            .all(runtimeProfileId);
    return rows.map((row) => this.#auditEntryFromRow(row));
  }

  recordProbeReport(
    input: RuntimeProfileProbeObservation,
  ): RuntimeProfileProbeReport {
    if (!isIssuedRuntimeProfileProbeObservation(input)) {
      throw new RuntimeProfileRegistrySecurityError(
        "probe observations must be issued by RuntimeImplementationRegistry",
      );
    }
    return this.#transaction(() => {
      const revisionRow = this.#requireRevisionRow(
        input.runtimeProfileRevisionId,
      );
      this.#requireMatchingDigest(revisionRow, input.contentDigest);
      const revision = this.#revisionFromRow(revisionRow);
      if (input.adapter.kind !== revision.manifest.adapter.kind) {
        throw new RuntimeProfileRegistryConflictError(
          `probe adapter kind does not match RuntimeProfileRevision ${input.runtimeProfileRevisionId}`,
        );
      }
      if (
        input.available &&
        input.executableIdentity?.requestedExecutable !==
          revision.manifest.adapter.executable
      ) {
        throw new RuntimeProfileRegistryConflictError(
          `probe executable does not match RuntimeProfileRevision ${input.runtimeProfileRevisionId}`,
        );
      }
      if (
        input.available &&
        !sameStringSet(
          input.recoveryDrivers.map((driver) => driver.driver),
          revision.manifest.recoveryDrivers,
        )
      ) {
        throw new RuntimeProfileRegistryConflictError(
          `probe recovery drivers do not match RuntimeProfileRevision ${input.runtimeProfileRevisionId}`,
        );
      }
      const probeReportId = `runtime_profile_probe_${randomUUID()}`;
      const reportWithoutDigest = {
        adapter: input.adapter,
        available: input.available,
        ...(input.executableIdentity === undefined
          ? {}
          : { executableIdentity: input.executableIdentity }),
        ...(input.failureCode === undefined
          ? {}
          : { failureCode: input.failureCode }),
        observedAt: this.#timestamp(),
        probeReportId,
        recoveryDrivers: [...input.recoveryDrivers].sort((left, right) =>
          left.driver.localeCompare(right.driver),
        ),
        reportVersion: 1 as const,
        runtimeProfileDigest: revision.contentDigest,
        runtimeProfileId: revision.runtimeProfileId,
        runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
      };
      const report = RuntimeProfileProbeReportSchema.parse({
        ...reportWithoutDigest,
        probeDigest: computeRuntimeProfileProbeDigest(reportWithoutDigest),
      });
      this.#database
        .prepare(
          `INSERT INTO runtime_profile_probe_reports(
             probe_report_id, probe_digest, runtime_profile_id,
             runtime_profile_revision_id, runtime_profile_digest,
             available, observed_at, report_json
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          report.probeReportId,
          report.probeDigest,
          report.runtimeProfileId,
          report.runtimeProfileRevisionId,
          report.runtimeProfileDigest,
          report.available ? 1 : 0,
          report.observedAt,
          JSON.stringify(report),
        );
      this.#appendAudit({
        action: "probe_recorded",
        contentDigest: report.probeDigest,
        occurredAt: report.observedAt,
        reason: report.available
          ? "available"
          : (report.failureCode ?? "unavailable"),
        runtimeProfileId: report.runtimeProfileId,
        runtimeProfileRevisionId: report.runtimeProfileRevisionId,
      });
      return report;
    });
  }

  getProbeReport(probeReportId: string): RuntimeProfileProbeReport {
    const row = this.#database
      .prepare(
        "SELECT * FROM runtime_profile_probe_reports WHERE probe_report_id = ?",
      )
      .get(probeReportId);
    if (row === undefined) {
      throw new RuntimeProfileRegistryNotFoundError(
        `RuntimeProfileProbeReport ${probeReportId} was not found`,
      );
    }
    return this.#probeReportFromRow(row);
  }

  listProbeReports(
    runtimeProfileRevisionId?: string,
  ): RuntimeProfileProbeReport[] {
    const rows =
      runtimeProfileRevisionId === undefined
        ? this.#database
            .prepare(
              "SELECT * FROM runtime_profile_probe_reports ORDER BY observed_at, probe_report_id",
            )
            .all()
        : this.#database
            .prepare(
              "SELECT * FROM runtime_profile_probe_reports WHERE runtime_profile_revision_id = ? ORDER BY observed_at, probe_report_id",
            )
            .all(runtimeProfileRevisionId);
    return rows.map((row) => this.#probeReportFromRow(row));
  }

  #appendAudit(input: {
    action: RuntimeProfileAuditAction;
    contentDigest: string;
    occurredAt: string;
    reason?: string;
    runtimeProfileId: string;
    runtimeProfileRevisionId: string;
  }): void {
    this.#database
      .prepare(
        "INSERT INTO runtime_profile_audit_entries(audit_entry_id, action, runtime_profile_id, runtime_profile_revision_id, content_digest, reason, occurred_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        `runtime_profile_audit_${randomUUID()}`,
        input.action,
        input.runtimeProfileId,
        input.runtimeProfileRevisionId,
        input.contentDigest,
        input.reason ?? null,
        input.occurredAt,
      );
  }

  #requireRevisionRow(runtimeProfileRevisionId: string): Row {
    const row = this.#database
      .prepare(
        "SELECT * FROM runtime_profile_revisions WHERE runtime_profile_revision_id = ?",
      )
      .get(runtimeProfileRevisionId);
    if (row === undefined) {
      throw new RuntimeProfileRegistryNotFoundError(
        `RuntimeProfileRevision ${runtimeProfileRevisionId} was not found`,
      );
    }
    return row;
  }

  #requireMatchingDigest(row: Row, contentDigest: string): void {
    if (text(row, "content_digest") !== contentDigest) {
      throw new RuntimeProfileRegistryConflictError(
        `RuntimeProfileRevision ${text(row, "runtime_profile_revision_id")} digest does not match`,
      );
    }
  }

  #profileFromRow(row: Row): RuntimeProfile {
    const activeRevisionId = nullableText(row, "active_revision_id");
    return RuntimeProfileSchema.parse({
      activeRevisionId: activeRevisionId ?? undefined,
      createdAt: text(row, "created_at"),
      runtimeProfileId: text(row, "runtime_profile_id"),
      updatedAt: text(row, "updated_at"),
    });
  }

  #revisionFromRow(row: Row): RuntimeProfileRevision {
    const manifest = normalizeRuntimeProfileManifest(
      JSON.parse(text(row, "manifest_json")),
    );
    if (manifest.manifestVersion !== integer(row, "manifest_version")) {
      throw new RuntimeProfileRegistryConflictError(
        `RuntimeProfileRevision ${text(row, "runtime_profile_revision_id")} manifest version is corrupted`,
      );
    }
    const storedDigest = text(row, "content_digest");
    if (computeRuntimeProfileManifestDigest(manifest) !== storedDigest) {
      throw new RuntimeProfileRegistryConflictError(
        `RuntimeProfileRevision ${text(row, "runtime_profile_revision_id")} manifest digest is corrupted`,
      );
    }
    const activatedAt = nullableText(row, "activated_at");
    const deprecatedAt = nullableText(row, "deprecated_at");
    return RuntimeProfileRevisionSchema.parse({
      activatedAt: activatedAt ?? undefined,
      contentDigest: storedDigest,
      deprecatedAt: deprecatedAt ?? undefined,
      importedAt: text(row, "imported_at"),
      manifest,
      revision: integer(row, "revision"),
      runtimeProfileId: text(row, "runtime_profile_id"),
      runtimeProfileRevisionId: text(row, "runtime_profile_revision_id"),
      state: text(row, "state"),
    });
  }

  #probeReportFromRow(row: Row): RuntimeProfileProbeReport {
    const report = RuntimeProfileProbeReportSchema.parse(
      JSON.parse(text(row, "report_json")),
    );
    const { probeDigest: _discarded, ...reportWithoutDigest } = report;
    if (
      report.probeReportId !== text(row, "probe_report_id") ||
      report.probeDigest !== text(row, "probe_digest") ||
      report.runtimeProfileId !== text(row, "runtime_profile_id") ||
      report.runtimeProfileRevisionId !==
        text(row, "runtime_profile_revision_id") ||
      report.runtimeProfileDigest !== text(row, "runtime_profile_digest") ||
      report.available !== (integer(row, "available") === 1) ||
      report.observedAt !== text(row, "observed_at") ||
      computeRuntimeProfileProbeDigest(reportWithoutDigest) !==
        report.probeDigest
    ) {
      throw new RuntimeProfileRegistryConflictError(
        `RuntimeProfileProbeReport ${text(row, "probe_report_id")} is corrupted`,
      );
    }
    return report;
  }

  #auditEntryFromRow(row: Row): RuntimeProfileAuditEntry {
    const reason = nullableText(row, "reason");
    return RuntimeProfileAuditEntrySchema.parse({
      action: text(row, "action"),
      auditEntryId: text(row, "audit_entry_id"),
      contentDigest: text(row, "content_digest"),
      occurredAt: text(row, "occurred_at"),
      reason: reason ?? undefined,
      runtimeProfileId: text(row, "runtime_profile_id"),
      runtimeProfileRevisionId: text(row, "runtime_profile_revision_id"),
      sequence: integer(row, "sequence"),
    });
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #migrateSchemaV1ToV2(): void {
    this.#database.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
    try {
      this.#database.exec(`
        DROP TRIGGER IF EXISTS runtime_profile_revision_content_immutable;
        DROP TRIGGER IF EXISTS runtime_profile_revision_no_delete;
        DROP TRIGGER IF EXISTS runtime_profile_audit_no_update;
        DROP TRIGGER IF EXISTS runtime_profile_audit_no_delete;

        ALTER TABLE runtime_profile_audit_entries RENAME TO runtime_profile_audit_entries_v1;
        ALTER TABLE runtime_profile_revisions RENAME TO runtime_profile_revisions_v1;
        ALTER TABLE runtime_profiles RENAME TO runtime_profiles_v1;

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

        INSERT INTO runtime_profiles
          SELECT * FROM runtime_profiles_v1;
        INSERT INTO runtime_profile_revisions
          SELECT * FROM runtime_profile_revisions_v1;
        INSERT INTO runtime_profile_audit_entries
          SELECT * FROM runtime_profile_audit_entries_v1;

        DROP TABLE runtime_profile_audit_entries_v1;
        DROP TABLE runtime_profile_revisions_v1;
        DROP TABLE runtime_profiles_v1;
        PRAGMA user_version = 2;
        COMMIT;
      `);
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    } finally {
      this.#database.exec("PRAGMA foreign_keys = ON");
    }
  }
}

function requireOwnerPrivateDirectory(directory: string): void {
  const metadata = lstatSync(directory);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    !ownedByCurrentUser(metadata) ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new RuntimeProfileRegistrySecurityError(
      `Runtime Registry directory must be owner-private: ${directory}`,
    );
  }
}

function requireOwnerPrivateRegularFile(path: string): void {
  const metadata = lstatSync(path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    !ownedByCurrentUser(metadata) ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new RuntimeProfileRegistrySecurityError(
      `Runtime Registry database must be an owner-private regular file: ${path}`,
    );
  }
}

function ownedByCurrentUser(metadata: Stats): boolean {
  const currentUserId = process.getuid?.();
  return currentUserId === undefined || metadata.uid === currentUserId;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  );
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`expected ${key} to be text`);
  return value;
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`expected ${key} to be nullable text`);
  }
  return value;
}

function integer(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`expected ${key} to be an integer`);
  }
  return value;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
