import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const MAX_RECORD_BYTES = 16 * 1024;
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_SESSION_ID_LENGTH = 4_096;
const QUARANTINE_MANIFEST_NAME = ".operation-manifest";

export type ProviderSessionKey = Readonly<{
  participantId: string;
  provider: string;
  runtimeProfileRevisionId: string;
  /**
   * Digest of the daemon-compiled standing prompt this session was started
   * under. Optional so a record written before compiled standing prompts keeps
   * resolving to its stored key; a launch that carries a digest keys a
   * different record, so an edited Agent role or instructions can never resume
   * a session that ran under the previous prompt.
   */
  standingPromptDigest?: string;
  workspaceMountRevisionId: string;
}>;

export type ProviderSessionRecord = ProviderSessionKey &
  Readonly<{
    providerSessionId: string;
    systemMemorySha256?: string;
    recordedAt: string;
    schemaVersion: 1;
  }>;

export type ProviderSessionParticipantQuarantine = Readonly<{
  operationId: string;
  participantId: string;
  recordCount: number;
  rollback(): Promise<void>;
}>;

export class ProviderSessionStore {
  readonly #now: () => Date;
  readonly #rootDirectory: string;

  constructor(input: { now?: () => Date; rootDirectory: string }) {
    if (!isAbsolute(input.rootDirectory)) {
      throw new Error("Provider session root must be absolute");
    }
    this.#now = input.now ?? (() => new Date());
    this.#rootDirectory = resolve(input.rootDirectory);
  }

  async load(
    uncheckedKey: ProviderSessionKey,
    options: {
      instance?: boolean;
      /** Advanced by a Human session reset; 0 keeps the historical key. */
      instanceGeneration?: number | undefined;
      requireExisting?: boolean;
    } = {},
  ): Promise<ProviderSessionRecord | null> {
    const key = validateKey(uncheckedKey);
    if (options.instance) {
      const record = await this.#loadInstance(
        key,
        instanceGenerationOf(options.instanceGeneration),
      );
      if (record === null && options.requireExisting)
        throw new Error(
          "RAH_SESSION_CONTINUITY_REQUIRED: previously launched instance has no session binding",
        );
      return record;
    }
    await this.#ensurePrivateRoot();
    const path = this.#recordPath(key);
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    assertPrivateFile(metadata, path);
    if (metadata.size > MAX_RECORD_BYTES) {
      throw new Error("Provider session record exceeds its safe byte limit");
    }
    const raw = await readFile(path, "utf8");
    if (Buffer.byteLength(raw) > MAX_RECORD_BYTES) {
      throw new Error("Provider session record exceeds its safe byte limit");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Provider session record is not valid JSON");
    }
    const record = validateRecord(parsed);
    if (!sameKey(record, key)) {
      throw new Error(
        "Provider session record identity does not match its key",
      );
    }
    return record;
  }

  async record(
    uncheckedKey: ProviderSessionKey,
    providerSessionId: string,
    metadata: {
      systemMemorySha256?: string | undefined;
      instance?: boolean;
      instanceGeneration?: number | undefined;
    } = {},
  ): Promise<ProviderSessionRecord> {
    const validated = validateKey(uncheckedKey);
    const generation = instanceGenerationOf(metadata.instanceGeneration);
    if (metadata.instance) {
      const previous = await this.#loadInstance(validated, generation);
      if (previous && previous.providerSessionId !== providerSessionId)
        throw new Error(
          "RAH_SESSION_CONTINUITY_REQUIRED: refusing instance session replacement",
        );
    }
    const key = metadata.instance
      ? instanceKey(validated, generation)
      : validated;
    const sessionId = requiredText(
      providerSessionId,
      "providerSessionId",
      MAX_SESSION_ID_LENGTH,
    );
    const now = this.#now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new Error("Provider session clock returned an invalid Date");
    }
    const value: ProviderSessionRecord = Object.freeze({
      ...key,
      ...systemMemoryMetadata(metadata.systemMemorySha256),
      providerSessionId: sessionId,
      recordedAt: now.toISOString(),
      schemaVersion: 1,
    });
    const payload = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(payload) > MAX_RECORD_BYTES) {
      throw new Error("Provider session record exceeds its safe byte limit");
    }
    await this.#ensurePrivateRoot();
    const path = this.#recordPath(key);
    const temporaryPath = join(
      this.#rootDirectory,
      `.${this.#recordName(key)}.${randomUUID()}.tmp`,
    );
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(payload, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, path);
      await syncDirectory(this.#rootDirectory);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    return value;
  }

  /** One native session per instance/provider, independent of configuration
   * revisions. Existing records are adopted only when identity is unambiguous.
   * This remains Host session metadata, not a second Room execution queue. */
  async #loadInstance(
    key: ProviderSessionKey,
    generation: number,
  ): Promise<ProviderSessionRecord | null> {
    const stable = instanceKey(key, generation);
    const bound = await this.load(stable);
    if (bound) return bound;
    // Adoption predates resets: a reset generation always starts fresh.
    if (generation > 0) return null;
    const candidates: ProviderSessionRecord[] = [];
    // One-time adoption of pre-binding MVP records. Never choose by mtime.
    for (const entry of await readdir(this.#rootDirectory, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const path = join(this.#rootDirectory, entry.name);
      const metadata = await lstat(path);
      assertPrivateFile(metadata, path);
      if (metadata.size > MAX_RECORD_BYTES)
        throw new Error("Provider session record exceeds its safe byte limit");
      const record = validateRecord(JSON.parse(await readFile(path, "utf8")));
      if (entry.name !== this.#recordName(validateKey(record)))
        throw new Error(
          "Provider session record identity does not match its filename",
        );
      if (record.participantId === key.participantId) candidates.push(record);
    }
    if (candidates.length === 0) return null;
    if (
      candidates.some((record) => record.provider !== key.provider) ||
      new Set(candidates.map((record) => record.providerSessionId)).size !== 1
    )
      throw new Error(
        "RAH_SESSION_CONTINUITY_REQUIRED: ambiguous or incompatible instance binding",
      );
    const first = candidates[0]!;
    // A memory digest is safe only when all records agree; otherwise use the
    // existing tool fallback, never assume a newer system snapshot was read.
    const digests = new Set(
      candidates.map((record) => record.systemMemorySha256),
    );
    return this.record(stable, first.providerSessionId, {
      systemMemorySha256:
        digests.size === 1 ? first.systemMemorySha256 : undefined,
    });
  }

  async invalidate(uncheckedKey: ProviderSessionKey): Promise<void> {
    const key = validateKey(uncheckedKey);
    await this.#ensurePrivateRoot();
    const path = this.#recordPath(key);
    try {
      assertPrivateFile(await lstat(path), path);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    await rm(path);
    await syncDirectory(this.#rootDirectory);
  }

  async quarantineParticipant(
    uncheckedParticipantId: string,
    uncheckedOperationId: string,
  ): Promise<ProviderSessionParticipantQuarantine> {
    const participantId = requiredText(
      uncheckedParticipantId,
      "participantId",
      MAX_IDENTIFIER_LENGTH,
    );
    const operationId = requiredText(
      uncheckedOperationId,
      "operationId",
      MAX_IDENTIFIER_LENGTH,
    );
    await this.#ensurePrivateRoot();
    const quarantineRoot = join(this.#rootDirectory, ".quarantine");
    await ensurePrivateDirectory(quarantineRoot, "Provider session quarantine");
    const operationDirectory = join(
      quarantineRoot,
      createHash("sha256").update(operationId).digest("hex"),
    );
    await mkdir(operationDirectory, { mode: 0o700, recursive: true });
    await assertPrivateDirectory(
      operationDirectory,
      "Provider session quarantine operation",
    );
    await ensureQuarantineManifest(
      operationDirectory,
      operationId,
      participantId,
    );

    const candidates: Array<{ name: string; path: string }> = [];
    for (const entry of await readdir(this.#rootDirectory, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const path = join(this.#rootDirectory, entry.name);
      const metadata = await lstat(path);
      assertPrivateFile(metadata, path);
      if (metadata.size > MAX_RECORD_BYTES) {
        throw new Error("Provider session record exceeds its safe byte limit");
      }
      const record = validateRecord(JSON.parse(await readFile(path, "utf8")));
      if (record.participantId === participantId) {
        candidates.push({ name: entry.name, path });
      }
    }

    const moved: Array<{ originalPath: string; quarantinePath: string }> = [];
    for (const entry of await readdir(operationDirectory, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const quarantinePath = join(operationDirectory, entry.name);
      const metadata = await lstat(quarantinePath);
      assertPrivateFile(metadata, quarantinePath);
      if (metadata.size > MAX_RECORD_BYTES) {
        throw new Error("Provider session record exceeds its safe byte limit");
      }
      const record = validateRecord(
        JSON.parse(await readFile(quarantinePath, "utf8")),
      );
      if (record.participantId !== participantId) {
        throw new Error(
          "Provider continuity operation has a different immutable participant",
        );
      }
      moved.push({
        originalPath: join(this.#rootDirectory, entry.name),
        quarantinePath,
      });
    }
    const rollback = async (): Promise<void> => {
      for (const record of [...moved].reverse()) {
        if (!(await pathExists(record.quarantinePath))) continue;
        if (!(await pathExists(record.originalPath))) {
          await link(record.quarantinePath, record.originalPath);
          await syncDirectory(this.#rootDirectory);
        }
        await rm(record.quarantinePath);
        await syncDirectory(operationDirectory);
      }
      moved.length = 0;
    };
    try {
      for (const candidate of candidates) {
        const quarantinePath = join(operationDirectory, candidate.name);
        const existing = moved.find(
          (record) => record.quarantinePath === quarantinePath,
        );
        if (existing !== undefined) {
          const [originalBytes, quarantineBytes] = await Promise.all([
            readFile(candidate.path),
            readFile(quarantinePath),
          ]);
          if (!originalBytes.equals(quarantineBytes)) {
            throw new Error(
              "Provider continuity replay found a conflicting session record",
            );
          }
          await rm(candidate.path);
          await syncDirectory(this.#rootDirectory);
          continue;
        }
        await link(candidate.path, quarantinePath);
        await syncDirectory(operationDirectory);
        moved.push({
          originalPath: candidate.path,
          quarantinePath,
        });
        await rm(candidate.path);
        await syncDirectory(this.#rootDirectory);
      }
    } catch (error) {
      try {
        await rollback();
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Provider session quarantine failed and rollback failed",
        );
      }
      throw error;
    }

    let active = true;
    return Object.freeze({
      operationId,
      participantId,
      recordCount: moved.length,
      rollback: async () => {
        if (!active) return;
        await rollback();
        active = false;
      },
    });
  }

  async #ensurePrivateRoot(): Promise<void> {
    await mkdir(this.#rootDirectory, { mode: 0o700, recursive: true });
    const metadata = await lstat(this.#rootDirectory);
    const currentUid = process.getuid?.();
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (currentUid !== undefined && metadata.uid !== currentUid) ||
      (metadata.mode & 0o077) !== 0
    ) {
      throw new Error(
        `Provider session root is not private and owner-controlled: ${this.#rootDirectory}`,
      );
    }
  }

  #recordName(key: ProviderSessionKey): string {
    return `${createHash("sha256").update(JSON.stringify(key)).digest("hex")}.json`;
  }

  #recordPath(key: ProviderSessionKey): string {
    return join(this.#rootDirectory, this.#recordName(key));
  }
}

async function ensureQuarantineManifest(
  operationDirectory: string,
  operationId: string,
  participantId: string,
): Promise<void> {
  const path = join(operationDirectory, QUARANTINE_MANIFEST_NAME);
  const expected = Object.freeze({
    operationId,
    participantId,
    schemaVersion: 1,
  });
  try {
    const metadata = await lstat(path);
    assertPrivateFile(metadata, path);
    if (metadata.size > MAX_RECORD_BYTES) {
      throw new Error("Provider continuity operation manifest is too large");
    }
    const value = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    if (
      value.schemaVersion !== 1 ||
      value.operationId !== expected.operationId ||
      value.participantId !== expected.participantId ||
      Object.keys(value).sort().join("\0") !==
        ["operationId", "participantId", "schemaVersion"].join("\0")
    ) {
      throw new Error(
        "Provider continuity operation has a different immutable participant",
      );
    }
    return;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(expected)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
    await syncDirectory(operationDirectory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function ensurePrivateDirectory(
  path: string,
  label: string,
): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  await assertPrivateDirectory(path, label);
}

async function assertPrivateDirectory(
  path: string,
  label: string,
): Promise<void> {
  const metadata = await lstat(path);
  const currentUid = process.getuid?.();
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (currentUid !== undefined && metadata.uid !== currentUid) ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new Error(`${label} is not private and owner-controlled: ${path}`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function validateKey(key: ProviderSessionKey): ProviderSessionKey {
  return Object.freeze({
    participantId: requiredText(
      key.participantId,
      "participantId",
      MAX_IDENTIFIER_LENGTH,
    ),
    provider: requiredText(key.provider, "provider", MAX_IDENTIFIER_LENGTH),
    runtimeProfileRevisionId: requiredText(
      key.runtimeProfileRevisionId,
      "runtimeProfileRevisionId",
      MAX_IDENTIFIER_LENGTH,
    ),
    ...(key.standingPromptDigest === undefined
      ? {}
      : {
          standingPromptDigest: requiredText(
            key.standingPromptDigest,
            "standingPromptDigest",
            MAX_IDENTIFIER_LENGTH,
          ),
        }),
    workspaceMountRevisionId: requiredText(
      key.workspaceMountRevisionId,
      "workspaceMountRevisionId",
      MAX_IDENTIFIER_LENGTH,
    ),
  });
}

function validateRecord(value: unknown): ProviderSessionRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Provider session record must be an object");
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    "participantId",
    "provider",
    "providerSessionId",
    "recordedAt",
    "runtimeProfileRevisionId",
    "schemaVersion",
    "workspaceMountRevisionId",
    ...(record.systemMemorySha256 === undefined ? [] : ["systemMemorySha256"]),
    ...(record.standingPromptDigest === undefined
      ? []
      : ["standingPromptDigest"]),
  ];
  if (
    Object.keys(record).sort().join("\0") !== expectedKeys.sort().join("\0") ||
    record.schemaVersion !== 1
  ) {
    throw new Error("Provider session record schema is unsupported");
  }
  const key = validateKey({
    participantId: record.participantId as string,
    provider: record.provider as string,
    runtimeProfileRevisionId: record.runtimeProfileRevisionId as string,
    ...(record.standingPromptDigest === undefined
      ? {}
      : { standingPromptDigest: record.standingPromptDigest as string }),
    workspaceMountRevisionId: record.workspaceMountRevisionId as string,
  });
  const recordedAt = requiredText(record.recordedAt, "recordedAt", 64);
  if (!Number.isFinite(Date.parse(recordedAt))) {
    throw new Error("Provider session recordedAt is invalid");
  }
  return Object.freeze({
    ...key,
    ...systemMemoryMetadata(record.systemMemorySha256),
    providerSessionId: requiredText(
      record.providerSessionId,
      "providerSessionId",
      MAX_SESSION_ID_LENGTH,
    ),
    recordedAt,
    schemaVersion: 1,
  });
}

function requiredText(value: unknown, name: string, limit: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  if (value.length > limit || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${name} is invalid or exceeds its safe limit`);
  }
  return value;
}

function sameKey(
  record: ProviderSessionRecord,
  key: ProviderSessionKey,
): boolean {
  return (
    record.participantId === key.participantId &&
    record.provider === key.provider &&
    record.runtimeProfileRevisionId === key.runtimeProfileRevisionId &&
    record.standingPromptDigest === key.standingPromptDigest &&
    record.workspaceMountRevisionId === key.workspaceMountRevisionId
  );
}

function assertPrivateFile(
  metadata: Awaited<ReturnType<typeof lstat>>,
  path: string,
): void {
  const currentUid = process.getuid?.();
  const mode = Number(metadata.mode);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (currentUid !== undefined && metadata.uid !== currentUid) ||
    (mode & 0o077) !== 0
  ) {
    throw new Error(`Provider session record is not a private file: ${path}`);
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function systemMemoryMetadata(value: unknown): { systemMemorySha256?: string } {
  if (value === undefined) return {};
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error("Invalid Provider system memory digest");
  return { systemMemorySha256: value };
}

function instanceKey(
  key: ProviderSessionKey,
  generation = 0,
): ProviderSessionKey {
  // Generation 0 keeps the historical key so existing bindings still resume.
  const scope =
    generation === 0
      ? "instance-session/v1"
      : `instance-session/v1:generation:${String(generation)}`;
  return {
    participantId: key.participantId,
    provider: key.provider,
    runtimeProfileRevisionId: scope,
    workspaceMountRevisionId: scope,
  };
}

function instanceGenerationOf(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Instance session generation is invalid");
  return value;
}
