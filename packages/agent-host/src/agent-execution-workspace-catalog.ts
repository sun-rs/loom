import { createHash, randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  HostExecutionWorkspaceBindingSchema,
  WorkspaceMountDescriptorSchema,
  type HostExecutionWorkspaceBinding,
  type WorkspaceMountDescriptor,
} from "@rah-os/protocol";
import {
  agentExecutionWorkspacePath,
  assertAgentExecutionWorkspaceAvailable,
  pendingAgentExecutionWorkspaceQuarantines,
  finalizeAgentExecutionWorkspaceQuarantine,
  prepareAgentExecutionWorkspace,
  quarantineAgentExecutionWorkspace,
} from "./agent-execution-workspace.ts";
import {
  ChannelDirectoryError,
  checkAttachedDirectory,
  checkChannelHomeDirectory,
  type ChannelDirectoryIdentity,
  type ReservedDirectory,
} from "./channel-directory-check.ts";
import {
  channelHomeRecordsRoot,
  createChannelHome,
  readChannelAttachedIdentity,
  readChannelHomeCreated,
  recordChannelAttachedIdentity,
  type ChannelHomeCreated,
} from "./channel-home-records.ts";

type Options = Readonly<{
  rootDirectory: string;
  /**
   * Owner 2026-09-26: parent of the platform-created Channel homes
   * (`<root>/<roomId>`). Created lazily on the first channel-home binding.
   */
  channelHomeRoot?: string;
  /**
   * Loom data and the channel home root: an attached directory must never
   * overlap them (the same rule as at Channel creation).
   */
  reservedDirectories?: readonly ReservedDirectory[];
  legacyCwd: string;
  legacyMount: WorkspaceMountDescriptor;
  isResetCommitted?: (owner: string, operationId: string) => Promise<boolean>;
}>;
type Placement = Pick<
  WorkspaceMountDescriptor,
  "workspaceDefinitionId" | "workspaceMountRevisionId" | "workspaceMountDigest"
> & { participantId: string };
type PrivateReceipt = {
  schemaVersion: 1;
  cwd: string;
  mount: WorkspaceMountDescriptor & { participantId: string };
};
type ChannelHomeReceipt = {
  schemaVersion: 2;
  kind: "channel_home";
  cwd: string;
  roomId: string;
  additionalDirectories: string[];
  mount: WorkspaceMountDescriptor & { participantId: string };
};
type Receipt = PrivateReceipt | ChannelHomeReceipt;
export type ChannelHomeState = Readonly<{
  roomId: string;
  state: "ready" | "failed";
  reason?: string;
}>;

/** Host-local mount provenance, not a second placement or authorization owner.
 * Caller supplies only authenticated Host binding projections. Immutable
 * receipts retain the exact mount accepted by older Attempts after refresh.
 */
export class AgentExecutionWorkspaceCatalog {
  readonly #options: Options;
  readonly #receipts = new Map<string, Receipt>();
  readonly #authorized = new Map<string, HostExecutionWorkspaceBinding>();
  readonly #privateIntent = new Set<string>();
  readonly #channelHomes = new Map<string, ChannelHomeCreated>();
  readonly #attachedIdentities = new Map<string, ChannelDirectoryIdentity>();
  #channelHomeStates = new Map<string, ChannelHomeState>();
  readonly #resetting = new Set<string>();
  readonly #resetOperations = new Map<string, string>();
  readonly #failedResets = new Map<string, string>();
  readonly #operations = new Map<string, Promise<unknown>>();
  #failures: Readonly<{ participantId: string; message: string }>[] = [];
  get failures(): readonly Readonly<{
    participantId: string;
    message: string;
  }>[] {
    return [...this.#failures];
  }
  private constructor(options: Options) {
    this.#options = options;
  }
  static async open(options: Options): Promise<AgentExecutionWorkspaceCatalog> {
    if (
      !isAbsolute(options.rootDirectory) ||
      !isAbsolute(options.legacyCwd) ||
      (options.channelHomeRoot !== undefined &&
        !isAbsolute(options.channelHomeRoot))
    )
      throw new Error("Execution catalog roots must be absolute");
    const catalog = new AgentExecutionWorkspaceCatalog({
      ...options,
      rootDirectory: resolve(options.rootDirectory),
      ...(options.channelHomeRoot === undefined
        ? {}
        : { channelHomeRoot: resolve(options.channelHomeRoot) }),
      legacyMount: WorkspaceMountDescriptorSchema.parse(options.legacyMount),
    });
    await ensureDirectory(catalog.#options.rootDirectory);
    await ensureDirectory(catalog.#receiptRoot());
    for (const file of await readdir(catalog.#receiptRoot())) {
      if (/^[a-f0-9]{64}\.json\.[a-f0-9-]+\.tmp$/u.test(file)) continue;
      if (!/^[a-f0-9]{64}\.json$/u.test(file))
        throw new Error("Unexpected execution receipt entry");
      const path = join(catalog.#receiptRoot(), file);
      assertSafeFile(path);
      const receipt = catalog.#parseReceipt(
        JSON.parse(await readFile(path, "utf8")) as unknown,
      );
      if (file !== `${hash(receipt.mount.workspaceMountRevisionId)}.json`)
        throw new Error("Execution receipt filename mismatch");
      assertSafeDirectory(receipt.cwd);
      catalog.#receipts.set(receipt.mount.workspaceMountRevisionId, receipt);
      catalog.#privateIntent.add(receipt.mount.participantId);
    }
    for (const pending of pendingAgentExecutionWorkspaceQuarantines(
      catalog.#options.rootDirectory,
    )) {
      catalog.#resetting.add(pending.participantId);
      catalog.#resetOperations.set(pending.participantId, pending.operationId);
      catalog.#failedResets.set(pending.participantId, pending.operationId);
      catalog.#privateIntent.add(pending.participantId);
      if (
        await catalog.#options.isResetCommitted?.(
          pending.participantId,
          pending.operationId,
        )
      ) {
        await catalog.finalizeCommitted(
          pending.participantId,
          pending.operationId,
        );
      }
    }
    return catalog;
  }
  async refresh(
    bindings: readonly HostExecutionWorkspaceBinding[],
  ): Promise<WorkspaceMountDescriptor[]> {
    const parsed = bindings.map((binding) =>
      HostExecutionWorkspaceBindingSchema.parse(binding),
    );
    if (new Set(parsed.map((b) => b.participantId)).size !== parsed.length)
      throw new Error("Duplicate execution binding owner");
    // Revoke removed or changed authority before awaiting filesystem work.
    // Unchanged, already prepared roots remain available during polling.
    const incoming = new Map(
      parsed.map((binding) => [binding.participantId, binding]),
    );
    for (const [owner, previous] of this.#authorized) {
      const next = incoming.get(owner);
      if (next === undefined || !sameBinding(previous, next)) {
        this.#authorized.delete(owner);
      }
    }
    for (const b of parsed)
      if (
        b.executionWorkspace?.kind === "agent_private" ||
        b.executionWorkspace?.kind === "channel_home"
      )
        this.#privateIntent.add(b.participantId);
    const mounts: WorkspaceMountDescriptor[] = [this.#options.legacyMount];
    this.#failures = [];
    const states = new Map<string, ChannelHomeState>();
    for (const b of parsed) {
      if (this.#resetting.has(b.participantId)) continue;
      try {
        const mount = await this.#serial(b.participantId, async () => {
          if (this.#resetting.has(b.participantId)) return undefined;
          if (b.executionWorkspace?.kind === "channel_home") {
            const roomId = b.executionWorkspace.roomId;
            let cwd: string;
            try {
              cwd = await this.#prepareChannelHome(
                roomId,
                b.primaryDirectory,
                b.additionalDirectories ?? [],
              );
            } catch (error) {
              states.set(roomId, {
                roomId,
                state: "failed",
                reason: errorMessage(error),
              });
              throw error;
            }
            if (!states.has(roomId))
              states.set(roomId, { roomId, state: "ready" });
            const receipt = makeChannelHomeReceipt(
              cwd,
              b.participantId,
              b.workspaceDefinitionId,
              b.executionWorkspace.roomId,
              [...(b.additionalDirectories ?? [])],
            );
            await this.#persist(receipt);
            return receipt.mount;
          }
          if (b.executionWorkspace?.kind === "agent_private") {
            const { cwd } = await prepareAgentExecutionWorkspace({
              rootDirectory: this.#options.rootDirectory,
              participantId: b.participantId,
            });
            const receipt = makeReceipt(
              cwd,
              b.participantId,
              b.workspaceDefinitionId,
            );
            await this.#persist(receipt);
            return receipt.mount;
          }
          if (
            b.workspaceDefinitionId !==
              this.#options.legacyMount.workspaceDefinitionId ||
            (b.executionWorkspace?.kind === "existing_mount" &&
              b.executionWorkspace.workspaceMountRevisionId !==
                this.#options.legacyMount.workspaceMountRevisionId)
          )
            throw new Error("Unsupported existing execution mount binding");
          return this.#options.legacyMount;
        });
        if (this.#resetting.has(b.participantId) || mount === undefined)
          continue;
        if (mount !== this.#options.legacyMount) mounts.push(mount);
        this.#authorized.set(b.participantId, b);
      } catch (error) {
        this.#authorized.delete(b.participantId);
        if (this.#failures.length < 100)
          this.#failures.push({
            participantId: b.participantId,
            message: errorMessage(error),
          });
      }
    }
    this.#channelHomeStates = states;
    return mounts;
  }
  /** Readiness of each Channel home seen in the last refresh (Host report). */
  channelHomeStates(): ChannelHomeState[] {
    return [...this.#channelHomeStates.values()];
  }
  /** Recovery only: caller must validate exact original Attempt/Placement provenance. */
  resolveFrozen(placement: Placement): string {
    if (sameMount(this.#options.legacyMount, placement))
      return this.#options.legacyCwd;
    return this.resolve(placement);
  }
  resolve(placement: Placement): string {
    return this.resolveWorkspace(placement).cwd;
  }
  /** The frozen cwd plus the channel home's Human-attached directories. */
  resolveWorkspace(placement: Placement): Readonly<{
    cwd: string;
    additionalDirectories: readonly string[];
  }> {
    const receipt = this.#receipts.get(placement.workspaceMountRevisionId);
    if (receipt) {
      if (
        receipt.mount.participantId !== placement.participantId ||
        !sameMount(receipt.mount, placement)
      )
        throw new Error(
          "Execution mount receipt does not match frozen placement",
        );
      // A channel home is shared by the Channel and untouched by an
      // instance reset; only a private cwd has a reset fence.
      if (receipt.schemaVersion === 1)
        assertAgentExecutionWorkspaceAvailable(
          this.#options.rootDirectory,
          placement.participantId,
        );
      else this.#verifyChannelWorkspace(receipt);
      assertSafeDirectory(receipt.cwd, true);
      return Object.freeze({
        cwd: receipt.cwd,
        additionalDirectories: Object.freeze(
          receipt.schemaVersion === 2 ? [...receipt.additionalDirectories] : [],
        ),
      });
    }
    const binding = this.#authorized.get(placement.participantId);
    const privateIntent =
      binding?.executionWorkspace?.kind === "agent_private" ||
      binding?.executionWorkspace?.kind === "channel_home" ||
      (binding === undefined &&
        this.#privateIntent.has(placement.participantId));
    if (privateIntent || !sameMount(this.#options.legacyMount, placement))
      throw new Error("Unknown execution mount or private binding");
    return Object.freeze({
      cwd: this.#options.legacyCwd,
      additionalDirectories: Object.freeze([]),
    });
  }
  async projectDirectory(owner: string): Promise<string | undefined> {
    if (this.#resetting.has(owner)) return undefined;
    const binding = this.#authorized.get(owner);
    if (!binding) return undefined;
    if (binding.executionWorkspace?.kind === "channel_home") {
      const created = this.#channelHomeCreated(
        binding.executionWorkspace.roomId,
      );
      if (created === undefined) return undefined;
      checkChannelHomeDirectory(created.cwd, created.identity);
      return created.cwd;
    }
    if (binding.executionWorkspace?.kind !== "agent_private")
      return this.#options.legacyCwd;
    const expected = makeReceipt(
      agentExecutionWorkspacePath(this.#options.rootDirectory, owner),
      owner,
      binding.workspaceDefinitionId,
    );
    return this.resolve({ ...expected.mount, participantId: owner });
  }
  /** The home of a channel-home instance only (file browsing root). */
  async channelHomeDirectory(owner: string): Promise<string | undefined> {
    return this.#authorized.get(owner)?.executionWorkspace?.kind ===
      "channel_home"
      ? await this.projectDirectory(owner)
      : undefined;
  }
  /** The authorized channel home's Human-attached directories, in order. */
  async attachedDirectories(owner: string): Promise<readonly string[]> {
    const binding = this.#authorized.get(owner);
    return binding?.executionWorkspace?.kind === "channel_home"
      ? [...(binding.additionalDirectories ?? [])]
      : [];
  }
  /**
   * Verify the attached directory `path` of `owner`'s channel home against
   * the shared Host rules and its recorded identity (file browsing root).
   */
  verifyAttachedDirectory(owner: string, path: string): void {
    const binding = this.#authorized.get(owner);
    if (
      binding?.executionWorkspace?.kind !== "channel_home" ||
      !(binding.additionalDirectories ?? []).includes(path)
    )
      throw new Error("No such attached directory for this Agent");
    this.#checkAttached(binding.executionWorkspace.roomId, path);
  }
  /** Launch-time check of a frozen channel-home receipt (P1-1, P2-1). */
  #verifyChannelWorkspace(receipt: ChannelHomeReceipt): void {
    const created = this.#channelHomeCreated(receipt.roomId);
    if (created === undefined)
      throw new ChannelDirectoryError(
        "channel_home_unowned",
        `${receipt.cwd} has no Loom creation record`,
      );
    if (created.cwd !== receipt.cwd)
      throw new ChannelDirectoryError(
        "channel_home_path_mismatch",
        `${receipt.cwd} is not the recorded channel home ${created.cwd}`,
      );
    checkChannelHomeDirectory(created.cwd, created.identity);
    for (const path of receipt.additionalDirectories)
      this.#checkAttached(receipt.roomId, path);
  }
  #checkAttached(roomId: string, path: string): void {
    const identity = this.#attachedIdentity(roomId, path);
    if (identity === undefined)
      throw new ChannelDirectoryError(
        "attached_directory_unrecorded",
        `${path} has no recorded identity for this Channel`,
      );
    checkAttachedDirectory(
      path,
      this.#options.reservedDirectories ?? [],
      identity,
    );
  }
  #channelHomesRoot(): string {
    return channelHomeRecordsRoot(this.#options.rootDirectory);
  }
  #channelHomeCreated(roomId: string): ChannelHomeCreated | undefined {
    const cached = this.#channelHomes.get(roomId);
    if (cached !== undefined) return cached;
    const created = readChannelHomeCreated(this.#options.rootDirectory, roomId);
    if (created !== undefined) this.#channelHomes.set(roomId, created);
    return created;
  }
  #attachedIdentity(
    roomId: string,
    path: string,
  ): ChannelDirectoryIdentity | undefined {
    const key = `${roomId}\u0000${path}`;
    const cached = this.#attachedIdentities.get(key);
    if (cached !== undefined) return cached;
    const identity = readChannelAttachedIdentity(
      this.#options.rootDirectory,
      roomId,
      path,
    );
    if (identity !== undefined) this.#attachedIdentities.set(key, identity);
    return identity;
  }
  /**
   * The identity recorded at Channel creation (the Host preparer) is
   * compared. Only a Channel whose Host did not prepare it at creation (a
   * Core without a preparer, a Channel created before) records it at this
   * first check.
   */
  #recordAttached(roomId: string, path: string): void {
    if (this.#attachedIdentity(roomId, path) !== undefined) {
      this.#checkAttached(roomId, path);
      return;
    }
    const reserved = this.#options.reservedDirectories ?? [];
    recordChannelAttachedIdentity(
      this.#options.rootDirectory,
      roomId,
      path,
      checkAttachedDirectory(path, reserved),
      reserved,
    );
    this.#checkAttached(roomId, path);
  }
  /**
   * Owner 2026-09-26: `<root>/<roomId>`, created by Loom exactly once. The
   * path is the one recorded at Channel creation (`primaryDirectory`), else
   * `<channelHomeRoot>/<roomId>` for Channels created before it was recorded.
   * Review P2-1: the intent record precedes creation, the completion record
   * (with dev/ino) follows Loom's own exclusive mkdir. An existing directory
   * with only an intent is never adopted; a created home that is missing or
   * replaced blocks, and is never recreated empty.
   */
  async #prepareChannelHome(
    roomId: string,
    primaryDirectory: string | undefined,
    attached: readonly string[],
  ): Promise<string> {
    return await this.#serial(`channel-home:${roomId}`, async () => {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(roomId))
        throw new Error("Channel home room id is not a safe path segment");
      await ensureDirectory(this.#channelHomesRoot());
      for (const path of attached) this.#recordAttached(roomId, path);
      const expectPath = (cwd: string) => {
        if (primaryDirectory !== undefined && primaryDirectory !== cwd)
          throw new ChannelDirectoryError(
            "channel_home_path_mismatch",
            `recorded channel home ${cwd} differs from ${primaryDirectory}`,
          );
      };
      const created = this.#channelHomeCreated(roomId);
      if (created !== undefined) {
        expectPath(created.cwd);
        checkChannelHomeDirectory(created.cwd, created.identity);
        return created.cwd;
      }
      // Not created at Channel creation (a Core without a Host preparer, or
      // a Channel created before option A): the shared owner creates it now.
      const root = this.#options.channelHomeRoot;
      const { record } = createChannelHome({
        rootDirectory: this.#options.rootDirectory,
        roomId,
        primaryDirectory,
        defaultCwd: root === undefined ? undefined : join(root, roomId),
      });
      this.#channelHomes.set(roomId, record);
      return record.cwd;
    });
  }
  async quarantinePrivate(
    owner: string,
    operationId: string,
  ): Promise<
    Awaited<ReturnType<typeof quarantineAgentExecutionWorkspace>> | undefined
  > {
    const sameFailedOperation =
      this.#resetting.has(owner) &&
      this.#failedResets.get(owner) === operationId;
    const binding = this.#authorized.get(owner);
    if (!sameFailedOperation) {
      if (binding === undefined)
        throw new Error("Agent execution reset has no authorized binding");
      if (binding.executionWorkspace?.kind !== "agent_private")
        return undefined;
    }
    if (
      this.#resetting.has(owner) &&
      this.#failedResets.get(owner) !== operationId
    )
      throw new Error("Agent execution reset already in progress");
    this.#failedResets.delete(owner);
    this.#resetting.add(owner);
    this.#resetOperations.set(owner, operationId);
    try {
      const quarantine = await this.#serial(owner, () =>
        quarantineAgentExecutionWorkspace({
          rootDirectory: this.#options.rootDirectory,
          participantId: owner,
          operationId,
        }),
      );
      return Object.freeze({
        commit: () => {
          quarantine.commit();
          this.#resetting.delete(owner);
          this.#resetOperations.delete(owner);
        },
        rollback: async () => {
          await quarantine.rollback();
          this.#resetting.delete(owner);
          this.#resetOperations.delete(owner);
        },
      });
    } catch (error) {
      // An uncertain rename must not permit refresh to recreate the directory.
      // Keep the fence; only the same operation may retry its quarantine.
      this.#failedResets.set(owner, operationId);
      throw error;
    }
  }
  async #serial<T>(owner: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#operations.get(owner) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(operation);
    this.#operations.set(owner, pending);
    try {
      return await pending;
    } finally {
      if (this.#operations.get(owner) === pending)
        this.#operations.delete(owner);
    }
  }
  async finalizeCommitted(owner: string, operationId: string): Promise<void> {
    if (!(await this.#options.isResetCommitted?.(owner, operationId)))
      throw new Error("Execution reset has no authoritative committed receipt");
    finalizeAgentExecutionWorkspaceQuarantine(
      this.#options.rootDirectory,
      owner,
      operationId,
      { ignoreNonMatching: true },
    );
    if (this.#resetOperations.get(owner) === operationId) {
      this.#resetOperations.delete(owner);
      this.#failedResets.delete(owner);
      this.#resetting.delete(owner);
    }
  }
  #receiptRoot(): string {
    return join(this.#options.rootDirectory, ".mount-receipts");
  }
  #parseReceipt(value: unknown): Receipt {
    if (typeof value !== "object" || value === null)
      throw new Error("Invalid execution receipt");
    const raw = value as Record<string, unknown>;
    const mount = WorkspaceMountDescriptorSchema.parse(raw.mount);
    if (raw.schemaVersion === 2) {
      if (
        raw.kind !== "channel_home" ||
        typeof raw.cwd !== "string" ||
        typeof raw.roomId !== "string" ||
        !Array.isArray(raw.additionalDirectories) ||
        !raw.additionalDirectories.every((d) => typeof d === "string") ||
        mount.participantId === undefined ||
        !isAbsolute(raw.cwd) ||
        join(dirname(raw.cwd), raw.roomId) !== raw.cwd
      )
        throw new Error("Invalid execution receipt");
      const expected = makeChannelHomeReceipt(
        raw.cwd,
        mount.participantId,
        mount.workspaceDefinitionId,
        raw.roomId,
        raw.additionalDirectories as string[],
      );
      if (JSON.stringify(mount) !== JSON.stringify(expected.mount))
        throw new Error("Execution receipt provenance mismatch");
      return expected;
    }
    if (
      raw.schemaVersion !== 1 ||
      typeof raw.cwd !== "string" ||
      mount.participantId === undefined
    )
      throw new Error("Invalid execution receipt");
    const expected = makeReceipt(
      agentExecutionWorkspacePath(
        this.#options.rootDirectory,
        mount.participantId,
      ),
      mount.participantId,
      mount.workspaceDefinitionId,
    );
    if (
      raw.cwd !== expected.cwd ||
      JSON.stringify(mount) !== JSON.stringify(expected.mount)
    )
      throw new Error("Execution receipt provenance mismatch");
    return expected;
  }
  async #persist(receipt: Receipt): Promise<void> {
    // Cache entries are installed only after durable publication or validated
    // startup loading. Immutable receipt identity cannot change on heartbeat;
    // prepare still checks the live execution directory before this call.
    const cached = this.#receipts.get(receipt.mount.workspaceMountRevisionId);
    if (cached !== undefined) {
      if (JSON.stringify(cached) !== JSON.stringify(receipt)) {
        throw new Error("Immutable execution receipt conflict");
      }
      return;
    }
    const path = join(
      this.#receiptRoot(),
      `${hash(receipt.mount.workspaceMountRevisionId)}.json`,
    );
    assertSafeDirectory(this.#receiptRoot(), true);
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(receipt));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await link(temporaryPath, path);
      const directory = await open(this.#receiptRoot(), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ))
        throw error;
      assertSafeFile(path);
      const old = this.#parseReceipt(
        JSON.parse(await readFile(path, "utf8")) as unknown,
      );
      if (JSON.stringify(old) !== JSON.stringify(receipt))
        throw new Error("Immutable execution receipt conflict");
    } finally {
      await rm(temporaryPath, { force: true });
    }
    this.#receipts.set(receipt.mount.workspaceMountRevisionId, receipt);
  }
}
function makeChannelHomeReceipt(
  cwd: string,
  participantId: string,
  workspaceDefinitionId: string,
  roomId: string,
  additionalDirectories: string[],
): ChannelHomeReceipt {
  // Per participant: one lane per mount, while the cwd is the shared home.
  // The attached set is part of the identity, so a change is a new mount.
  const digest = hash(
    JSON.stringify({
      schemaVersion: 2,
      kind: "channel_home",
      cwd,
      participantId,
      workspaceDefinitionId,
      roomId,
      additionalDirectories,
    }),
  );
  return {
    schemaVersion: 2,
    kind: "channel_home",
    cwd,
    roomId,
    additionalDirectories,
    mount: {
      participantId,
      workspaceDefinitionId,
      workspaceMountRevisionId: `channel-home-${digest}`,
      workspaceMountDigest: `sha256:${digest}`,
      modes: ["in_place"],
    },
  };
}
function makeReceipt(
  cwd: string,
  participantId: string,
  workspaceDefinitionId: string,
): PrivateReceipt {
  const digest = hash(
    JSON.stringify({
      schemaVersion: 1,
      cwd,
      participantId,
      workspaceDefinitionId,
    }),
  );
  return {
    schemaVersion: 1,
    cwd,
    mount: {
      participantId,
      workspaceDefinitionId,
      workspaceMountRevisionId: `agent-private-${digest}`,
      workspaceMountDigest: `sha256:${digest}`,
      modes: ["in_place"],
    },
  };
}
function sameMount(a: WorkspaceMountDescriptor, b: Placement): boolean {
  return (
    a.workspaceDefinitionId === b.workspaceDefinitionId &&
    a.workspaceMountRevisionId === b.workspaceMountRevisionId &&
    a.workspaceMountDigest === b.workspaceMountDigest
  );
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function assertSafeDirectory(path: string, required = false): void {
  const parent = dirname(path);
  if (parent !== path) assertSafeDirectory(parent, true);
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
      throw new Error(`Execution catalog symlink: ${path}`);
    if (!stat.isDirectory())
      throw new Error("Execution catalog path is not a directory");
  } catch (error) {
    if (
      !required &&
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return;
    throw error;
  }
}
async function ensureDirectory(path: string): Promise<void> {
  // Existing ancestors must never be followed through symlinks.
  const parent = dirname(path);
  try {
    assertSafeDirectory(parent, true);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      await ensureDirectory(parent);
    else throw error;
  }
  assertSafeDirectory(path);
  await mkdir(path, { recursive: true, mode: 0o700 });
  assertPrivate(path);
}
function assertPrivate(path: string): void {
  const stat = lstatSync(path);
  if (
    (process.getuid !== undefined && stat.uid !== process.getuid()) ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error("Execution catalog storage is not private");
}
function assertSafeFile(path: string): void {
  assertSafeDirectory(dirname(path), true);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Unsafe execution receipt file");
  assertPrivate(path);
}

function sameBinding(
  a: HostExecutionWorkspaceBinding,
  b: HostExecutionWorkspaceBinding,
): boolean {
  return (
    JSON.stringify(a.additionalDirectories ?? []) ===
      JSON.stringify(b.additionalDirectories ?? []) &&
    (a.executionWorkspace?.kind !== "channel_home" ||
      (b.executionWorkspace?.kind === "channel_home" &&
        a.executionWorkspace.roomId === b.executionWorkspace.roomId)) &&
    a.participantId === b.participantId &&
    a.workspaceDefinitionId === b.workspaceDefinitionId &&
    a.executionWorkspace?.kind === b.executionWorkspace?.kind &&
    (a.executionWorkspace?.kind !== "existing_mount" ||
      (b.executionWorkspace?.kind === "existing_mount" &&
        a.executionWorkspace.workspaceMountRevisionId ===
          b.executionWorkspace.workspaceMountRevisionId))
  );
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    1000,
  );
}
