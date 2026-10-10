import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { arch, hostname, platform } from "node:os";

import {
  LocalRuntimeInventoryEntrySchema,
  LocalRuntimeInventoryResponseSchema,
  type LocalRuntimeInventoryEntry,
  type LocalRuntimeInventoryResponse,
  type LocalComputerProfile,
  type RuntimeProfileProbeReport,
  type RuntimeProfileRevision,
} from "@rah-os/protocol";
import {
  supportedRuntimeToolAccessModes,
  type RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import type { AuthenticatedActorContext, RoomKernel } from "@rah-os/kernel";

import {
  resolveSkillsConfiguration,
  type SkillsConfiguration,
} from "./daemon-agent-skills.ts";

const execFileAsync = promisify(execFile);

export const KNOWN_LOCAL_CLIS = Object.freeze([
  { displayName: "Codex", executable: "codex" },
  { displayName: "Kimi CLI", executable: "kimi" },
  { displayName: "OpenCode", executable: "opencode" },
  { displayName: "Claude Code", executable: "claude" },
  { displayName: "Pi", executable: "pi" },
]);

export type ConfiguredLocalRuntime = {
  customModelRuntime?: "claude" | "codex";
  cliId?: LocalRuntimeInventoryEntry["cliId"];
  agentBindings: LocalRuntimeInventoryEntry["agentBindings"];
  available: boolean;
  displayName: string;
  executable: string;
  failureCode?: string;
  modelBindingDescriptors: LocalRuntimeInventoryEntry["modelBindingDescriptors"];
  probeObservedAt?: string;
  probeValidatedAt?: string;
  resolvedExecutablePath?: string;
  runtimeOfferId: string;
  runtimeProfileId: string;
  runtimeProfileRevisionId: string;
  supportedToolAccessModes?: LocalRuntimeInventoryEntry["supportedToolAccessModes"];
};

export type ConfiguredLocalRuntimeSnapshot = Omit<
  ConfiguredLocalRuntime,
  "agentBindings"
> & { skillsConfiguration?: SkillsConfiguration };

export function configuredRuntimeSnapshotWithValidation(input: {
  probeReport: RuntimeProfileProbeReport;
  registry: Pick<RuntimeProfileRegistry, "getProbeValidation">;
  runtimeOfferId: string;
  runtimeProfileRevision: RuntimeProfileRevision;
}): ConfiguredLocalRuntimeSnapshot {
  return configuredRuntimeSnapshot({
    probeReport: input.probeReport,
    probeValidatedAt: input.registry.getProbeValidation(
      input.runtimeProfileRevision.runtimeProfileRevisionId,
    )?.lastValidatedAt,
    runtimeOfferId: input.runtimeOfferId,
    runtimeProfileRevision: input.runtimeProfileRevision,
  });
}

export function runtimeProfileCliId(
  runtimeProfileRevision: RuntimeProfileRevision,
): LocalRuntimeInventoryEntry["cliId"] {
  const probeKind =
    runtimeProfileRevision.manifest.manifestVersion === 3
      ? runtimeProfileRevision.manifest.modelCatalogProbe.kind
      : undefined;
  const cliId =
    probeKind === "codex-cli/v1"
      ? "codex"
      : probeKind === "kimi-cli/v1"
        ? "kimi"
        : probeKind === "claude-cli/v1"
          ? "claude"
          : probeKind === "opencode-cli/v1"
            ? "opencode"
            : probeKind === "pi-cli/v1"
              ? "pi"
              : undefined;
  return cliId;
}

export function configuredRuntimeSnapshot(input: {
  probeReport: RuntimeProfileProbeReport;
  probeValidatedAt: string | undefined;
  runtimeOfferId: string;
  runtimeProfileRevision: RuntimeProfileRevision;
}): ConfiguredLocalRuntimeSnapshot {
  const { probeReport, runtimeOfferId, runtimeProfileRevision } = input;
  const cliId = runtimeProfileCliId(runtimeProfileRevision);
  return {
    ...(runtimeProfileRevision.manifest.adapter.kind === "claude-stream-json/v1"
      ? { customModelRuntime: "claude" as const }
      : runtimeProfileRevision.manifest.adapter.kind === "codex-app-server/v1"
        ? { customModelRuntime: "codex" as const }
        : {}),
    ...(cliId === undefined ? {} : { cliId }),
    available: probeReport.available,
    displayName: runtimeProfileRevision.manifest.displayName,
    executable: runtimeProfileRevision.manifest.adapter.executable,
    modelBindingDescriptors:
      probeReport.reportVersion === 2
        ? probeReport.modelBindings.map(
            ({ adapterMapping: _mapping, ...descriptor }) => descriptor,
          )
        : [],
    ...(probeReport.failureCode === undefined
      ? {}
      : { failureCode: probeReport.failureCode }),
    ...(probeReport.observedAt === undefined
      ? {}
      : { probeObservedAt: probeReport.observedAt }),
    ...(input.probeValidatedAt === undefined
      ? {}
      : { probeValidatedAt: input.probeValidatedAt }),
    ...(probeReport.executableIdentity?.resolvedExecutablePath === undefined
      ? {}
      : {
          resolvedExecutablePath:
            probeReport.executableIdentity.resolvedExecutablePath,
        }),
    skillsConfiguration: resolveSkillsConfiguration(
      runtimeProfileRevision,
      probeReport,
    ),
    runtimeOfferId,
    runtimeProfileId: runtimeProfileRevision.runtimeProfileId,
    runtimeProfileRevisionId: runtimeProfileRevision.runtimeProfileRevisionId,
    supportedToolAccessModes: [
      ...supportedRuntimeToolAccessModes(
        runtimeProfileRevision.manifest.adapter.kind,
        runtimeProfileRevision.manifest.manifestVersion === 3
          ? runtimeProfileRevision.manifest.modelCatalogProbe.kind
          : undefined,
      ),
    ],
  };
}

export function buildLocalComputerObservation(input: {
  computerProfile?: LocalComputerProfile;
  hostId: string;
  kernel: Pick<RoomKernel, "listHosts">;
  now?: Date;
  staleAfterMs?: number;
}): NonNullable<LocalRuntimeInventoryResponse["computer"]> {
  const now = input.now ?? new Date();
  const staleAfterMs = input.staleAfterMs ?? 30_000;
  const host = input.kernel
    .listHosts()
    .find((host) => host.hostId === input.hostId);
  const age = host ? now.getTime() - Date.parse(host.lastSeenAt) : Infinity;
  const computerProfile = input.computerProfile;
  return {
    description: computerProfile?.description ?? null,
    displayName:
      computerProfile?.displayName ?? hostname().replace(/\.local$/, ""),
    hostname: hostname(),
    os: `${platform()} ${arch()}`,
    observedAt: now.toISOString(),
    profileRevision: computerProfile?.revision ?? 0,
    ...(computerProfile === undefined
      ? {}
      : { profileUpdatedAt: computerProfile.updatedAt }),
    staleAfterMs,
    status: !host
      ? "unknown"
      : host.state === "offline"
        ? "offline"
        : age < 0 || !Number.isFinite(age)
          ? "unknown"
          : age >= staleAfterMs
            ? "offline"
            : host.state,
    ...(host
      ? {
          ...(host.createdAt === undefined
            ? {}
            : { createdAt: host.createdAt }),
          lastSeenAt: host.lastSeenAt,
          instanceId: host.instanceId,
          ...(host.buildVersion ? { buildVersion: host.buildVersion } : {}),
        }
      : {}),
  };
}

export function buildLocalRuntimeInventoryResponse(input: {
  actor: AuthenticatedActorContext;
  computerProfile?: LocalComputerProfile;
  configured: readonly ConfiguredLocalRuntimeSnapshot[];
  discovered: readonly LocalRuntimeInventoryEntry[];
  hostId: string;
  kernel: RoomKernel;
  now?: Date;
  staleAfterMs?: number;
}): LocalRuntimeInventoryResponse {
  const catalog = input.kernel.listAgentCatalog(input.actor);
  return LocalRuntimeInventoryResponseSchema.parse({
    hostId: input.hostId,
    computer: buildLocalComputerObservation(input),
    restartRequiredToRescan: true,
    runtimes: mergeLocalRuntimeInventory({
      configured: input.configured.map(
        ({ skillsConfiguration: _skillsConfiguration, ...runtime }) => ({
          ...runtime,
          available:
            runtime.available &&
            input.kernel.runtimeOfferIsCurrentlyAvailable(
              runtime.runtimeOfferId,
            ),
          agentBindings: catalog.flatMap((entry) => {
            const policy = input.kernel.getExecutionPolicyRevision(
              entry.currentRevision.executionPolicyRevisionId,
            );
            return policy.required.allowedOfferIds?.includes(
              runtime.runtimeOfferId,
            ) === true
              ? [
                  {
                    agentId: entry.definition.agentId,
                    handle: entry.handle,
                    participantId: entry.definition.participantId,
                  },
                ]
              : [];
          }),
        }),
      ),
      discovered: input.discovered,
    }),
  });
}

export function mergeLocalRuntimeInventory(input: {
  configured: readonly ConfiguredLocalRuntime[];
  discovered: readonly LocalRuntimeInventoryEntry[];
}): LocalRuntimeInventoryEntry[] {
  const matchedDiscoveryEntries = new Set<LocalRuntimeInventoryEntry>();
  const configured = input.configured.map((runtime) => {
    const discovery = input.discovered.find((entry) =>
      runtimeInventoryEntriesMatch(runtime, entry),
    );
    if (discovery !== undefined) matchedDiscoveryEntries.add(discovery);
    return LocalRuntimeInventoryEntrySchema.parse({
      ...runtime,
      ...(runtime.cliId === undefined && discovery?.cliId !== undefined
        ? { cliId: discovery.cliId }
        : {}),
      configured: true,
      source: "configured",
      ...(runtime.resolvedExecutablePath === undefined &&
      discovery?.resolvedExecutablePath !== undefined
        ? { resolvedExecutablePath: discovery.resolvedExecutablePath }
        : {}),
      ...(discovery?.version === undefined
        ? {}
        : { version: discovery.version }),
    });
  });
  return [
    ...configured,
    ...input.discovered.filter((entry) => !matchedDiscoveryEntries.has(entry)),
  ];
}

function runtimeInventoryEntriesMatch(
  configured: ConfiguredLocalRuntime,
  discovered: LocalRuntimeInventoryEntry,
): boolean {
  if (
    configured.resolvedExecutablePath !== undefined &&
    discovered.resolvedExecutablePath !== undefined
  ) {
    return (
      configured.resolvedExecutablePath === discovered.resolvedExecutablePath
    );
  }
  return configured.executable === discovered.executable;
}

export async function discoverKnownLocalClis(
  input: {
    environment?: NodeJS.ProcessEnv;
    versionTimeoutMs?: number;
  } = {},
): Promise<LocalRuntimeInventoryEntry[]> {
  const environment = input.environment ?? process.env;
  const versionTimeoutMs = input.versionTimeoutMs ?? 2_000;
  if (!Number.isInteger(versionTimeoutMs) || versionTimeoutMs <= 0) {
    throw new Error("versionTimeoutMs must be a positive integer");
  }
  return await Promise.all(
    KNOWN_LOCAL_CLIS.map(async ({ displayName, executable }) => {
      const resolvedExecutablePath = await resolveExecutable(
        executable,
        environment,
      );
      const version =
        resolvedExecutablePath === undefined
          ? undefined
          : await readBoundedVersion(
              resolvedExecutablePath,
              environment,
              versionTimeoutMs,
            );
      return LocalRuntimeInventoryEntrySchema.parse({
        agentBindings: [],
        available: resolvedExecutablePath !== undefined,
        configured: false,
        cliId: executable,
        displayName,
        executable,
        modelBindingDescriptors: [],
        ...(resolvedExecutablePath === undefined
          ? {}
          : { resolvedExecutablePath }),
        source: "discovered",
        ...(version === undefined ? {} : { version }),
      });
    }),
  );
}

/**
 * The PATH entry the user's shell would run (the stable launcher, often a
 * symlink to a versioned file), without resolving it. Owner ruling
 * 2026-09-28: Loom follows this command; the resolved file is pinned per run.
 */
export async function resolveLauncherPath(
  executable: string,
  environment: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  for (const candidate of executableCandidates(executable, environment)) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(await realpath(candidate))).isFile()) return candidate;
    } catch {
      // Continue through PATH.
    }
  }
  return undefined;
}

function executableCandidates(
  executable: string,
  environment: NodeJS.ProcessEnv,
): string[] {
  return isAbsolute(executable)
    ? [executable]
    : (environment.PATH ?? "")
        .split(delimiter)
        .filter((directory) => directory.length > 0)
        .flatMap((directory) =>
          process.platform === "win32"
            ? [
                join(directory, executable),
                ...String(environment.PATHEXT ?? ".EXE;.CMD;.BAT")
                  .split(";")
                  .filter((extension) => extension.length > 0)
                  .map((extension) =>
                    join(directory, `${executable}${extension.toLowerCase()}`),
                  ),
              ]
            : [join(directory, executable)],
        );
}

async function resolveExecutable(
  executable: string,
  environment: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  for (const candidate of executableCandidates(executable, environment)) {
    try {
      await access(candidate, constants.X_OK);
      const resolved = await realpath(candidate);
      if ((await stat(resolved)).isFile()) return resolved;
    } catch {
      // Continue through PATH without turning an absent candidate into an error.
    }
  }
  return undefined;
}

async function readBoundedVersion(
  executable: string,
  environment: NodeJS.ProcessEnv,
  timeout: number,
): Promise<string | undefined> {
  try {
    const result = await execFileAsync(executable, ["--version"], {
      encoding: "utf8",
      env: environment,
      maxBuffer: 8 * 1_024,
      timeout,
      windowsHide: true,
    });
    const firstLine = result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return firstLine?.slice(0, 512);
  } catch {
    return undefined;
  }
}
