import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { RuntimeIdentityResponse } from "@rah/runtime-protocol";
import { RuntimeEngine } from "./runtime-engine";
import { createPostRoutes, handleHttpRequest } from "./http-server-routes";
import { attachWebSocketHandlers } from "./http-server-websocket";
import { DeviceAuthManager } from "./device-auth";
import { runBackgroundCommand } from "./background-command";
import { WorkbenchNoticePreferencesStore } from "./workbench-notice-preferences";
import { resolveRahDataHome } from "./rah-paths.mjs";
import {
  createRoomApplicationRuntime,
  type RoomApplicationRuntime,
} from "./room/room-runtime";

export interface RahDaemon {
  host: string;
  port: number;
  close(): Promise<void>;
}

const DEFAULT_HTTP_DRAIN_TIMEOUT_MS = 5_000;

function readRootPackageVersion(rootDir: string): string | undefined {
  try {
    const raw = readFileSync(path.join(rootDir, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

export function readWebBuildId(rootDir: string): string | undefined {
  try {
    const raw = readFileSync(
      path.join(
        rootDir,
        "packages",
        "client-web",
        "dist",
        ".rah-web-build.json",
      ),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { webBuildId?: unknown };
    return typeof parsed.webBuildId === "string" && parsed.webBuildId.trim()
      ? parsed.webBuildId.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

async function readSourceState(
  rootDir: string,
): Promise<{ sourceRevision?: string; sourceDirty?: boolean }> {
  try {
    const result = await runBackgroundCommand({
      command: "git",
      args: ["status", "--porcelain=v2", "--branch"],
      cwd: rootDir,
      label: "RAH source identity",
      timeoutMs: 3_000,
      maxStdoutBytes: 2 * 1024 * 1024,
      maxStderrBytes: 128 * 1024,
    });
    const lines = result.stdout.split(/\r?\n/);
    const oid = lines
      .find((line) => line.startsWith("# branch.oid "))
      ?.slice("# branch.oid ".length)
      .trim();
    const sourceRevision =
      oid && oid !== "(initial)" ? oid.slice(0, 7) : undefined;
    const sourceDirty = lines.some(
      (line) => line.length > 0 && !line.startsWith("# "),
    );
    return {
      ...(sourceRevision ? { sourceRevision } : {}),
      sourceDirty,
    };
  } catch {
    return {};
  }
}

async function createRuntimeIdentity(
  port: number,
): Promise<RuntimeIdentityResponse> {
  const rootDir = process.cwd();
  const version = readRootPackageVersion(rootDir);
  const webBuildId = readWebBuildId(rootDir);
  const { sourceRevision, sourceDirty } = await readSourceState(rootDir);
  return {
    name: "rah",
    runtimeId: randomUUID(),
    pid: process.pid,
    port,
    startedAt: new Date().toISOString(),
    rootDir,
    ...(version ? { version } : {}),
    ...(sourceRevision ? { sourceRevision } : {}),
    ...(sourceDirty !== undefined ? { sourceDirty } : {}),
    ...(webBuildId ? { webBuildId } : {}),
  };
}

export async function startRahDaemon(options?: {
  host?: string;
  port?: number;
  engine?: RuntimeEngine;
  auth?: DeviceAuthManager | false;
  httpDrainTimeoutMs?: number;
  roomRoot?: string;
  roomRuntime?: RoomApplicationRuntime | false;
  createNoticePreferences?: () => WorkbenchNoticePreferencesStore;
  attachWebSockets?: typeof attachWebSocketHandlers;
}): Promise<RahDaemon> {
  const host = options?.host ?? "0.0.0.0";
  const port = options?.port ?? 43111;
  const httpDrainTimeoutMs = options?.httpDrainTimeoutMs ?? DEFAULT_HTTP_DRAIN_TIMEOUT_MS;
  if (options?.roomRoot !== undefined && options.roomRuntime !== undefined) {
    throw new Error("roomRoot and roomRuntime cannot both be provided");
  }
  let roomRuntime: RoomApplicationRuntime | undefined;
  let engine: RuntimeEngine | undefined = options?.engine;
  let auth: DeviceAuthManager | undefined;
  let postRoutes: ReturnType<typeof createPostRoutes>;
  let noticePreferences: WorkbenchNoticePreferencesStore;
  try {
    roomRuntime = options?.roomRuntime === false
      ? undefined
      : options?.roomRuntime ?? await createRoomApplicationRuntime({
          roomRoot: options?.roomRoot ?? path.join(resolveRahDataHome(), "room"),
        });
    engine ??= new RuntimeEngine();
    auth = options?.auth === false ? undefined : options?.auth ?? new DeviceAuthManager();
    postRoutes = createPostRoutes(engine);
    noticePreferences = options?.createNoticePreferences?.() ??
      new WorkbenchNoticePreferencesStore();
    noticePreferences.load();
  } catch (error) {
    await Promise.allSettled([
      engine?.shutdown() ?? Promise.resolve(),
      roomRuntime?.close() ?? Promise.resolve(),
    ]);
    throw error;
  }
  const ownedEngine = engine;
  let runtimeIdentity: RuntimeIdentityResponse | undefined;
  let closePromise: Promise<void> | undefined;

  const server = createServer(async (req, res) => {
    await handleHttpRequest({
      engine: ownedEngine,
      postRoutes,
      noticePreferences,
      req,
      res,
      runtimeIdentity,
      auth,
      roomRuntime,
    });
  });
  let websockets: ReturnType<typeof attachWebSocketHandlers>;
  try {
    websockets = (options?.attachWebSockets ?? attachWebSocketHandlers)(
      server,
      ownedEngine,
      auth,
    );
  } catch (error) {
    await Promise.allSettled([
      ownedEngine.shutdown(),
      roomRuntime?.close() ?? Promise.resolve(),
    ]);
    throw error;
  }

  let actualPort: number;
  try {
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
      server.listen(port, host);
    });
    const address = server.address();
    actualPort = typeof address === "object" && address ? address.port : port;
    runtimeIdentity = await createRuntimeIdentity(actualPort);
  } catch (error) {
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await Promise.allSettled([
      websockets.close(),
      ownedEngine.shutdown(),
      roomRuntime?.close() ?? Promise.resolve(),
    ]);
    throw error;
  }

  return {
    host,
    port: actualPort,
    close() {
      if (!closePromise) {
        closePromise = (async () => {
          let serverCloseError: Error | undefined;
          const serverClosed = new Promise<void>((resolve) => {
            server.close((error) => {
              serverCloseError = error;
              resolve();
            });
          });

          const forceDrainTimer = setTimeout(() => {
            server.closeAllConnections();
          }, Math.max(0, httpDrainTimeoutMs));
          forceDrainTimer.unref?.();

          let engineShutdownError: unknown;
          const engineShutdown = ownedEngine.shutdown().catch((error) => {
            engineShutdownError = error;
            console.error("[rah] engine shutdown failed", error);
          });

          let noticeFlushError: unknown;
          const noticeFlush = Promise.resolve()
            .then(() => noticePreferences.flush())
            .catch((error) => {
              noticeFlushError = error;
            });

          let webSocketCloseError: unknown;
          try {
            await websockets.close();
          } catch (error) {
            webSocketCloseError = error;
          }
          await Promise.all([serverClosed, engineShutdown, noticeFlush]);
          let roomShutdownError: unknown;
          try {
            await roomRuntime?.close();
          } catch (error) {
            roomShutdownError = error;
          }
          clearTimeout(forceDrainTimer);

          if (
            serverCloseError ||
            webSocketCloseError ||
            engineShutdownError ||
            noticeFlushError ||
            roomShutdownError
          ) {
            throw new AggregateError(
              [
                serverCloseError,
                webSocketCloseError,
                engineShutdownError,
                noticeFlushError,
                roomShutdownError,
              ].filter(
                (error) => error !== undefined,
              ),
              "RAH shutdown failed.",
            );
          }
        })();
      }
      return closePromise;
    },
  };
}
