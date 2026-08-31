import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { slotArtifactPath, type Slot } from "@rah-os/k-carrier";

import type {
  SupervisedComputerServiceExit,
  SupervisedComputerServiceProcess,
} from "./computer-service-supervisor.ts";

export type NodeKCarrierSupervisedServiceLauncherOptions = Readonly<{
  argumentPrefix?: readonly string[];
  configurationPath: string;
  spawn?: (
    executablePath: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
  stateDir: string;
  stopTimeoutMs?: number;
}>;

/**
 * Launches a K slot as a direct child of the launchd-owned carrier. FD 3 is
 * private configuration; FD 4 is a lifetime lease. The service must exit on
 * lease EOF, so a SIGKILLed carrier cannot leave an orphan racing the next
 * launchd generation.
 */
export class NodeKCarrierSupervisedServiceLauncher {
  readonly #argumentPrefix: readonly string[];
  readonly #configurationPath: string;
  readonly #spawn: NonNullable<
    NodeKCarrierSupervisedServiceLauncherOptions["spawn"]
  >;
  readonly #stateDir: string;
  readonly #stopTimeoutMs: number;

  constructor(options: NodeKCarrierSupervisedServiceLauncherOptions) {
    this.#stateDir = absolutePath(options.stateDir, "stateDir");
    this.#configurationPath = absolutePath(
      options.configurationPath,
      "configurationPath",
    );
    this.#argumentPrefix = argumentPrefix(options.argumentPrefix ?? []);
    this.#spawn = options.spawn ?? spawn;
    this.#stopTimeoutMs = positiveInteger(
      options.stopTimeoutMs ?? 10_000,
      "stopTimeoutMs",
    );
  }

  async launch(slot: Slot): Promise<SupervisedComputerServiceProcess> {
    if (slot !== "stable" && slot !== "experiment") {
      throw new Error("supervised K service slot is invalid");
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
        [
          ...this.#argumentPrefix,
          "__computer-service",
          "--config-fd=3",
          "--supervisor-fd=4",
        ],
        {
          detached: false,
          env: Object.create(null) as NodeJS.ProcessEnv,
          stdio: ["ignore", "ignore", "ignore", configuration.fd, "pipe"],
          windowsHide: true,
        },
      );
      const exited = observeExit(child);
      await waitForSpawn(child);
      const processId = child.pid;
      if (!Number.isSafeInteger(processId) || (processId ?? 0) <= 0) {
        throw new Error("supervised K service has no process id");
      }
      if (child.stdio[4] === null) {
        throw new Error("supervised K service lease pipe is unavailable");
      }
      return supervisedProcess({
        child,
        exited,
        processId: processId!,
        slot,
        stopTimeoutMs: this.#stopTimeoutMs,
      });
    } catch (error) {
      child?.kill("SIGKILL");
      throw error;
    } finally {
      await configuration?.close();
    }
  }
}

function supervisedProcess(input: {
  child: ChildProcess;
  exited: Promise<SupervisedComputerServiceExit>;
  processId: number;
  slot: Slot;
  stopTimeoutMs: number;
}): SupervisedComputerServiceProcess {
  let stopping: Promise<void> | undefined;
  return Object.freeze({
    exited: input.exited,
    processId: input.processId,
    requestStop: async () => {
      stopping ??= stopChild(input);
      await stopping;
    },
    slot: input.slot,
  });
}

async function stopChild(input: {
  child: ChildProcess;
  exited: Promise<SupervisedComputerServiceExit>;
  stopTimeoutMs: number;
}): Promise<void> {
  if (input.child.exitCode !== null || input.child.signalCode !== null) {
    await input.exited;
    return;
  }
  input.child.kill("SIGTERM");
  await new Promise<void>((resolvePromise) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise();
    };
    const timeout = setTimeout(() => {
      input.child.kill("SIGKILL");
      void input.exited.then(finish);
    }, input.stopTimeoutMs);
    void input.exited.then(finish);
  });
}

function observeExit(
  child: ChildProcess,
): Promise<SupervisedComputerServiceExit> {
  return new Promise((resolvePromise) => {
    child.once("exit", (code, signal) => {
      resolvePromise(
        Object.freeze({
          code,
          signal,
        }),
      );
    });
    child.once("error", () => {
      resolvePromise(Object.freeze({ code: null, signal: null }));
    });
  });
}

async function waitForSpawn(child: ChildProcess): Promise<void> {
  if (child.pid !== undefined) return;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectPromise(new Error("supervised K service spawn timed out"));
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
      "supervised K slot artifact must be owner-controlled and executable",
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
    throw new Error("supervised K stateDir must be owner-private");
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
    throw new Error("supervised service configuration must be owner-private");
  }
}

function argumentPrefix(values: readonly string[]): readonly string[] {
  if (
    values.length > 16 ||
    values.some(
      (value) =>
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > 4_096 ||
        value.includes("\0"),
    )
  ) {
    throw new Error("supervised service argumentPrefix is invalid");
  }
  return Object.freeze([...values]);
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

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
