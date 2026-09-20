import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { integer } from "./sqlite-row.ts";
import {
  indexSignature,
  isKnownLegacyDrift,
  isPresentedWindowMigration,
  isIdentityAccountsMigration,
  sqlSignature,
  tableSignature,
} from "./kernel-schema-signature.ts";

/** A schema difference that opening the database would repair. */
export type KernelSchemaChange = {
  detail?: string;
  kind:
    | "legacy_drift"
    | "unexpected_drift"
    | "missing_object"
    | "schema_version"
    | "table_migration";
  name: string;
};

/** Read-only answer to "would opening this database change its schema?". */
export type KernelSchemaState = {
  databasePath: string;
  /**
   * Exact known historical omissions are legacy_drift. Other differences are
   * unexpected_drift and must be resolved by migration or block startup.
   */
  drift: readonly KernelSchemaChange[];
  databaseSchemaVersion: number;
  kernelSchemaVersion: number;
  openMode: "read-only" | "read-write";
  pending: readonly KernelSchemaChange[];
  supported: boolean;
  unknownObjects: readonly string[];
};

export type KernelInitializeOptions = {
  /** Migration-unit seam for fault injection and deployment diagnostics. */
  beforeMigrationUnit?: (unit: string) => void;
};

export type MigrationUnitMode = "external" | "transactional";

export const SCHEMA_MIGRATION_JOURNAL_SQL = `
CREATE TABLE IF NOT EXISTS kernel_schema_migration_journal (
  unit TEXT PRIMARY KEY,
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('transactional', 'external')),
  state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'failed')),
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  last_error TEXT
) STRICT;
`;

export function databaseSchemaVersion(database: DatabaseSync): number {
  const row = database.prepare("PRAGMA user_version").get();
  return row ? integer(row, "user_version") : 0;
}

/**
 * Structural signatures of every object this build owns. Tables and indexes are
 * compared through PRAGMA introspection; triggers and views have no pragma, so
 * their normalized SQL is used. An object type with no usable comparison gets
 * an empty signature and is therefore never reported as changed.
 */
export function schemaObjects(database: DatabaseSync): Map<string, string> {
  const objects = new Map<string, string>();
  for (const row of database
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all()) {
    const type = String(row.type),
      name = String(row.name);
    let signature = "";
    if (type === "table") signature = tableSignature(database, name, row.sql);
    else if (type === "index")
      signature = indexSignature(database, name, String(row.tbl_name), row.sql);
    else if (type === "trigger" || type === "view")
      signature = sqlSignature(row.sql);
    objects.set(`${type}:${name}`, signature);
  }
  return objects;
}

export function compareSchema(input: {
  database: DatabaseSync;
  databaseSchemaVersion: number;
  kernelSchemaVersion: number;
  reference: Map<string, string>;
}): {
  drift: KernelSchemaChange[];
  pending: KernelSchemaChange[];
  unknownObjects: string[];
} {
  const live = schemaObjects(input.database);
  const drift: KernelSchemaChange[] = [];
  const pending: KernelSchemaChange[] = [];
  if (input.databaseSchemaVersion !== input.kernelSchemaVersion) {
    pending.push({
      detail: `${input.databaseSchemaVersion} -> ${input.kernelSchemaVersion}`,
      kind: "schema_version",
      name: "user_version",
    });
  }
  for (const [name, signature] of input.reference) {
    const current = live.get(name);
    if (current === undefined) pending.push({ kind: "missing_object", name });
    else if (current !== signature) {
      if (
        isPresentedWindowMigration(name, current, signature) ||
        (input.databaseSchemaVersion < 57 &&
          isIdentityAccountsMigration(name, current, signature))
      ) {
        pending.push({ kind: "table_migration", name });
        continue;
      }
      const known =
        isKnownLegacyDrift(name, current, signature) &&
        (name !== "table:room_deletion_receipts" ||
          !input.database
            .prepare(
              "SELECT 1 FROM room_deletion_receipts WHERE gc_reclaimed_count < 0 OR gc_reclaimed_count > file_count LIMIT 1",
            )
            .get()) &&
        (name !== "table:runtime_offers" ||
          !input.database
            .prepare(
              "SELECT 1 FROM runtime_offers WHERE current_observation_id IS NOT NULL GROUP BY current_observation_id HAVING count(*) > 1 LIMIT 1",
            )
            .get());
      drift.push({ kind: known ? "legacy_drift" : "unexpected_drift", name });
    }
  }
  // Objects this build does not create are left alone: an older leftover must
  // not make every ordinary start look like an upgrade.
  const unknownObjects = [...live.keys()]
    .filter((name) => !input.reference.has(name))
    .sort();
  return { drift, pending, unknownObjects };
}

/** Opens `databasePath` without writing to it and reports its schema state. */
export function inspectSchemaState(input: {
  databasePath: string;
  kernelSchemaVersion: number;
  reference: () => Map<string, string>;
}): KernelSchemaState {
  if (!existsSync(input.databasePath)) {
    throw new Error(`Kernel database ${input.databasePath} does not exist`);
  }
  const database = new DatabaseSync(input.databasePath, {
    readOnly: true,
    timeout: 5_000,
  });
  try {
    const version = databaseSchemaVersion(database);
    const compared = compareSchema({
      database,
      databaseSchemaVersion: version,
      kernelSchemaVersion: input.kernelSchemaVersion,
      reference: input.reference(),
    });
    return {
      databasePath: input.databasePath,
      databaseSchemaVersion: version,
      drift: compared.drift,
      kernelSchemaVersion: input.kernelSchemaVersion,
      openMode: "read-only",
      pending: compared.pending,
      supported: version <= input.kernelSchemaVersion,
      unknownObjects: compared.unknownObjects,
    };
  } finally {
    database.close();
  }
}

export function assertNoUnexpectedSchemaDrift(
  drift: readonly KernelSchemaChange[],
): void {
  const unexpected = drift.filter(
    (change) => change.kind === "unexpected_drift",
  );
  if (unexpected.length)
    throw new Error(
      `unrecognized schema drift: ${unexpected.map((change) => change.name).join(", ")}; database repair requires an explicit migration`,
    );
}

/**
 * Durable record of migration units that cannot share a transaction with the
 * schema change itself. Written in autocommit so it survives a unit rollback.
 */
export function recordMigrationUnit(input: {
  database: DatabaseSync;
  error?: unknown;
  fromVersion: number;
  mode: MigrationUnitMode;
  state: "completed" | "failed" | "running";
  timestamp: string;
  toVersion: number;
  unit: string;
}): void {
  input.database
    .prepare(
      `INSERT INTO kernel_schema_migration_journal(
         unit, from_version, to_version, mode, state, attempts, started_at, finished_at, last_error
       ) VALUES(?, ?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(unit) DO UPDATE SET
         from_version = excluded.from_version,
         to_version = excluded.to_version,
         mode = excluded.mode,
         state = excluded.state,
         attempts = kernel_schema_migration_journal.attempts +
           (CASE WHEN excluded.state = 'running' THEN 1 ELSE 0 END),
         started_at = CASE
           WHEN excluded.state = 'running' THEN excluded.started_at
           ELSE kernel_schema_migration_journal.started_at
         END,
         finished_at = excluded.finished_at,
         last_error = excluded.last_error`,
    )
    .run(
      input.unit,
      input.fromVersion,
      input.toVersion,
      input.mode,
      input.state,
      input.timestamp,
      input.state === "running" ? null : input.timestamp,
      input.error === undefined
        ? null
        : (input.error instanceof Error
            ? input.error.message
            : String(input.error)
          ).slice(0, 500),
    );
}

/**
 * Builds the migration-unit runner. Transaction-safe DDL shares one failure
 * domain per unit; units that toggle PRAGMA foreign_keys, rebuild tables or
 * VACUUM cannot run inside a transaction, so they carry a journal record.
 */
export function migrationUnitRunner(input: {
  before?: ((unit: string) => void) | undefined;
  database: DatabaseSync;
  fromVersion: number;
  journalled: boolean;
  timestamp: () => string;
  toVersion: number;
  transaction: (operation: () => void) => void;
}): (unit: string, mode: MigrationUnitMode, run: () => void) => void {
  return (unit, mode, run) => {
    input.before?.(unit);
    const execute =
      mode === "transactional" ? () => input.transaction(run) : run;
    if (!input.journalled) {
      execute();
      return;
    }
    const journal = (
      state: "completed" | "failed" | "running",
      error?: unknown,
    ): void =>
      recordMigrationUnit({
        database: input.database,
        error,
        fromVersion: input.fromVersion,
        mode,
        state,
        timestamp: input.timestamp(),
        toVersion: input.toVersion,
        unit,
      });
    journal("running");
    try {
      execute();
    } catch (error) {
      journal("failed", error);
      throw error;
    }
    journal("completed");
  };
}
