import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { slotArtifactPath, type Slot } from "@rah-os/k-carrier";

export type KCarrierSlotServiceLaunch = Readonly<{
  artifactPath: string;
  processId: number;
  slot: Slot;
}>;

export type NodeKCarrierSlotServiceLauncherOptions = Readonly<{
  argumentPrefix?: readonly string[];
  configurationPath: string;
  spawn?: (
    executablePath: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
  stateDir: string;
}>;

/**
 * Launches only the artifact selected by K's two-slot state. Secrets and
 * mutable service configuration cross as an already-open private descriptor,
 * never through argv or inherited environment.
 */
export class NodeKCarrierSlotServiceLauncher {
  readonly #argumentPrefix: readonly string[];
  readonly #configurationPath: string;
  readonly #spawn: NonNullable<NodeKCarrierSlotServiceLauncherOptions["spawn"]>;
  readonly #stateDir: string;

  constructor(options: NodeKCarrierSlotServiceLauncherOptions) {
    this.#stateDir = absolutePath(options.stateDir, "stateDir");
    this.#configurationPath = absolutePath(
      options.configurationPath,
      "configurationPath",
    );
    const argumentPrefix = options.argumentPrefix ?? [];
    if (
      argumentPrefix.length > 16 ||
      argumentPrefix.some(
        (value) =>
          typeof value !== "string" ||
          value.length === 0 ||
          value.length > 4_096 ||
          value.includes("\0"),
      )
    ) {
      throw new Error("slot service argumentPrefix is invalid");
    }
    this.#argumentPrefix = Object.freeze([...argumentPrefix]);
    this.#spawn = options.spawn ?? spawn;
  }

  async launch(slot: Slot): Promise<KCarrierSlotServiceLaunch> {
    if (slot !== "stable" && slot !== "experiment") {
      throw new Error("K service slot is invalid");
    }
    await requireOwnerPrivateDirectory(this.#stateDir);
    const artifactPath = slotArtifactPath(this.#stateDir, slot);
    await requireExecutableArtifact(artifactPath);
    let configuration: FileHandle | undefined;
    let child: ChildProcess | undefined;
    try {
      configuration = await open(
        this.#configurationPath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      requireOwnerPrivateRegularFile(await configuration.stat());
      child = this.#spawn(
        artifactPath,
        [...this.#argumentPrefix, "__computer-service", "--config-fd=3"],
        {
          detached: true,
          env: Object.create(null) as NodeJS.ProcessEnv,
          stdio: ["ignore", "ignore", "ignore", configuration.fd],
          windowsHide: true,
        },
      );
      await waitForSpawn(child);
      const processId = child.pid;
      if (!Number.isSafeInteger(processId) || (processId ?? 0) <= 0) {
        throw new Error("K slot service has no process id");
      }
      child.unref();
      return Object.freeze({ artifactPath, processId: processId!, slot });
    } catch (error) {
      child?.kill("SIGKILL");
      throw error;
    } finally {
      await configuration?.close();
    }
  }
}

async function requireExecutableArtifact(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o022) !== 0 ||
    (metadata.mode & 0o100) === 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      "K slot artifact must be owner-controlled, regular, and executable",
    );
  }
}

async function requireOwnerPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error("K slot stateDir must be owner-private");
  }
}

function requireOwnerPrivateRegularFile(metadata: {
  isFile(): boolean;
  mode: number;
  uid: number;
}): void {
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error("slot service configuration must be owner-private");
  }
}

async function waitForSpawn(child: ChildProcess): Promise<void> {
  if (child.pid !== undefined) return;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectPromise(new Error("K slot service spawn timed out"));
    }, 5_000);
    const onError = (error: Error) => {
      cleanup();
      rejectPromise(error);
    };
    const onSpawn = () => {
      cleanup();
      resolvePromise();
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("spawn", onSpawn);
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
  });
}

function absolutePath(value: string, name: string): string {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.includes("\0") ||
    value.length > 4_096
  ) {
    throw new Error(`${name} must be an absolute path`);
  }
  return resolve(value);
}
