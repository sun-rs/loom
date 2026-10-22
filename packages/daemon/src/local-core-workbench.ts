import {
  startAdditionalLanHttps,
  stopWorkbenchGateways,
} from "./additional-lan-https.ts";
import type { WorkbenchServiceControl } from "./workbench-service-control.ts";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import type { ProvisionedLanCertificate } from "./lan-certificate-provisioning.ts";
import { provisionLanCertificate } from "./lan-certificate-provisioning.ts";
import { DaemonApplication } from "./daemon-application.ts";
import { LanWorkbenchAccessStore } from "./lan-workbench-access-store.ts";
import { LanWorkbenchGateway } from "./lan-workbench-gateway.ts";
import { localCliRuntimeSpec } from "./local-cli-runtime-spec.ts";
import {
  discoverKnownLocalClis,
  resolveLauncherPath,
} from "./local-runtime-inventory.ts";
import type { CliExecutableIdentity } from "./cli-update-watcher.ts";
import { prepareLocalWorkbench } from "./local-workbench-bootstrap.ts";
import { LocalWorkbenchGateway } from "./local-workbench-gateway.ts";
import { loadOrCreateLocalWorkbenchSessionToken } from "./local-workbench-session.ts";

const MAXIMUM_TLS_FILE_BYTES = 1024 * 1024;
// Daemon composition revalidates all configured Runtime executable identities
// before opening its client endpoint. Keep this outer wait aligned with the
// product launch health SLA instead of timing out behind shorter inner probes.
const DAEMON_STARTUP_TIMEOUT_MS = 60_000;

export type LocalCoreWorkbenchMode =
  | { kind: "loopback"; port: number }
  | {
      kind: "tailnet";
      port: number;
      bindHost: string;
      additionalBindHosts?: string[];
      additionalHttpsOrigin?: string;
    }
  | {
      bindHost: string;
      certificatePath?: string;
      kind: "lan";
      privateKeyPath?: string;
      publicOrigin: string;
      tlsDirectory: string;
    };

export type LocalCoreRuntimeDescriptor = {
  cliId: string;
  displayName: string;
};

export type LocalCoreLoopbackDescriptor = {
  https?: Awaited<ReturnType<typeof startAdditionalLanHttps>>["descriptor"];
  defaultRoomId: string;
  persistent: true;
  runtimes: LocalCoreRuntimeDescriptor[];
  stateDirectory: string;
  webOrigin: string;
  workspaceCwd: string;
  workspaceId: string;
};

export type LocalCoreLanDescriptor = LocalCoreLoopbackDescriptor & {
  pairedDevices: number;
  pairingCode: string;
  pairingExpiresAt: string;
  pairingUrl: string;
  tls: true;
  tlsIdentity:
    | { managed: false }
    | {
        caCertificatePath: string;
        certificateFingerprint256: string;
        managed: true;
        reused: boolean;
        validTo: string;
      };
};

export type RunningLocalCoreWorkbench = {
  /** Launcher → pinned file per CLI for this generation (update watcher). */
  cliExecutables?: readonly CliExecutableIdentity[];
  /** Stop/restart claiming new work (update restart barrier). */
  pauseAdmission?: () => Promise<void>;
  resumeAdmission?: () => void;
  descriptor: LocalCoreLoopbackDescriptor | LocalCoreLanDescriptor;
  /** Terminal background failure after the local gateway has been closed. */
  failed?: Promise<Error>;
  stop(): Promise<void>;
};

export async function startLocalCoreWorkbench(input: {
  serviceControl?: WorkbenchServiceControl;
  environment?: NodeJS.ProcessEnv;
  mode: LocalCoreWorkbenchMode;
  staticDirectory: string;
  workbenchHome: string;
  workspaceCwd: string;
}): Promise<RunningLocalCoreWorkbench> {
  const environment = input.environment ?? process.env;
  const staticDirectory = resolve(input.staticDirectory);
  const workbenchHome = resolve(input.workbenchHome);
  const workspaceCwd = resolve(input.workspaceCwd);
  const stateDirectory = join(workbenchHome, "state");
  if (!existsSync(join(staticDirectory, "index.html"))) {
    throw new Error(
      `The production Web build is missing at ${staticDirectory}. Run npm run build:web:workbench first.`,
    );
  }

  const discovered = await discoverKnownLocalClis({ environment });
  // Owner ruling 2026-09-28: the runtime follows the user's stable command
  // (the PATH launcher). The file it resolves to is still pinned and verified
  // per run by the probe identity; a CLI update no longer changes the profile.
  const cliExecutables: CliExecutableIdentity[] = [];
  const runtimeSpecs = (
    await Promise.all(
      discovered.map(async (candidate) => {
        if (
          !candidate.available ||
          candidate.resolvedExecutablePath === undefined
        ) {
          return [];
        }
        const spec = localCliRuntimeSpec(candidate.executable, workspaceCwd);
        if (spec === undefined) return [];
        const launcherPath =
          (await resolveLauncherPath(candidate.executable, environment)) ??
          candidate.resolvedExecutablePath;
        const metadata = statSync(candidate.resolvedExecutablePath);
        cliExecutables.push({
          cliId: spec.cliId,
          launcherPath,
          resolvedPath: candidate.resolvedExecutablePath,
          fingerprint: {
            dev: metadata.dev,
            ino: metadata.ino,
            size: metadata.size,
            mtimeMs: metadata.mtimeMs,
          },
        });
        return [{ ...spec, executable: launcherPath }];
      }),
    )
  ).flat();
  if (runtimeSpecs.length === 0) {
    throw new Error(
      "No supported local Agent CLI was found. Install and sign in to Codex, Kimi, OpenCode, or Claude Code.",
    );
  }

  const prepared = await prepareLocalWorkbench({
    runtimeSpecs,
    stateDirectory,
    workspaceCwd,
  });
  const application = new DaemonApplication({
    config: prepared.config,
  });
  const shutdown = new AbortController();
  const applicationRun = application.run({ signal: shutdown.signal });
  let applicationFailure: unknown;
  let applicationStopped = false;
  void applicationRun.then(
    () => {
      applicationStopped = true;
    },
    (error: unknown) => {
      applicationFailure = error;
      applicationStopped = true;
    },
  );

  let gateway: LocalWorkbenchGateway | LanWorkbenchGateway | undefined;
  let additionalHttps:
    Awaited<ReturnType<typeof startAdditionalLanHttps>> | undefined;
  try {
    await waitForDaemonOrigin({
      application,
      failed: () => applicationFailure,
      stopped: () => applicationStopped,
    });
    const common = {
      ...(input.serviceControl === undefined
        ? {}
        : { serviceControl: input.serviceControl }),
      accessToken: prepared.humanAccessToken,
      daemonOrigin: requiredDaemonOrigin(application),
      staticDirectory,
    };
    if (input.mode.kind === "loopback" || input.mode.kind === "tailnet") {
      gateway = new LocalWorkbenchGateway({
        ...common,
        ...(input.mode.kind === "tailnet"
          ? {
              bindHost: input.mode.bindHost,
              ...(input.mode.additionalBindHosts === undefined
                ? {}
                : { additionalBindHosts: input.mode.additionalBindHosts }),
              browserAccess: "trusted-network" as const,
            }
          : {
              sessionToken: loadOrCreateLocalWorkbenchSessionToken({
                directory: stateDirectory,
              }),
            }),
        port: validatePort(input.mode.port, true),
      });
      await gateway.start();
      if (input.mode.kind === "tailnet" && input.mode.additionalHttpsOrigin) {
        additionalHttps = await startAdditionalLanHttps({
          ...common,
          workbenchHome,
          origin: input.mode.additionalHttpsOrigin,
          hosts: input.mode.additionalBindHosts ?? [],
          httpPort: input.mode.port,
        });
      }
      return withCliExecutables(
        cliExecutables,
        runningWorkbench({
          applicationRun,
          descriptor: {
            ...(additionalHttps ? { https: additionalHttps.descriptor } : {}),
            ...baseDescriptor({
              prepared,
              runtimeSpecs,
              stateDirectory,
              webOrigin: gateway.origin,
              workspaceCwd,
            }),
          },
          gateway: {
            stop: () =>
              stopWorkbenchGateways([gateway, additionalHttps?.gateway]),
          },
          shutdown,
        }),
        application,
      );
    }

    const lan = prepareLanMode(input.mode, workbenchHome);
    const accessStore = new LanWorkbenchAccessStore({
      path: join(stateDirectory, "lan-access.json"),
    });
    gateway = new LanWorkbenchGateway({
      ...common,
      accessStore,
      bindHost: input.mode.bindHost,
      port: lan.port,
      publicHostname: lan.hostname,
      tls: {
        certificate: readRegularFile(lan.certificatePath, false),
        privateKey: readRegularFile(lan.privateKeyPath, true),
      },
    });
    await gateway.start();
    const pairing = gateway.issuePairingCode();
    return withCliExecutables(
      cliExecutables,
      runningWorkbench({
        applicationRun,
        descriptor: {
          ...baseDescriptor({
            prepared,
            runtimeSpecs,
            stateDirectory,
            webOrigin: gateway.origin,
            workspaceCwd,
          }),
          pairedDevices: accessStore.activeDeviceCount(),
          pairingCode: pairing.code,
          pairingExpiresAt: pairing.expiresAt,
          pairingUrl: `${gateway.origin}/_rah/pair`,
          tls: true,
          tlsIdentity:
            lan.provisioned === undefined
              ? { managed: false }
              : managedTlsIdentity(lan.provisioned),
        },
        gateway,
        shutdown,
      }),
      application,
    );
  } catch (error) {
    await stopWorkbenchGateways([gateway, additionalHttps?.gateway]).catch(
      () => undefined,
    );
    shutdown.abort("local-core-startup-failed");
    await applicationRun.catch(() => undefined);
    throw error;
  }
}

function baseDescriptor(input: {
  prepared: Awaited<ReturnType<typeof prepareLocalWorkbench>>;
  runtimeSpecs: ReadonlyArray<{ cliId: string; displayName: string }>;
  stateDirectory: string;
  webOrigin: string;
  workspaceCwd: string;
}): LocalCoreLoopbackDescriptor {
  return {
    defaultRoomId: input.prepared.metadata.defaultRoomId,
    persistent: true,
    runtimes: input.runtimeSpecs.map(({ cliId, displayName }) => ({
      cliId,
      displayName,
    })),
    stateDirectory: input.stateDirectory,
    webOrigin: input.webOrigin,
    workspaceCwd: input.workspaceCwd,
    workspaceId: input.prepared.metadata.workspaceId,
  };
}

export function runningWorkbench(input: {
  applicationRun: Promise<void>;
  descriptor: LocalCoreLoopbackDescriptor | LocalCoreLanDescriptor;
  gateway: Pick<LocalWorkbenchGateway, "stop">;
  shutdown: AbortController;
}): RunningLocalCoreWorkbench {
  let stopped = false;
  let gatewayStop: Promise<void> | undefined;
  const closeGateway = () => (gatewayStop ??= input.gateway.stop());
  let fail!: (error: Error) => void;
  const failed = new Promise<Error>((resolve) => {
    fail = resolve;
  });
  const reportFailure = async (cause: unknown) => {
    if (stopped) return;
    const error = cause instanceof Error ? cause : new Error(String(cause));
    try {
      await closeGateway();
    } catch (cleanup) {
      fail(
        new AggregateError(
          [error, cleanup],
          "daemon failed and gateway cleanup failed",
        ),
      );
      return;
    }
    fail(error);
  };
  void input.applicationRun.then(
    () => reportFailure(new Error("local Core daemon exited unexpectedly")),
    reportFailure,
  );
  return {
    failed,
    descriptor: structuredClone(input.descriptor),
    async stop() {
      if (stopped) return;
      stopped = true;
      await closeGateway().catch(() => undefined);
      input.shutdown.abort("local-core-shutdown");
      await input.applicationRun.catch(() => undefined);
    },
  };
}

function withCliExecutables(
  cliExecutables: readonly CliExecutableIdentity[],
  running: RunningLocalCoreWorkbench,
  application?: DaemonApplication,
): RunningLocalCoreWorkbench {
  running.cliExecutables = cliExecutables;
  if (application !== undefined) {
    running.pauseAdmission = async () =>
      await application.admission?.pauseAdmission();
    running.resumeAdmission = () => application.admission?.resumeAdmission();
  }
  return running;
}

function prepareLanMode(
  mode: Extract<LocalCoreWorkbenchMode, { kind: "lan" }>,
  workbenchHome: string,
): {
  certificatePath: string;
  hostname: string;
  port: number;
  privateKeyPath: string;
  provisioned?: ProvisionedLanCertificate;
} {
  const origin = parsePublicOrigin(mode.publicOrigin);
  if (
    (mode.certificatePath === undefined) !==
    (mode.privateKeyPath === undefined)
  ) {
    throw new Error(
      "certificatePath and privateKeyPath must be provided together",
    );
  }
  if (mode.certificatePath !== undefined && mode.privateKeyPath !== undefined) {
    return {
      certificatePath: absolutePath(mode.certificatePath, "certificatePath"),
      hostname: origin.hostname,
      port: origin.port,
      privateKeyPath: absolutePath(mode.privateKeyPath, "privateKeyPath"),
    };
  }
  const tlsDirectory = resolve(mode.tlsDirectory || join(workbenchHome, "tls"));
  const provisioned = provisionLanCertificate({
    directory: tlsDirectory,
    publicHostname: origin.hostname,
  });
  return {
    certificatePath: provisioned.certificatePath,
    hostname: origin.hostname,
    port: origin.port,
    privateKeyPath: provisioned.privateKeyPath,
    provisioned,
  };
}

function parsePublicOrigin(value: string): { hostname: string; port: number } {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("publicOrigin must be an exact https origin");
  }
  return {
    hostname: url.hostname,
    port: validatePort(url.port === "" ? 443 : Number(url.port), false),
  };
}

function validatePort(port: number, allowEphemeral: boolean): number {
  if (
    !Number.isInteger(port) ||
    port < (allowEphemeral ? 0 : 1) ||
    port > 65_535
  ) {
    throw new Error(
      allowEphemeral
        ? "local Core port must be between 0 and 65535"
        : "local Core public port must be between 1 and 65535",
    );
  }
  return port;
}

function absolutePath(path: string, field: string): string {
  if (!isAbsolute(path)) throw new Error(`${field} must be an absolute path`);
  return path;
}

function readRegularFile(path: string, ownerPrivate: boolean): Buffer {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${path} must be a regular file`);
  }
  if (ownerPrivate && (metadata.mode & 0o077) !== 0) {
    throw new Error(`${path} must be owner-private`);
  }
  if (metadata.size < 1 || metadata.size > MAXIMUM_TLS_FILE_BYTES) {
    throw new Error(`${path} has an invalid size`);
  }
  return readFileSync(path);
}

async function waitForDaemonOrigin(input: {
  application: DaemonApplication;
  failed(): unknown;
  stopped(): boolean;
}): Promise<void> {
  const deadline = Date.now() + DAEMON_STARTUP_TIMEOUT_MS;
  while (input.application.clientOrigin() === undefined) {
    const failure = input.failed();
    if (failure !== undefined) throw failure;
    if (input.stopped()) {
      throw new Error("local Core daemon stopped before becoming ready");
    }
    if (Date.now() >= deadline) {
      throw new Error("local Core daemon startup timed out");
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
}

function requiredDaemonOrigin(application: DaemonApplication): string {
  const origin = application.clientOrigin();
  if (origin === undefined) {
    throw new Error("local Core daemon origin is unavailable");
  }
  return origin;
}

function managedTlsIdentity(
  provisioned: ProvisionedLanCertificate,
): Extract<LocalCoreLanDescriptor["tlsIdentity"], { managed: true }> {
  return {
    caCertificatePath: provisioned.caCertificatePath,
    certificateFingerprint256: provisioned.certificateFingerprint256,
    managed: true,
    reused: provisioned.reused,
    validTo: provisioned.validTo,
  };
}
