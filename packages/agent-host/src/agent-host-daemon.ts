import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, rm } from "node:fs/promises";
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";
import { join } from "node:path";

import type { AuthenticatedHostContext, RoomKernel } from "@rah-os/kernel";

export interface AgentHostRunner {
  run(input: { signal: AbortSignal }): Promise<void>;
}

export interface AgentHostInstanceLock {
  readonly hostId: string;
  acquire(): Promise<void>;
  release(): Promise<void>;
}

export interface ShutdownSignalSource {
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export type AgentHostIdentityMetadata = {
  buildVersion: string;
  processId: number;
  protocolVersion: number;
  takeoverAfterMs: number;
};

export type AgentHostDaemonLifecycle = {
  afterOnline?: () => void | Promise<void>;
  beforeDraining?: () => void;
};

export class DaemonAlreadyRunningError extends Error {
  constructor(hostId: string) {
    super(`AgentHost daemon ${hostId} is already running`);
    this.name = "DaemonAlreadyRunningError";
  }
}

export class UnixSocketInstanceLock implements AgentHostInstanceLock {
  readonly hostId: string;
  readonly socketPath: string;
  readonly #directory: string;
  readonly #handleConnection: (socket: Socket) => void;
  #acquiring = false;
  #server: Server | undefined;

  constructor(input: {
    directory: string;
    handleConnection?: (socket: Socket) => void;
    hostId: string;
  }) {
    const directory = input.directory.trim();
    const hostId = input.hostId.trim();
    if (directory.length === 0) throw new Error("lock directory is required");
    if (hostId.length === 0) throw new Error("hostId is required");
    this.#directory = directory;
    this.#handleConnection =
      input.handleConnection ?? ((socket) => socket.end());
    this.hostId = hostId;
    const lockId = createHash("sha256")
      .update(hostId, "utf8")
      .digest("hex")
      .slice(0, 16);
    this.socketPath = join(directory, `r-${lockId}.sock`);
    if (Buffer.byteLength(this.socketPath, "utf8") > 103) {
      throw new Error(
        "instance lock socket path exceeds the portable Unix socket limit; use a shorter lock directory",
      );
    }
  }

  async acquire(): Promise<void> {
    if (this.#server !== undefined || this.#acquiring) {
      throw new Error("instance lock is already acquired by this object");
    }
    this.#acquiring = true;
    try {
      await this.#prepareDirectory();
      const candidate = createServer((socket) => {
        try {
          this.#handleConnection(socket);
        } catch {
          socket.destroy();
        }
      });
      try {
        await listen(candidate, this.socketPath);
      } catch (error) {
        if (!hasErrorCode(error, "EADDRINUSE")) throw error;
        if (await socketAcceptsConnections(this.socketPath)) {
          throw new DaemonAlreadyRunningError(this.hostId);
        }
        await rm(this.socketPath, { force: true });
        await listen(candidate, this.socketPath);
      }
      try {
        await chmod(this.socketPath, 0o600);
      } catch (error) {
        await closeServer(candidate);
        await rm(this.socketPath, { force: true });
        throw error;
      }
      this.#server = candidate;
    } finally {
      this.#acquiring = false;
    }
  }

  async release(): Promise<void> {
    const server = this.#server;
    if (server === undefined) return;
    await closeServer(server);
    await rm(this.socketPath, { force: true });
    this.#server = undefined;
  }

  async #prepareDirectory(): Promise<void> {
    await mkdir(this.#directory, { mode: 0o700, recursive: true });
    const metadata = await lstat(this.#directory);
    if (metadata.isSymbolicLink()) {
      throw new Error("instance lock directory must not be a symbolic link");
    }
    if (!metadata.isDirectory()) {
      throw new Error("instance lock parent must be a directory");
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error(
        "instance lock directory must not be accessible by group or other users",
      );
    }
    if (
      typeof process.getuid === "function" &&
      metadata.uid !== process.getuid()
    ) {
      throw new Error("instance lock directory must be owned by this user");
    }
  }
}

export class AgentHostDaemon {
  readonly #host: AuthenticatedHostContext;
  readonly #instanceLock: AgentHostInstanceLock;
  readonly #kernel: RoomKernel;
  readonly #lifecycle: AgentHostDaemonLifecycle | undefined;
  readonly #metadata: AgentHostIdentityMetadata | undefined;
  readonly #runner: AgentHostRunner;
  #running = false;

  constructor(input: {
    host: AuthenticatedHostContext;
    instanceLock: AgentHostInstanceLock;
    kernel: RoomKernel;
    lifecycle?: AgentHostDaemonLifecycle;
    metadata?: AgentHostIdentityMetadata;
    runner: AgentHostRunner;
  }) {
    this.#host = input.host;
    this.#instanceLock = input.instanceLock;
    this.#kernel = input.kernel;
    this.#lifecycle = input.lifecycle;
    this.#metadata = input.metadata;
    this.#runner = input.runner;
    if (input.instanceLock.hostId !== input.host.hostId) {
      throw new Error("instance lock identity must match authenticated Host");
    }
  }

  async run(input: { signal: AbortSignal }): Promise<void> {
    if (this.#running) {
      throw new Error("AgentHostDaemon is already running");
    }
    if (input.signal.aborted) return;
    this.#running = true;
    let acquired = false;
    const workerShutdown = new AbortController();
    const beginDrain = () => {
      try {
        this.#lifecycle?.beforeDraining?.();
      } catch {
        // Offer withdrawal is best effort; process ownership still must drain.
      }
      try {
        this.#kernel.heartbeatHost(this.#host, { state: "draining" });
      } catch {
        // Shutdown must continue even when a credential was concurrently revoked.
      } finally {
        workerShutdown.abort(input.signal.reason);
      }
    };
    let executionFailure: { error: unknown } | undefined;
    try {
      await this.#instanceLock.acquire();
      acquired = true;
      this.#kernel.heartbeatHost(this.#host, {
        ...this.#metadata,
        state: "online",
      });
      await this.#lifecycle?.afterOnline?.();
      input.signal.addEventListener("abort", beginDrain, { once: true });
      if (input.signal.aborted) beginDrain();
      await this.#runner.run({ signal: workerShutdown.signal });
    } catch (error) {
      executionFailure = { error };
    }

    let cleanupFailure: { error: unknown } | undefined;
    try {
      input.signal.removeEventListener("abort", beginDrain);
      if (acquired) {
        try {
          this.#kernel.heartbeatHost(this.#host, { state: "offline" });
        } catch {
          // A revoked Host can still release its local process ownership.
        }
        await this.#instanceLock.release();
      }
    } catch (error) {
      cleanupFailure = { error };
    } finally {
      this.#running = false;
    }

    if (executionFailure !== undefined && cleanupFailure !== undefined) {
      throw new AggregateError(
        [executionFailure.error, cleanupFailure.error],
        "AgentHostDaemon execution and cleanup both failed",
      );
    }
    if (executionFailure !== undefined) throw executionFailure.error;
    if (cleanupFailure !== undefined) throw cleanupFailure.error;
  }
}

export async function runAgentHostDaemonUntilSignal(
  daemon: AgentHostRunner,
  options: { signals?: ShutdownSignalSource } = {},
): Promise<void> {
  const signals = options.signals ?? process;
  const shutdown = new AbortController();
  const onInterrupt = () => shutdown.abort("SIGINT");
  const onTerminate = () => shutdown.abort("SIGTERM");
  signals.once("SIGINT", onInterrupt);
  signals.once("SIGTERM", onTerminate);
  try {
    await daemon.run({ signal: shutdown.signal });
  } finally {
    signals.off("SIGINT", onInterrupt);
    signals.off("SIGTERM", onTerminate);
  }
}

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function socketAcceptsConnections(socketPath: string): Promise<boolean> {
  return await new Promise<boolean>((resolve, reject) => {
    const socket = createConnection(socketPath);
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 250);
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      socket.destroy();
      if (
        hasErrorCode(error, "ECONNREFUSED") ||
        hasErrorCode(error, "ENOENT") ||
        hasErrorCode(error, "ENOTSOCK")
      ) {
        resolve(false);
      } else {
        reject(error);
      }
    });
  });
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
