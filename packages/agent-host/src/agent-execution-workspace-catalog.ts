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

type Options = Readonly<{
  rootDirectory: string;
  /**
   * Owner 2026-09-26: parent of the platform-created Channel homes
   * (`<root>/<roomId>`). Created lazily on the first channel-home binding.
   */
  channelHomeRoot?: string;
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
type ChannelHomeOwnership = { schemaVersion: 1; roomId: string; cwd: string };

/** Host-local mount provenance, not a second placement or authorization owner.
 * Caller supplies only authenticated Host binding projections. Immutable
 * receipts retain the exact mount accepted by older Attempts after refresh.
 */
export class AgentExecutionWorkspaceCatalog {
  readonly #options: Options;
  readonly #receipts = new Map<string, Receipt>();
  readonly #authorized = new Map<string, HostExecutionWorkspaceBinding>();
  readonly #privateIntent = new Set<string>();
  readonly #channelHomes = new Map<string, string>();
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
    for (const b of parsed) {
      if (this.#resetting.has(b.participantId)) continue;
      try {
        const mount = await this.#serial(b.participantId, async () => {
          if (this.#resetting.has(b.participantId)) return undefined;
          if (b.executionWorkspace?.kind === "channel_home") {
            const cwd = await this.#prepareChannelHome(
              b.executionWorkspace.roomId,
            );
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
            message: (error instanceof Error
              ? error.message
              : String(error)
            ).slice(0, 1000),
          });
      }
    }
    return mounts;
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
      const cwd = this.#channelHomes.get(binding.executionWorkspace.roomId);
      if (cwd === undefined) return undefined;
      assertSafeDirectory(cwd, true);
      return cwd;
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
   * Owner 2026-09-26: `<channelHomeRoot>/<roomId>`, created by Loom exactly
   * once. An ownership receipt written before creation proves Loom made it;
   * an existing directory without one is never adopted. The recorded path
   * stays authoritative even if the configured root later changes, because
   * Claude/Kimi locate sessions by cwd.
   */
  async #prepareChannelHome(roomId: string): Promise<string> {
    return await this.#serial(`channel-home:${roomId}`, async () => {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(roomId))
        throw new Error("Channel home room id is not a safe path segment");
      const ownershipRoot = join(this.#options.rootDirectory, ".channel-homes");
      await ensureDirectory(ownershipRoot);
      const ownershipPath = join(ownershipRoot, `${hash(roomId)}.json`);
      let ownership = await readChannelHomeOwnership(ownershipPath, roomId);
      if (ownership === undefined) {
        const root = this.#options.channelHomeRoot;
        if (root === undefined)
          throw new Error("Execution catalog has no channel home root");
        await ensureSharedDirectory(root);
        const cwd = join(root, roomId);
        if (await pathExists(cwd))
          throw new Error(
            `Channel home ${cwd} already exists and was not created by Loom; refusing to reuse it`,
          );
        ownership = { schemaVersion: 1, roomId, cwd };
        await writePrivateFileOnce(ownershipPath, JSON.stringify(ownership));
      }
      if (!(await pathExists(ownership.cwd))) {
        await ensureSharedDirectory(dirname(ownership.cwd));
        await mkdir(ownership.cwd, { mode: 0o700 });
      }
      assertSafeDirectory(ownership.cwd, true);
      this.#channelHomes.set(roomId, ownership.cwd);
      return ownership.cwd;
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}
/** A user-visible parent (e.g. ~/.loom/channel-workspaces): no symlinks. */
async function ensureSharedDirectory(path: string): Promise<void> {
  const parent = dirname(path);
  if (parent !== path && !(await pathExists(parent)))
    await ensureSharedDirectory(parent);
  assertSafeDirectory(path);
  await mkdir(path, { recursive: true, mode: 0o700 });
  assertSafeDirectory(path, true);
}
async function readChannelHomeOwnership(
  path: string,
  roomId: string,
): Promise<ChannelHomeOwnership | undefined> {
  if (!(await pathExists(path))) return undefined;
  assertSafeFile(path);
  const raw = JSON.parse(await readFile(path, "utf8")) as ChannelHomeOwnership;
  if (
    raw.schemaVersion !== 1 ||
    raw.roomId !== roomId ||
    typeof raw.cwd !== "string" ||
    !isAbsolute(raw.cwd) ||
    join(dirname(raw.cwd), roomId) !== raw.cwd
  )
    throw new Error("Invalid channel home ownership receipt");
  return raw;
}
async function writePrivateFileOnce(path: string, text: string): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
