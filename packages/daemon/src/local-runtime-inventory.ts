import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

import {
  LocalRuntimeInventoryEntrySchema,
  LocalRuntimeInventoryResponseSchema,
  type LocalRuntimeInventoryEntry,
  type LocalRuntimeInventoryResponse,
  type RuntimeProfileProbeReport,
  type RuntimeProfileRevision,
} from "@rah-os/protocol";
import type { AuthenticatedActorContext, RoomKernel } from "@rah-os/kernel";

const execFileAsync = promisify(execFile);

export const KNOWN_LOCAL_CLIS = Object.freeze([
  { displayName: "Codex", executable: "codex" },
  { displayName: "Kimi CLI", executable: "kimi" },
  { displayName: "OpenCode", executable: "opencode" },
  { displayName: "Claude Code", executable: "claude" },
]);

export type ConfiguredLocalRuntime = {
  agentBindings: LocalRuntimeInventoryEntry["agentBindings"];
  available: boolean;
  displayName: string;
  executable: string;
  failureCode?: string;
  modelBindingDescriptors: LocalRuntimeInventoryEntry["modelBindingDescriptors"];
  probeObservedAt?: string;
  resolvedExecutablePath?: string;
  runtimeOfferId: string;
  runtimeProfileId: string;
  runtimeProfileRevisionId: string;
};

export type ConfiguredLocalRuntimeSnapshot = Omit<
  ConfiguredLocalRuntime,
  "agentBindings"
>;

export function configuredRuntimeSnapshot(input: {
  probeReport: RuntimeProfileProbeReport;
  runtimeOfferId: string;
  runtimeProfileRevision: RuntimeProfileRevision;
}): ConfiguredLocalRuntimeSnapshot {
  const { probeReport, runtimeOfferId, runtimeProfileRevision } = input;
  return {
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
    ...(probeReport.executableIdentity?.resolvedExecutablePath === undefined
      ? {}
      : {
          resolvedExecutablePath:
            probeReport.executableIdentity.resolvedExecutablePath,
        }),
    runtimeOfferId,
    runtimeProfileId: runtimeProfileRevision.runtimeProfileId,
    runtimeProfileRevisionId: runtimeProfileRevision.runtimeProfileRevisionId,
  };
}

export function buildLocalRuntimeInventoryResponse(input: {
  actor: AuthenticatedActorContext;
  configured: readonly ConfiguredLocalRuntimeSnapshot[];
  discovered: readonly LocalRuntimeInventoryEntry[];
  hostId: string;
  kernel: RoomKernel;
}): LocalRuntimeInventoryResponse {
  const catalog = input.kernel.listAgentCatalog(input.actor);
  return LocalRuntimeInventoryResponseSchema.parse({
    hostId: input.hostId,
    restartRequiredToRescan: true,
    runtimes: mergeLocalRuntimeInventory({
      configured: input.configured.map((runtime) => ({
        ...runtime,
        agentBindings: catalog.flatMap((entry) => {
          const policy = input.kernel.getExecutionPolicyRevision(
            entry.currentRevision.executionPolicyRevisionId,
          );
          return policy.required.allowedOfferIds?.includes(
            runtime.runtimeOfferId,
          ) === true
            ? [
                {
                  agentDefinitionId: entry.definition.agentDefinitionId,
                  handle: entry.handle,
                  participantId: entry.definition.participantId,
                },
              ]
            : [];
        }),
      })),
      discovered: input.discovered,
    }),
  });
}

export function mergeLocalRuntimeInventory(input: {
  configured: readonly ConfiguredLocalRuntime[];
  discovered: readonly LocalRuntimeInventoryEntry[];
}): LocalRuntimeInventoryEntry[] {
  const matchedExecutables = new Set(
    input.configured.map((runtime) => runtime.executable),
  );
  const configured = input.configured.map((runtime) => {
    const discovery = input.discovered.find(
      (entry) => entry.executable === runtime.executable,
    );
    return LocalRuntimeInventoryEntrySchema.parse({
      ...runtime,
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
    ...input.discovered.filter(
      ({ executable }) => !matchedExecutables.has(executable),
    ),
  ];
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

async function resolveExecutable(
  executable: string,
  environment: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const candidates = isAbsolute(executable)
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
  for (const candidate of candidates) {
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
