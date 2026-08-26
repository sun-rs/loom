import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, resolve } from "node:path";

import type {
  RuntimeOffer,
  RuntimeOfferState,
  RuntimeProfileManifest,
  RuntimeProfileProbeReport,
  RuntimeProfileRevision,
} from "@rah-os/protocol";
import {
  RuntimeOfferSchema,
  RuntimeProfileRevisionSchema,
} from "@rah-os/protocol";

import {
  GenericProcessAdapter,
  type ActivationEnvironmentLease,
  type GenericProcessAdapterOptions,
} from "./generic-process-adapter.ts";
import {
  computeRuntimeProfileManifestDigest,
  computeRuntimeProfileProbeDigest,
  type RuntimeProfileProbeObservation,
} from "./runtime-profile-registry.ts";
import { issueRuntimeProfileProbeObservation } from "./runtime-probe-authority.ts";

const GENERIC_PROCESS_IMPLEMENTATION_VERSION = "generic-process-adapter/v1";
const PROCESS_SUPERVISOR_DRIVER = "rah-process-supervisor-v1";
const PROCESS_SUPERVISOR_IMPLEMENTATION_VERSION = "rah-process-supervisor/v1";
const MAX_CREDENTIAL_BYTES = 65_536;

export type RuntimeCreationOptions = Pick<
  GenericProcessAdapterOptions,
  "activationEnvironment" | "beforeStart" | "cwd" | "supervisorDirectory"
>;

type RuntimeAdapterImplementation = {
  create: (
    revision: RuntimeProfileRevision,
    options: RuntimeCreationOptions,
    probeReport?: RuntimeProfileProbeReport,
  ) => GenericProcessAdapter;
  implementationVersion: string;
  recoveryDrivers: readonly string[];
};

export class RuntimeImplementationRegistry {
  readonly #adapterImplementations = new Map<
    string,
    RuntimeAdapterImplementation
  >();
  readonly #recoveryDriverVersions = new Map<string, string>();

  constructor() {
    const recoveryDrivers =
      process.platform === "win32" ? [] : [PROCESS_SUPERVISOR_DRIVER];
    this.#adapterImplementations.set("generic-process/v1", {
      create: (revision, options, probeReport) =>
        createGenericProcessRuntime(revision, options, probeReport),
      implementationVersion: GENERIC_PROCESS_IMPLEMENTATION_VERSION,
      recoveryDrivers,
    });
    if (process.platform !== "win32") {
      this.#recoveryDriverVersions.set(
        PROCESS_SUPERVISOR_DRIVER,
        PROCESS_SUPERVISOR_IMPLEMENTATION_VERSION,
      );
    }
  }

  adapterImplementationVersion(kind: string): string | undefined {
    return this.#adapterImplementations.get(kind)?.implementationVersion;
  }

  recoveryDriverImplementationVersion(driver: string): string | undefined {
    return this.#recoveryDriverVersions.get(driver);
  }

  recoveryDrivers(): readonly string[] {
    return [...this.#recoveryDriverVersions.keys()].sort();
  }

  async probeRevision(
    revision: RuntimeProfileRevision,
    input: { cwd: string },
  ): Promise<RuntimeProfileProbeObservation> {
    revision = validateRuntimeProfileRevision(revision);
    const manifest = revision.manifest;
    const adapterImplementation = this.#adapterImplementations.get(
      manifest.adapter.kind,
    );
    if (adapterImplementation === undefined) {
      return issueRuntimeProfileProbeObservation({
        adapter: {
          implementationVersion: "unregistered-adapter/v1",
          kind: manifest.adapter.kind,
        },
        available: false,
        contentDigest: revision.contentDigest,
        failureCode: "unsupported_adapter",
        recoveryDrivers: [],
        runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
      });
    }

    const recoveryDrivers = adapterImplementation.recoveryDrivers.flatMap(
      (driver) => {
        const implementationVersion = this.#recoveryDriverVersions.get(driver);
        return implementationVersion === undefined
          ? []
          : [{ driver, implementationVersion }];
      },
    );
    const missingRecoveryDriver = manifest.recoveryDrivers.some(
      (driver) =>
        !recoveryDrivers.some((available) => available.driver === driver),
    );
    if (
      missingRecoveryDriver ||
      manifest.recoveryDrivers.length !== recoveryDrivers.length
    ) {
      return issueRuntimeProfileProbeObservation({
        adapter: {
          implementationVersion: adapterImplementation.implementationVersion,
          kind: manifest.adapter.kind,
        },
        available: false,
        contentDigest: revision.contentDigest,
        failureCode: "recovery_driver_unavailable",
        recoveryDrivers,
        runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
      });
    }

    const executable = await resolveExecutableIdentity(
      manifest.adapter.executable,
      input.cwd,
      manifest.manifestVersion === 2 ? manifest.staticEnv.PATH : undefined,
    );
    return issueRuntimeProfileProbeObservation({
      adapter: {
        implementationVersion: adapterImplementation.implementationVersion,
        kind: manifest.adapter.kind,
      },
      available: executable.available,
      contentDigest: revision.contentDigest,
      ...(executable.identity === undefined
        ? {}
        : { executableIdentity: executable.identity }),
      ...(executable.failureCode === undefined
        ? {}
        : { failureCode: executable.failureCode }),
      recoveryDrivers,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
  }

  createRuntime(
    revision: RuntimeProfileRevision,
    probeReport: RuntimeProfileProbeReport,
    options: RuntimeCreationOptions,
  ): GenericProcessAdapter {
    revision = validateRuntimeProfileRevision(revision);
    if (revision.state !== "active") {
      throw new Error(
        `RuntimeProfileRevision ${revision.runtimeProfileRevisionId} is not active`,
      );
    }
    const implementation = this.#adapterImplementations.get(
      revision.manifest.adapter.kind,
    );
    if (implementation === undefined) {
      throw new Error(
        `unsupported runtime adapter: ${revision.manifest.adapter.kind}`,
      );
    }
    validateMatchingProbeReport(revision, probeReport, true);
    return implementation.create(revision, options, probeReport);
  }

  createRecoveryRuntime(
    revision: RuntimeProfileRevision,
    driver: string,
    options: RuntimeCreationOptions,
  ): GenericProcessAdapter {
    revision = validateRuntimeProfileRevision(revision);
    const implementationVersion = this.#recoveryDriverVersions.get(driver);
    if (
      implementationVersion === undefined ||
      !revision.manifest.recoveryDrivers.includes(driver)
    ) {
      throw new Error(`unsupported runtime recovery driver: ${driver}`);
    }
    const implementation = this.#adapterImplementations.get(
      revision.manifest.adapter.kind,
    );
    if (
      implementation === undefined ||
      !implementation.recoveryDrivers.includes(driver)
    ) {
      throw new Error(
        `runtime adapter ${revision.manifest.adapter.kind} does not implement recovery driver ${driver}`,
      );
    }
    const runtime = implementation.create(revision, options);
    if (runtime.recover === undefined) {
      throw new Error(
        `runtime recovery driver has no recover operation: ${driver}`,
      );
    }
    return runtime;
  }
}

function createGenericProcessRuntime(
  revision: RuntimeProfileRevision,
  options: RuntimeCreationOptions,
  probeReport?: RuntimeProfileProbeReport,
): GenericProcessAdapter {
  const config = revision.manifest.adapter.config;
  const executableIdentity = probeReport?.executableIdentity;
  return new GenericProcessAdapter({
    ...options,
    args: revision.manifest.adapter.fixedArgs,
    beforeStart: async () => {
      await options.beforeStart?.();
      if (executableIdentity !== undefined) {
        await assertExecutableIdentityCurrent(executableIdentity);
      }
    },
    command:
      executableIdentity?.resolvedExecutablePath ??
      revision.manifest.adapter.executable,
    ...(executableIdentity === undefined
      ? {}
      : { expectedExecutableIdentity: executableIdentity }),
    ...(config.completedRunRetention === undefined
      ? {}
      : { completedRunRetention: config.completedRunRetention }),
    ...(config.diagnosticByteLimit === undefined
      ? {}
      : { diagnosticByteLimit: config.diagnosticByteLimit }),
    env:
      revision.manifest.manifestVersion === 2
        ? revision.manifest.staticEnv
        : {},
    recoveryProvenance: {
      recoveryDriverImplementationVersions: Object.fromEntries(
        revision.manifest.recoveryDrivers.map((driver) => {
          if (driver !== PROCESS_SUPERVISOR_DRIVER) {
            throw new Error(`unsupported runtime recovery driver: ${driver}`);
          }
          return [driver, PROCESS_SUPERVISOR_IMPLEMENTATION_VERSION];
        }),
      ),
      runtimeProfileDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    },
    ...(config.supervisorControlTimeoutMs === undefined
      ? {}
      : { supervisorControlTimeoutMs: config.supervisorControlTimeoutMs }),
    ...(config.supervisorStartupTimeoutMs === undefined
      ? {}
      : { supervisorStartupTimeoutMs: config.supervisorStartupTimeoutMs }),
    ...(config.terminationGraceMs === undefined
      ? {}
      : { terminationGraceMs: config.terminationGraceMs }),
  });
}

export class RuntimeCredentialEnvironmentBinding {
  readonly #manifest: RuntimeProfileManifest;
  readonly #resolvers: Readonly<Record<string, () => Promise<string>>>;

  constructor(input: {
    manifest: RuntimeProfileManifest;
    resolvers: Readonly<Record<string, () => Promise<string>>>;
  }) {
    this.#manifest = structuredClone(input.manifest);
    this.#resolvers = Object.assign(
      Object.create(null) as Record<string, () => Promise<string>>,
      input.resolvers,
    );
    const slots =
      this.#manifest.manifestVersion === 2
        ? this.#manifest.credentialSlots
        : [];
    const slotIds = new Set(slots.map((slot) => slot.slotId));
    for (const slot of slots) {
      if (!Object.hasOwn(this.#resolvers, slot.slotId)) {
        throw new Error(`missing credential slot ${slot.slotId}`);
      }
    }
    for (const slotId of Object.keys(this.#resolvers)) {
      if (!slotIds.has(slotId)) {
        throw new Error(`unknown credential slot ${slotId}`);
      }
    }
  }

  async resolve(): Promise<ActivationEnvironmentLease> {
    const env: Record<string, string> = {};
    const redactions: string[] = [];
    if (this.#manifest.manifestVersion !== 2) return { env, redactions };
    for (const slot of this.#manifest.credentialSlots) {
      if (!Object.hasOwn(this.#resolvers, slot.slotId)) {
        throw new Error(`missing credential slot ${slot.slotId}`);
      }
      const resolver = this.#resolvers[slot.slotId]!;
      const secret = await resolver();
      if (secret.length === 0) {
        throw new Error(`credential slot ${slot.slotId} resolved empty`);
      }
      if (Buffer.byteLength(secret) > MAX_CREDENTIAL_BYTES) {
        throw new Error(
          `credential slot ${slot.slotId} exceeds the safe byte limit`,
        );
      }
      env[slot.target.variable] = secret;
      redactions.push(secret);
    }
    return { env, redactions };
  }
}

export function buildRuntimeOfferFromProfile(input: {
  hostId: string;
  hostInstanceId: string;
  leaseUntil: string;
  maxConcurrent: number;
  observedAt: string;
  probeReport: RuntimeProfileProbeReport;
  runtimeOfferId: string;
  runtimeProfileRevision: RuntimeProfileRevision;
  state: RuntimeOfferState;
}): RuntimeOffer {
  const revision = validateRuntimeProfileRevision(input.runtimeProfileRevision);
  const report = input.probeReport;
  if (revision.state !== "active") {
    throw new Error(
      `RuntimeProfileRevision ${revision.runtimeProfileRevisionId} is not active`,
    );
  }
  validateMatchingProbeReport(revision, report, input.state === "available");
  return RuntimeOfferSchema.parse({
    capabilityEvidence: [...revision.manifest.declaredCapabilities]
      .sort()
      .map((capability) => ({ capability, evidence: "declared" as const })),
    capacityPoolIds: [],
    certificationRefs: [],
    hostId: input.hostId,
    hostInstanceId: input.hostInstanceId,
    isolation: { evidence: "declared", level: "none" },
    leaseUntil: input.leaseUntil,
    maxConcurrent: input.maxConcurrent,
    modelBindingDescriptors: [],
    observedAt: input.observedAt,
    probeReportRef: {
      probeDigest: report.probeDigest,
      probeReportId: report.probeReportId,
    },
    protocolFamily: revision.manifest.protocolFamily,
    revisionDigest: revision.contentDigest,
    runtimeOfferId: input.runtimeOfferId,
    runtimeProfileId: revision.runtimeProfileId,
    runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    state: input.state,
    workspaceMountDescriptors: [],
  });
}

function validateRuntimeProfileRevision(
  uncheckedRevision: RuntimeProfileRevision,
): RuntimeProfileRevision {
  const revision = RuntimeProfileRevisionSchema.parse(uncheckedRevision);
  if (
    computeRuntimeProfileManifestDigest(revision.manifest) !==
    revision.contentDigest
  ) {
    throw new Error(
      `RuntimeProfileRevision ${revision.runtimeProfileRevisionId} manifest digest does not match immutable revision`,
    );
  }
  return revision;
}

function validateMatchingProbeReport(
  revision: RuntimeProfileRevision,
  report: RuntimeProfileProbeReport,
  requireAvailable: boolean,
): void {
  const { probeDigest: _discarded, ...reportWithoutDigest } = report;
  if (
    (requireAvailable && !report.available) ||
    report.runtimeProfileId !== revision.runtimeProfileId ||
    report.runtimeProfileRevisionId !== revision.runtimeProfileRevisionId ||
    report.runtimeProfileDigest !== revision.contentDigest ||
    report.adapter.kind !== revision.manifest.adapter.kind ||
    computeRuntimeProfileProbeDigest(reportWithoutDigest) !== report.probeDigest
  ) {
    throw new Error(
      `probe report does not match RuntimeProfileRevision ${revision.runtimeProfileRevisionId}`,
    );
  }
}

type ExecutableResolution = {
  available: boolean;
  failureCode?: RuntimeProfileProbeObservation["failureCode"];
  identity?: NonNullable<RuntimeProfileProbeObservation["executableIdentity"]>;
};

async function resolveExecutableIdentity(
  requestedExecutable: string,
  cwd: string,
  overriddenPath?: string,
): Promise<ExecutableResolution> {
  const candidates = executableCandidates(
    requestedExecutable,
    cwd,
    overriddenPath,
  );
  let lastFailure: NonNullable<RuntimeProfileProbeObservation["failureCode"]> =
    "executable_not_found";
  for (const candidate of candidates) {
    let resolvedPath: string;
    try {
      resolvedPath = await realpath(candidate);
    } catch {
      continue;
    }
    const metadata = await stat(resolvedPath);
    if (!metadata.isFile()) {
      lastFailure = "executable_not_regular_file";
      continue;
    }
    try {
      await access(resolvedPath, constants.X_OK);
    } catch {
      lastFailure = "executable_not_executable";
      continue;
    }
    return {
      available: true,
      identity: {
        byteLength: metadata.size,
        contentDigest: await hashFile(resolvedPath),
        requestedExecutable,
        resolvedExecutablePath: resolvedPath,
      },
    };
  }
  return { available: false, failureCode: lastFailure };
}

async function assertExecutableIdentityCurrent(expected: {
  byteLength: number;
  contentDigest: string;
  resolvedExecutablePath: string;
}): Promise<void> {
  try {
    const resolvedPath = await realpath(expected.resolvedExecutablePath);
    const metadata = await stat(resolvedPath);
    await access(resolvedPath, constants.X_OK);
    if (
      resolvedPath !== expected.resolvedExecutablePath ||
      !metadata.isFile() ||
      metadata.size !== expected.byteLength ||
      (await hashFile(resolvedPath)) !== expected.contentDigest
    ) {
      throw new Error("identity mismatch");
    }
  } catch {
    throw new Error("runtime executable identity changed after probe");
  }
}

function executableCandidates(
  requestedExecutable: string,
  cwd: string,
  overriddenPath?: string,
): string[] {
  if (isAbsolute(requestedExecutable)) return [requestedExecutable];
  if (requestedExecutable.includes("/")) {
    return [resolve(cwd, requestedExecutable)];
  }
  const path = overriddenPath ?? process.env.PATH ?? "";
  return path
    .split(delimiter)
    .filter((entry) => entry.length > 0)
    .map((entry) => resolve(entry, requestedExecutable));
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}
