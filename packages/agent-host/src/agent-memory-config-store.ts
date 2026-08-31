import { closeSync, constants, lstatSync, mkdirSync, openSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AgentMemoryCleanerDefaults,
  AgentMemoryCleanerOverridesSchema,
  AgentMemoryConfigPatchSchema,
  AgentMemoryConfigSnapshotSchema,
  type AgentMemoryConfigPatch,
  type AgentMemoryConfigSnapshot,
} from "@rah-os/protocol";

export class AgentMemoryConfigConflict extends Error {
  readonly code = "agent_memory_config_conflict";
  constructor() {
    super("Cleaner configuration revision conflict; reload before saving");
  }
}

/** Computer config only: no memory bytes, no Room state, no provider lifecycle.
 * One short-lived SQLite transaction supplies cross-instance CAS and recovery.
 */
export class AgentMemoryConfigStore {
  readonly #root: string;
  constructor(rootDirectory: string) {
    if (!isAbsolute(rootDirectory))
      throw new Error("Cleaner config root must be absolute");
    this.#root = resolve(rootDirectory);
  }

  get(ownerParticipantId: string): AgentMemoryConfigSnapshot {
    AgentMemoryConfigSnapshotSchema.shape.ownerParticipantId.parse(
      ownerParticipantId,
    );
    const database = this.#open(false);
    if (!database) return snapshot(ownerParticipantId, 0, {});
    try {
      return read(database, ownerParticipantId);
    } finally {
      database.close();
    }
  }

  patch(
    ownerParticipantId: string,
    input: AgentMemoryConfigPatch,
  ): AgentMemoryConfigSnapshot {
    AgentMemoryConfigSnapshotSchema.shape.ownerParticipantId.parse(
      ownerParticipantId,
    );
    const patch = AgentMemoryConfigPatchSchema.parse(input);
    const database = this.#open(true)!;
    try {
      database.exec("BEGIN IMMEDIATE");
      const current = read(database, ownerParticipantId);
      if (patch.expectedRevision !== current.revision)
        throw new AgentMemoryConfigConflict();
      const overrides = { ...current.overrides, ...patch.set };
      for (const key of patch.unset ?? []) delete overrides[key];
      const next = snapshot(
        ownerParticipantId,
        current.revision + 1,
        overrides,
      );
      database
        .prepare(
          `INSERT INTO cleaner_config(owner, revision, overrides) VALUES (?, ?, ?)
        ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision, overrides=excluded.overrides`,
        )
        .run(ownerParticipantId, next.revision, JSON.stringify(next.overrides));
      database.exec("COMMIT");
      return next;
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    } finally {
      database.close();
    }
  }

  #open(create: boolean): DatabaseSync | undefined {
    if (!privatePath(this.#root, "directory")) {
      if (!create) return undefined;
      mkdirSync(this.#root, { recursive: true, mode: 0o700 });
      privatePath(this.#root, "directory");
    }
    const path = join(this.#root, ".cleaner-config.sqlite");
    if (!privatePath(path, "file")) {
      if (!create) return undefined;
      try {
        const fd = openSync(
          path,
          constants.O_CREAT |
            constants.O_EXCL |
            constants.O_WRONLY |
            constants.O_NOFOLLOW,
          0o600,
        );
        closeSync(fd);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      privatePath(path, "file");
    }
    // Reject unexpected pre-existing SQLite sidecars before opening them.
    for (const suffix of ["-journal", "-wal", "-shm"])
      privatePath(`${path}${suffix}`, "file");
    const database = new DatabaseSync(path);
    try {
      database.exec(
        "PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;",
      );
      database.exec(
        "CREATE TABLE IF NOT EXISTS cleaner_config(owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, overrides TEXT NOT NULL) STRICT",
      );
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }
}

function privatePath(path: string, kind: "directory" | "file"): boolean {
  let info;
  try {
    info = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (
    info.isSymbolicLink() ||
    (kind === "directory" ? !info.isDirectory() : !info.isFile()) ||
    (info.mode & 0o077) !== 0 ||
    (process.getuid && info.uid !== process.getuid()) ||
    (kind === "file" && info.nlink !== 1)
  ) {
    throw new Error("Cleaner config requires private owner-only paths");
  }
  return true;
}

function read(
  database: DatabaseSync,
  owner: string,
): AgentMemoryConfigSnapshot {
  const row = database
    .prepare("SELECT revision, overrides FROM cleaner_config WHERE owner=?")
    .get(owner);
  return row
    ? snapshot(
        owner,
        row.revision as number,
        JSON.parse(row.overrides as string),
      )
    : snapshot(owner, 0, {});
}

function snapshot(
  ownerParticipantId: string,
  revision: number,
  input: unknown,
): AgentMemoryConfigSnapshot {
  const overrides = AgentMemoryCleanerOverridesSchema.parse(input);
  return AgentMemoryConfigSnapshotSchema.parse({
    appId: "system.cleaner",
    ownerParticipantId,
    revision,
    overrides,
    effective: { ...AgentMemoryCleanerDefaults, ...overrides },
  });
}
