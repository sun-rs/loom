import { createCodexExecRuntime } from "./codex-exec-runtime.ts";
import {
  createStandingPromptDigestLedger,
  providerSessionKey,
  requireModelBinding,
} from "./provider-runtime-binding.ts";
import { kimiWorkerMcpLease } from "./cold-worker-mcp-lease.ts";
import { claudeWorkerMcpLease } from "./claude-worker-mcp-lease.ts";
import { ProviderSystemMemory } from "./provider-system-memory.ts";
import { createHostBodiedWake, renderBodiedWake } from "./bodied-wake.ts";
import { resumedMemoryIndexLease } from "./channel-memory-index.ts";
import { SessionRulesCard } from "./session-rules-card.ts";
import {
  createSessionProtocolState,
  SessionProtocolUpgrade,
} from "./session-protocol-upgrade.ts";
import { ResolvedModelSchema } from "@rah-os/protocol";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, resolve } from "node:path";
import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";

import type {
  RuntimeOffer,
  RuntimeOfferState,
  ResolvedModel,
  RuntimeModelBinding,
  RuntimeProfileManifest,
  RuntimeProfileProbeReport,
  RuntimeProfileRevision,
  ToolAccessMode,
  WorkspaceMountDescriptor,
} from "@rah-os/protocol";
import {
  RuntimeOfferSchema,
  RuntimeProfileProbeReportSchema,
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
import {
  LocalModelCatalogProbeCache,
  resolveModelBindingArguments,
  resolveModelBindingEnvironment,
} from "./model-catalog-probe.ts";
import {
  resolveRuntimeToolAccessLaunch,
  supportedRuntimeToolAccessModes,
} from "./runtime-tool-access.ts";
import {
  ProviderSessionStore,
  type ProviderSessionKey,
} from "./provider-session-store.ts";
import type { ActivationEnvelope, RuntimeAdapter } from "./runtime.ts";
import {
  CLAUDE_WARM_DRIVER,
  CODEX_WARM_DRIVER,
  CodexWarmAdapter,
  OPENCODE_WARM_DRIVER,
  type WarmDriverDescriptor,
  type WarmWorkerCredential,
} from "./codex-warm-adapter.ts";
import type { InstanceRuntimePool } from "./instance-runtime-pool.ts";

const GENERIC_PROCESS_IMPLEMENTATION_VERSION = "generic-process-adapter/v1";
const CLAUDE_STREAM_JSON_IMPLEMENTATION_VERSION =
  "claude-stream-json-driver/v1";
const CODEX_APP_SERVER_IMPLEMENTATION_VERSION = "codex-app-server-driver/v1";
const KIMI_ACP_IMPLEMENTATION_VERSION = "kimi-acp-driver/v1";
const OPENCODE_SERVER_IMPLEMENTATION_VERSION = "opencode-server-driver/v1";
const PROCESS_SUPERVISOR_DRIVER = "rah-process-supervisor-v1";
const PROCESS_SUPERVISOR_IMPLEMENTATION_VERSION = "rah-process-supervisor/v1";
const MAX_CREDENTIAL_BYTES = 65_536;
const sharedDefaultModelCatalogProbeCache = new LocalModelCatalogProbeCache();
const CLAUDE_STREAM_JSON_DRIVER_PATH = fileURLToPath(
  new URL("./claude-stream-json-driver.mjs", import.meta.url),
);
const CODEX_APP_SERVER_DRIVER_PATH = fileURLToPath(
  new URL("./codex-app-server-driver.mjs", import.meta.url),
);
const KIMI_ACP_DRIVER_PATH = fileURLToPath(
  new URL("./kimi-acp-driver.mjs", import.meta.url),
);
const OPENCODE_SERVER_DRIVER_PATH = fileURLToPath(
  new URL("./opencode-server-driver.mjs", import.meta.url),
);

export type RuntimeCreationOptions = Pick<
  GenericProcessAdapterOptions,
  "activationEnvironment" | "beforeStart" | "cwd" | "supervisorDirectory"
> & {
  /** Explicit ordinary-Codex native-final trial; never converts another profile. */
  nativeFinalText?: boolean;
  /**
   * Owner 2026-09-26: the channel home's Human-attached directories. Each
   * CLI receives them natively (Claude `--add-dir`, Codex workspace roots,
   * Kimi project config); OpenCode gets a standing-prompt line instead.
   */
  additionalDirectories?: readonly string[];
  providerSessionStore?: ProviderSessionStore;
  /**
   * Codex, Claude (S2-c1), Kimi (S2-c2) and OpenCode (S2-c3). Invoked when
   * the driver reports that the runtime accepted the wake injection; the Host
   * turns that into the Host-credential `markPresentedDeliverySent`.
   */
  recordDeliveryAcceptance?: GenericProcessAdapterOptions["recordDeliveryAcceptance"];
};

/**
 * S2-a: what the Host composition supplies for a warm Codex runtime. The
 * runtime-level lease carries prompt, memory, provider configuration and
 * secrets but NO Worker credential; each turn's credential is issued
 * separately and delivered only through that turn's handle.
 */
export type WarmRuntimeCreation = {
  nativeFinalText?: boolean;
  explicitFinalOutput?: boolean;
  issueWorkerCredential: (
    input: ActivationEnvelope,
  ) => Promise<WarmWorkerCredential>;
  pool: InstanceRuntimePool;
  runtimeEnvironment: (
    input: ActivationEnvelope,
  ) => Promise<ActivationEnvironmentLease>;
  workerApiOrigin: string;
};

type RuntimeAdapterImplementation = {
  create: (
    revision: RuntimeProfileRevision,
    options: RuntimeCreationOptions,
    probeReport?: RuntimeProfileProbeReport,
    resolvedModel?: ResolvedModel,
    toolAccessMode?: ToolAccessMode,
  ) => GenericProcessAdapter;
  implementationVersion: string;
  recoveryDrivers: readonly string[];
};

export class RuntimeImplementationRegistry {
  readonly #modelCatalogProbeCache: LocalModelCatalogProbeCache;
  readonly #adapterImplementations = new Map<
    string,
    RuntimeAdapterImplementation
  >();
  readonly #recoveryDriverVersions = new Map<string, string>();

  constructor(
    input: { modelCatalogProbeCache?: LocalModelCatalogProbeCache } = {},
  ) {
    // Multiple registries participate in one Local Core cold start (bootstrap
    // and daemon composition). Reuse catalog evidence by executable digest,
    // kind and cwd while each registry still revalidates executable identity.
    this.#modelCatalogProbeCache =
      input.modelCatalogProbeCache ?? sharedDefaultModelCatalogProbeCache;
    const recoveryDrivers =
      process.platform === "win32" ? [] : [PROCESS_SUPERVISOR_DRIVER];
    this.#adapterImplementations.set("generic-process/v1", {
      create: (revision, options, probeReport, resolvedModel, toolAccessMode) =>
        createGenericProcessRuntime(
          revision,
          options,
          probeReport,
          resolvedModel,
          toolAccessMode,
        ),
      implementationVersion: GENERIC_PROCESS_IMPLEMENTATION_VERSION,
      recoveryDrivers,
    });
    this.#adapterImplementations.set("claude-stream-json/v1", {
      create: (revision, options, probeReport, resolvedModel, toolAccessMode) =>
        createClaudeStreamJsonRuntime(
          revision,
          options,
          probeReport,
          resolvedModel,
          toolAccessMode,
        ),
      implementationVersion: CLAUDE_STREAM_JSON_IMPLEMENTATION_VERSION,
      recoveryDrivers,
    });
    this.#adapterImplementations.set("codex-exec/v1", {
      create: createCodexExecRuntime,
      implementationVersion: "codex-exec-driver/v1",
      recoveryDrivers,
    });
    this.#adapterImplementations.set("codex-app-server/v1", {
      create: (revision, options, probeReport, resolvedModel, toolAccessMode) =>
        createCodexAppServerRuntime(
          revision,
          options,
          probeReport,
          resolvedModel,
          toolAccessMode,
        ),
      implementationVersion: CODEX_APP_SERVER_IMPLEMENTATION_VERSION,
      recoveryDrivers,
    });
    this.#adapterImplementations.set("kimi-acp/v1", {
      create: (revision, options, probeReport, resolvedModel, toolAccessMode) =>
        createKimiAcpRuntime(
          revision,
          options,
          probeReport,
          resolvedModel,
          toolAccessMode,
        ),
      implementationVersion: KIMI_ACP_IMPLEMENTATION_VERSION,
      recoveryDrivers,
    });
    this.#adapterImplementations.set("opencode-server/v1", {
      create: (revision, options, probeReport, resolvedModel, toolAccessMode) =>
        createOpenCodeServerRuntime(
          revision,
          options,
          probeReport,
          resolvedModel,
          toolAccessMode,
        ),
      implementationVersion: OPENCODE_SERVER_IMPLEMENTATION_VERSION,
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

  /**
   * Cheap RuntimeOffer lease validation. This deliberately avoids catalog
   * discovery and file hashing; every actual process start still executes the
   * exact SHA-256 fence in assertExecutableIdentityCurrent.
   */
  async probeReportAppearsRunnable(
    revision: RuntimeProfileRevision,
    probeReport: RuntimeProfileProbeReport,
  ): Promise<boolean> {
    revision = validateRuntimeProfileRevision(revision);
    probeReport = RuntimeProfileProbeReportSchema.parse(probeReport);
    if (
      revision.state !== "active" ||
      !probeReport.available ||
      probeReport.runtimeProfileRevisionId !==
        revision.runtimeProfileRevisionId ||
      probeReport.runtimeProfileDigest !== revision.contentDigest ||
      probeReport.adapter.kind !== revision.manifest.adapter.kind ||
      probeReport.executableIdentity === undefined
    ) {
      return false;
    }
    return await executableIdentityMetadataMatches(
      probeReport.executableIdentity,
    );
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
        modelBindings: [],
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
        modelBindings: [],
        recoveryDrivers,
        runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
      });
    }

    const executable = await resolveExecutableIdentity(
      manifest.adapter.executable,
      input.cwd,
      manifest.manifestVersion === 1 ? undefined : manifest.staticEnv.PATH,
    );
    let modelBindings: RuntimeModelBinding[] = [];
    if (
      executable.available &&
      executable.identity !== undefined &&
      manifest.manifestVersion === 3
    ) {
      try {
        modelBindings = await this.#modelCatalogProbeCache.probe({
          cwd: input.cwd,
          executableContentDigest: executable.identity.contentDigest,
          executablePath: executable.identity.resolvedExecutablePath,
          kind: manifest.modelCatalogProbe.kind,
        });
      } catch {
        // A machine-readable catalog is optional capability evidence. The
        // exact executable identity and recovery implementation have already
        // passed their hard gates, so a transient/offline catalog failure
        // must not take the entire runtime (or Local Core) down. With no
        // bindings the planner can only use the provider's default model and
        // cannot fabricate model/effort argv.
        return issueRuntimeProfileProbeObservation({
          adapter: {
            implementationVersion: adapterImplementation.implementationVersion,
            kind: manifest.adapter.kind,
          },
          available: executable.available,
          contentDigest: revision.contentDigest,
          executableIdentity: executable.identity,
          modelBindings: [],
          recoveryDrivers,
          runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
        });
      }
    }
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
      modelBindings,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
  }

  createRuntime(
    revision: RuntimeProfileRevision,
    probeReport: RuntimeProfileProbeReport,
    options: RuntimeCreationOptions,
    resolvedModel?: ResolvedModel,
    toolAccessMode?: ToolAccessMode,
  ): GenericProcessAdapter {
    if (resolvedModel?.source === "custom_model")
      ResolvedModelSchema.parse(resolvedModel);
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
    if (
      resolvedModel?.source === "custom_model" &&
      customModelRuntime(revision) !== resolvedModel.runtime
    )
      throw new Error("custom model does not match native runtime");
    return implementation.create(
      revision,
      options,
      probeReport,
      resolvedModel,
      toolAccessMode,
    );
  }

  /**
   * S2-a Codex / S2-c1 Claude / S2-c3 OpenCode warm process per Role
   * instance. Legacy Agents (no instance channel) keep the per-turn adapter
   * this wraps; other drivers are refused.
   */
  createWarmRuntime(
    revision: RuntimeProfileRevision,
    probeReport: RuntimeProfileProbeReport,
    options: RuntimeCreationOptions,
    warm: WarmRuntimeCreation,
    resolvedModel?: ResolvedModel,
    toolAccessMode?: ToolAccessMode,
  ): RuntimeAdapter {
    const driver =
      revision.manifest.adapter.kind === "codex-app-server/v1"
        ? CODEX_WARM_DRIVER
        : revision.manifest.adapter.kind === "claude-stream-json/v1"
          ? CLAUDE_WARM_DRIVER
          : revision.manifest.adapter.kind === "opencode-server/v1"
            ? OPENCODE_WARM_DRIVER
            : undefined;
    if (driver === undefined)
      throw new Error(
        `warm runtimes support codex-app-server/v1, claude-stream-json/v1 and opencode-server/v1 only; received ${revision.manifest.adapter.kind}`,
      );
    const legacy = this.createRuntime(
      revision,
      probeReport,
      options,
      resolvedModel,
      toolAccessMode,
    );
    return createWarmInstanceRuntime(
      driver,
      validateRuntimeProfileRevision(revision),
      probeReport,
      options,
      warm,
      legacy,
      resolvedModel,
    );
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
  resolvedModel?: ResolvedModel,
  toolAccessMode?: ToolAccessMode,
): GenericProcessAdapter {
  const config = revision.manifest.adapter.config;
  const executableIdentity = probeReport?.executableIdentity;
  const modelArguments =
    resolvedModel?.source === "explicit_binding"
      ? resolveModelBindingArguments(
          requireModelBinding(probeReport, resolvedModel.modelBindingId),
          resolvedModel,
        )
      : [];
  const modelEnvironment =
    resolvedModel?.source === "explicit_binding"
      ? resolveModelBindingEnvironment(
          requireModelBinding(probeReport, resolvedModel.modelBindingId),
          resolvedModel,
        )
      : {};
  const toolAccessLaunch = resolveRuntimeToolAccessLaunch(
    revision.manifest.manifestVersion === 3
      ? revision.manifest.modelCatalogProbe.kind
      : undefined,
    toolAccessMode ?? "full_access",
  );
  const {
    additionalDirectories: _genericAttached,
    recordDeliveryAcceptance: _generic,
    ...genericOptions
  } = options;
  return new GenericProcessAdapter({
    ...genericOptions,
    args: [
      ...modelArguments,
      ...toolAccessLaunch.args,
      ...revision.manifest.adapter.fixedArgs,
    ],
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
      revision.manifest.manifestVersion === 1
        ? { ...modelEnvironment, ...toolAccessLaunch.env }
        : {
            ...revision.manifest.staticEnv,
            ...modelEnvironment,
            ...toolAccessLaunch.env,
          },
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

/**
 * Raft-compatible Claude Code stream-json lifecycle with stronger input
 * acceptance and cancellation/session evidence. Provider session identity is
 * Host-private and can never reconstruct canonical Room history.
 */
function createClaudeStreamJsonRuntime(
  revision: RuntimeProfileRevision,
  options: RuntimeCreationOptions,
  probeReport?: RuntimeProfileProbeReport,
  resolvedModel?: ResolvedModel,
  toolAccessMode?: ToolAccessMode,
): GenericProcessAdapter {
  if (revision.manifest.manifestVersion !== 3) {
    throw new Error(
      "claude-stream-json/v1 requires RuntimeProfile manifest v3",
    );
  }
  if (revision.manifest.modelCatalogProbe.kind !== "claude-cli/v1") {
    throw new Error(
      "claude-stream-json/v1 requires the claude-cli/v1 capability probe",
    );
  }
  if (revision.manifest.adapter.fixedArgs.length > 1) {
    throw new Error(
      "claude-stream-json/v1 accepts at most one legacy fixed Room worker prompt",
    );
  }
  const mode = toolAccessMode ?? "full_access";
  if (mode !== "full_access") {
    throw new Error(
      `claude-stream-json/v1 standard Raft policy requires full_access; received ${mode}`,
    );
  }
  const executableIdentity = probeReport?.executableIdentity;
  const config = revision.manifest.adapter.config;
  const {
    activationEnvironment: baseActivationEnvironment,
    additionalDirectories,
    providerSessionStore,
    recordDeliveryAcceptance,
    ...processOptions
  } = options;
  const args = [
    isSea() ? "__claude-stream-json-driver" : CLAUDE_STREAM_JSON_DRIVER_PATH,
    "--executable",
    executableIdentity?.resolvedExecutablePath ??
      revision.manifest.adapter.executable,
    "--tool-access-mode",
    mode,
    // A legacy frozen manifest still carries the standing prompt here. The
    // daemon standing prompt lease appends a later `--prompt` that wins under
    // every driver's last-wins flag loop; an empty fixedArgs sends only that
    // one copy.
    ...(revision.manifest.adapter.fixedArgs[0] === undefined
      ? []
      : ["--prompt", revision.manifest.adapter.fixedArgs[0]]),
    ...attachedDirectoryDriverArgs(additionalDirectories),
  ];
  if (resolvedModel?.source === "custom_model") {
    args.push("--model", resolvedModel.modelId);
    if (resolvedModel.reasoning) args.push("--effort", resolvedModel.reasoning);
  }
  if (resolvedModel?.source === "explicit_binding") {
    requireModelBinding(probeReport, resolvedModel.modelBindingId);
    args.push("--model", resolvedModel.modelId);
    if (
      resolvedModel.reasoning !== undefined &&
      resolvedModel.reasoning !== "default"
    ) {
      args.push("--effort", resolvedModel.reasoning);
    }
  }
  const systemMemory = new ProviderSystemMemory();
  const standingPromptDigests = createStandingPromptDigestLedger();
  const protocolUpgrade = new SessionProtocolUpgrade(providerSessionStore);
  // S2-c1: the driver's replay echo of the wake's own uuid is the acceptance.
  const wake = createHostBodiedWake({
    provider: "claude-stream-json/v1",
    recordDeliveryAcceptance,
  });
  return new GenericProcessAdapter({
    ...processOptions,
    acceptSessionProtocol: async (input) => await protocolUpgrade.accept(input),
    nativeBusyInput: true,
    // The driver ends the turn with the native stream-json interrupt.
    finalReplyInterrupt: true,
    guideRuntimeId: "claude",
    busyInputMode: "direct",
    ...(wake.enabled ? { beforeLaunch: wake.beforeLaunch } : {}),
    ...(wake.recordDeliveryAcceptance === undefined
      ? {}
      : { recordDeliveryAcceptance: wake.recordDeliveryAcceptance }),
    activationEnvironment: async (input) => {
      const lease = await claudeWorkerMcpLease(
        input.runAttemptId,
        (await baseActivationEnvironment?.(input)) ?? { env: {} },
      );
      standingPromptDigests.remember(input, lease.standingPromptDigest);
      const key = providerSessionKey(
        input,
        revision,
        "claude-stream-json/v1",
        lease.standingPromptDigest,
      );
      if (providerSessionStore === undefined || key === undefined)
        return await wake.withBodiedWake(input, lease);
      const previous =
        (await providerSessionStore.load(key, {
          requireExisting: input.agent?.instanceSessionRequired === true,
          instance: input.agent?.instanceChannelId !== undefined,
          instanceGeneration: input.agent?.instanceSessionGeneration,
        })) ??
        (lease.compatibleStandingPromptDigest === undefined
          ? null
          : await providerSessionStore.load({
              ...key,
              standingPromptDigest: lease.compatibleStandingPromptDigest,
            }));
      const preparedLease = systemMemory.prepare(
        input.runAttemptId,
        lease,
        previous,
      );
      const protocolNotice = protocolUpgrade.prepare(
        input,
        lease,
        key,
        previous,
      );
      if (previous === null)
        return await wake.withBodiedWake(input, preparedLease);
      return await wake.withBodiedWake(input, {
        ...protocolUpgrade.withNotice(preparedLease, protocolNotice),
        args: [
          ...(lease.args ?? []),
          "--resume-session",
          previous.providerSessionId,
        ],
      });
    },
    args,
    beforeStart: async () => {
      await options.beforeStart?.();
      if (executableIdentity !== undefined) {
        await assertExecutableIdentityCurrent(executableIdentity);
      }
    },
    command: process.execPath,
    ...(config.completedRunRetention === undefined
      ? {}
      : { completedRunRetention: config.completedRunRetention }),
    ...(config.diagnosticByteLimit === undefined
      ? {}
      : { diagnosticByteLimit: config.diagnosticByteLimit }),
    env: { ...revision.manifest.staticEnv },
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
    ...(providerSessionStore === undefined
      ? {}
      : {
          recordProviderSessionEvidence: async (input, evidence) => {
            if (evidence.provider !== "claude-stream-json/v1") {
              throw new Error(
                `unexpected Provider session evidence: ${evidence.provider}`,
              );
            }
            const key = providerSessionKey(
              input,
              revision,
              "claude-stream-json/v1",
              standingPromptDigests.digestFor(input),
            );
            if (key !== undefined) {
              await providerSessionStore.record(
                key,
                evidence.providerSessionId,
                {
                  instance: input.agent?.instanceChannelId !== undefined,
                  instanceGeneration: input.agent?.instanceSessionGeneration,
                  standingProtocolVersion:
                    protocolUpgrade.currentVersion(input),
                  systemMemorySha256: systemMemory.evidence(
                    input.runAttemptId,
                    evidence.providerSessionId,
                  ),
                },
              );
            }
          },
        }),
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

/**
 * Native Codex app-server lifecycle aligned with the current generated
 * protocol plus Raft and Multica's unattended approval handling. Provider
 * thread identity is a Host-private continuity cache and turn identity stays
 * process-local; Room -> Inbox -> Activation remains the only durable business
 * lifecycle.
 */
function createCodexAppServerRuntime(
  revision: RuntimeProfileRevision,
  options: RuntimeCreationOptions,
  probeReport?: RuntimeProfileProbeReport,
  resolvedModel?: ResolvedModel,
  toolAccessMode?: ToolAccessMode,
): GenericProcessAdapter {
  if (revision.manifest.manifestVersion !== 3) {
    throw new Error("codex-app-server/v1 requires RuntimeProfile manifest v3");
  }
  if (revision.manifest.modelCatalogProbe.kind !== "codex-cli/v1") {
    throw new Error(
      "codex-app-server/v1 requires the codex-cli/v1 capability probe",
    );
  }
  if (revision.manifest.adapter.fixedArgs.length > 1) {
    throw new Error(
      "codex-app-server/v1 accepts at most one legacy fixed Room worker prompt",
    );
  }
  const mode = toolAccessMode ?? "full_access";
  if (mode !== "full_access") {
    throw new Error(
      `codex-app-server/v1 standard Raft policy requires full_access; received ${mode}`,
    );
  }
  const executableIdentity = probeReport?.executableIdentity;
  const config = revision.manifest.adapter.config;
  const {
    activationEnvironment: baseActivationEnvironment,
    additionalDirectories,
    providerSessionStore,
    recordDeliveryAcceptance,
    ...processOptions
  } = options;
  const args = [
    isSea() ? "__codex-app-server-driver" : CODEX_APP_SERVER_DRIVER_PATH,
    "--executable",
    executableIdentity?.resolvedExecutablePath ??
      revision.manifest.adapter.executable,
    "--tool-access-mode",
    mode,
    // A legacy frozen manifest still carries the standing prompt here. The
    // daemon standing prompt lease appends a later `--prompt` that wins under
    // every driver's last-wins flag loop; an empty fixedArgs sends only that
    // one copy.
    ...(revision.manifest.adapter.fixedArgs[0] === undefined
      ? []
      : ["--prompt", revision.manifest.adapter.fixedArgs[0]]),
    ...attachedDirectoryDriverArgs(additionalDirectories),
  ];
  if (resolvedModel?.source === "custom_model") {
    args.push("--model", resolvedModel.modelId);
  }
  if (resolvedModel?.source === "explicit_binding") {
    requireModelBinding(probeReport, resolvedModel.modelBindingId);
    args.push("--model", resolvedModel.modelId);
    if (
      resolvedModel.reasoning !== undefined &&
      resolvedModel.reasoning !== "default"
    ) {
      args.push("--reasoning", resolvedModel.reasoning);
    }
  }
  const systemMemory = new ProviderSystemMemory();
  const standingPromptDigests = createStandingPromptDigestLedger();
  const protocolUpgrade = new SessionProtocolUpgrade(providerSessionStore);
  // S1-d: the bodied wake needs the Host to register the driver's acceptance;
  // without that registration a presented window can never confirm delivery.
  const wake = createHostBodiedWake({
    provider: "codex-app-server/v1",
    recordDeliveryAcceptance,
  });
  const withBodiedWake = wake.withBodiedWake;
  return new GenericProcessAdapter({
    ...processOptions,
    nativeBusyInput: true,
    finalReplyInterrupt: true,
    guideRuntimeId: "codex",
    busyInputMode: "direct",
    acceptSessionProtocol: async (input) => await protocolUpgrade.accept(input),
    ...(wake.enabled ? { beforeLaunch: wake.beforeLaunch } : {}),
    activationEnvironment: async (input) => {
      const lease = (await baseActivationEnvironment?.(input)) ?? { env: {} };
      standingPromptDigests.remember(input, lease.standingPromptDigest);
      const key = providerSessionKey(
        input,
        revision,
        "codex-app-server/v1",
        lease.standingPromptDigest,
      );
      if (providerSessionStore === undefined || key === undefined)
        return await withBodiedWake(input, lease);
      const previous = await providerSessionStore.load(key, {
        requireExisting: input.agent?.instanceSessionRequired === true,
        instance: input.agent?.instanceChannelId !== undefined,
        instanceGeneration: input.agent?.instanceSessionGeneration,
      });
      const preparedLease = protocolUpgrade.withNotice(
        systemMemory.prepare(input.runAttemptId, lease, previous),
        protocolUpgrade.prepare(input, lease, key, previous),
      );
      if (previous === null) return await withBodiedWake(input, preparedLease);
      return await withBodiedWake(input, {
        ...preparedLease,
        args: [
          ...(lease.args ?? []),
          "--resume-session",
          previous.providerSessionId,
        ],
      });
    },
    args,
    beforeStart: async () => {
      await options.beforeStart?.();
      if (executableIdentity !== undefined) {
        await assertExecutableIdentityCurrent(executableIdentity);
      }
    },
    command: process.execPath,
    ...(config.completedRunRetention === undefined
      ? {}
      : { completedRunRetention: config.completedRunRetention }),
    ...(config.diagnosticByteLimit === undefined
      ? {}
      : { diagnosticByteLimit: config.diagnosticByteLimit }),
    env: { ...revision.manifest.staticEnv },
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
    ...(wake.recordDeliveryAcceptance === undefined
      ? {}
      : { recordDeliveryAcceptance: wake.recordDeliveryAcceptance }),
    ...(providerSessionStore === undefined
      ? {}
      : {
          recordProviderSessionEvidence: async (input, evidence) => {
            if (evidence.provider !== "codex-app-server/v1") {
              throw new Error(
                `unexpected Provider session evidence: ${evidence.provider}`,
              );
            }
            const key = providerSessionKey(
              input,
              revision,
              "codex-app-server/v1",
              standingPromptDigests.digestFor(input),
            );
            if (key !== undefined) {
              await providerSessionStore.record(
                key,
                evidence.providerSessionId,
                {
                  instance: input.agent?.instanceChannelId !== undefined,
                  instanceGeneration: input.agent?.instanceSessionGeneration,
                  standingProtocolVersion:
                    protocolUpgrade.currentVersion(input),
                  systemMemorySha256: systemMemory.evidence(
                    input.runAttemptId,
                    evidence.providerSessionId,
                  ),
                },
              );
            }
          },
        }),
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

function createWarmInstanceRuntime(
  driver: WarmDriverDescriptor,
  revision: RuntimeProfileRevision,
  probeReport: RuntimeProfileProbeReport,
  options: RuntimeCreationOptions,
  warm: WarmRuntimeCreation,
  legacy: GenericProcessAdapter,
  resolvedModel?: ResolvedModel,
): CodexWarmAdapter {
  const executableIdentity = probeReport.executableIdentity;
  const store = options.providerSessionStore;
  // Review batch 1 #6: the production resolver builds this adapter for every
  // claim while the pool keeps the runtime, so what a cold start prepares
  // for the runtime's later turns lives with the pool (per driver).
  const launchState = warm.pool.shared(`warm-launch:${driver.kind}`, () => ({
    // The system-memory snapshot is prepared once per process (cold start).
    coldStartRun: new Map<string, string>(),
    protocol: createSessionProtocolState(),
    systemMemory: new ProviderSystemMemory(),
  }));
  const { coldStartRun, systemMemory } = launchState;
  const provider = driver.provider;
  const recordDeliveryAcceptance = options.recordDeliveryAcceptance;
  // P2-3: the warm turn text is Host-composed, so the line is appended per
  // turn (`protocolNotice`) rather than through the process environment.
  const protocolUpgrade = new SessionProtocolUpgrade(
    store,
    launchState.protocol,
  );
  return new CodexWarmAdapter({
    driver,
    ...(warm.explicitFinalOutput === true ? { explicitFinalOutput: true } : {}),
    ...(warm.nativeFinalText === true ? { nativeFinalText: true } : {}),
    acceptSessionProtocol: async (input) => await protocolUpgrade.accept(input),
    protocolNotice: (input) => protocolUpgrade.noticeFor(input),
    // S2-b: an idle runtime restarts when the probed binary changes.
    ...(executableIdentity?.resolvedExecutablePath === undefined
      ? {}
      : { cliExecutable: executableIdentity.resolvedExecutablePath }),
    cwd: options.cwd,
    driverArgs: [
      "--executable",
      executableIdentity?.resolvedExecutablePath ??
        revision.manifest.adapter.executable,
      "--tool-access-mode",
      "full_access",
      ...(revision.manifest.adapter.fixedArgs[0] === undefined
        ? []
        : ["--prompt", revision.manifest.adapter.fixedArgs[0]]),
      ...(driver === CLAUDE_WARM_DRIVER || driver === CODEX_WARM_DRIVER
        ? attachedDirectoryDriverArgs(options.additionalDirectories)
        : []),
    ],
    env:
      revision.manifest.manifestVersion === 1
        ? {}
        : { ...revision.manifest.staticEnv },
    issueWorkerCredential: warm.issueWorkerCredential,
    legacy,
    pool: warm.pool,
    ...(resolvedModel === undefined ? {} : { resolvedModel }),
    runtimeEnvironment: async (input) => {
      await options.beforeStart?.();
      if (executableIdentity !== undefined)
        await assertExecutableIdentityCurrent(executableIdentity);
      const lease = await warm.runtimeEnvironment(input);
      const key = providerSessionKey(
        input,
        revision,
        provider,
        lease.standingPromptDigest,
      );
      if (store === undefined || key === undefined) return lease;
      const previous = await store.load(key, {
        requireExisting: input.agent?.instanceSessionRequired === true,
        instance: input.agent?.instanceChannelId !== undefined,
        instanceGeneration: input.agent?.instanceSessionGeneration,
      });
      coldStartRun.set(input.participantId, input.runAttemptId);
      protocolUpgrade.prepare(input, lease, key, previous);
      const prepared = systemMemory.prepare(
        input.runAttemptId,
        lease,
        previous,
      );
      return previous === null
        ? prepared
        : {
            ...prepared,
            args: [
              ...(lease.args ?? []),
              "--resume-session",
              previous.providerSessionId,
            ],
          };
    },
    // Anything that changes what the process was launched with restarts it
    // at an idle boundary. Codex sends model and effort per turn; for Claude
    // they are launch arguments and part of the key.
    runtimeKey: (input) =>
      JSON.stringify([
        input.participantId,
        revision.runtimeProfileRevisionId,
        revision.contentDigest,
        input.agent?.agentDefinitionRevision.contentDigest ?? null,
        input.agent?.instanceSessionGeneration ?? null,
        input.contextManifest?.placement?.workspaceMountRevisionId ?? null,
        options.cwd,
        [...(options.additionalDirectories ?? [])],
        ...(driver === CLAUDE_WARM_DRIVER
          ? [driver.kind, resolvedModel === undefined ? null : resolvedModel]
          : []),
      ]),
    workerApiOrigin: warm.workerApiOrigin,
    ...(recordDeliveryAcceptance === undefined
      ? {}
      : {
          recordDeliveryAcceptance,
          renderWake: async (input) => await renderBodiedWake(input),
        }),
    ...(store === undefined
      ? {}
      : {
          recordProviderSessionEvidence: async (
            input: ActivationEnvelope,
            evidence: { provider: string; providerSessionId: string },
            standingPromptDigest: string | undefined,
          ) => {
            if (evidence.provider !== provider)
              throw new Error(
                `unexpected Provider session evidence: ${evidence.provider}`,
              );
            const key = providerSessionKey(
              input,
              revision,
              provider,
              standingPromptDigest,
            );
            if (key === undefined) return;
            await store.record(key, evidence.providerSessionId, {
              instance: input.agent?.instanceChannelId !== undefined,
              instanceGeneration: input.agent?.instanceSessionGeneration,
              systemMemorySha256: systemMemory.evidence(
                coldStartRun.get(input.participantId) ?? input.runAttemptId,
                evidence.providerSessionId,
              ),
              standingProtocolVersion: protocolUpgrade.currentVersion(input),
            });
          },
        }),
  });
}

/**
 * Structured port of Multica's Kimi ACP lifecycle at commit
 * 64ec7f54163d918d5d7fd4dcae857f241b7842d0. Provider session continuity is
 * Host-private transport evidence; the durable product owner remains the
 * Room -> Inbox -> Activation chain.
 */
function createKimiAcpRuntime(
  revision: RuntimeProfileRevision,
  options: RuntimeCreationOptions,
  probeReport?: RuntimeProfileProbeReport,
  resolvedModel?: ResolvedModel,
  toolAccessMode?: ToolAccessMode,
): GenericProcessAdapter {
  if (revision.manifest.manifestVersion !== 3) {
    throw new Error("kimi-acp/v1 requires RuntimeProfile manifest v3");
  }
  if (revision.manifest.modelCatalogProbe.kind !== "kimi-cli/v1") {
    throw new Error("kimi-acp/v1 requires the kimi-cli/v1 capability probe");
  }
  if (revision.manifest.adapter.fixedArgs.length > 1) {
    throw new Error(
      "kimi-acp/v1 accepts at most one legacy fixed Room worker prompt",
    );
  }
  const mode = toolAccessMode ?? "full_access";
  // The ACP client currently has a truthful headless policy only for full
  // access. Restricted modes fail closed instead of claiming a sandbox the
  // installed Kimi runtime does not provide.
  if (mode !== "full_access") {
    throw new Error(
      `kimi-acp/v1 does not yet enforce ${mode}; restricted execution fails closed`,
    );
  }
  const executableIdentity = probeReport?.executableIdentity;
  const config = revision.manifest.adapter.config;
  const {
    activationEnvironment: baseActivationEnvironment,
    additionalDirectories,
    providerSessionStore,
    recordDeliveryAcceptance,
    ...processOptions
  } = options;
  const args = [
    isSea() ? "__kimi-acp-driver" : KIMI_ACP_DRIVER_PATH,
    "--executable",
    executableIdentity?.resolvedExecutablePath ??
      revision.manifest.adapter.executable,
    "--tool-access-mode",
    mode,
    // A legacy frozen manifest still carries the standing prompt here. The
    // daemon standing prompt lease appends a later `--prompt` that wins under
    // every driver's last-wins flag loop; an empty fixedArgs sends only that
    // one copy.
    ...(revision.manifest.adapter.fixedArgs[0] === undefined
      ? []
      : ["--prompt", revision.manifest.adapter.fixedArgs[0]]),
    ...attachedDirectoryDriverArgs(additionalDirectories),
  ];
  if (resolvedModel?.source === "explicit_binding") {
    requireModelBinding(probeReport, resolvedModel.modelBindingId);
    args.push("--model", resolvedModel.modelId);
    if (
      resolvedModel.reasoning !== undefined &&
      resolvedModel.reasoning !== "default"
    ) {
      args.push("--thinking-level", resolvedModel.reasoning);
    }
  }
  const standingPromptDigests = createStandingPromptDigestLedger();
  const protocolUpgrade = new SessionProtocolUpgrade(providerSessionStore);
  // S2-c2: Kimi ACP has no system layer; the rules card follows compaction.
  const rulesCard = new SessionRulesCard(providerSessionStore);
  const preparedCards = new Map<string, string>();
  // S2-c2: the driver's first turn-scoped model update is the acceptance.
  const wake = createHostBodiedWake({
    provider: "kimi-acp/v1",
    recordDeliveryAcceptance,
    wakePreface: (input) => preparedCards.get(input.runAttemptId),
  });
  return new GenericProcessAdapter({
    ...processOptions,
    acceptSessionProtocol: async (input) => {
      await protocolUpgrade.accept(input);
      await rulesCard.accept(input);
    },
    // The driver ends the prompt with the native ACP `session/cancel`.
    finalReplyInterrupt: true,
    beforeLaunch: wake.beforeLaunch,
    ...(wake.recordDeliveryAcceptance === undefined
      ? {}
      : { recordDeliveryAcceptance: wake.recordDeliveryAcceptance }),
    activationEnvironment: async (input) => {
      const lease = await kimiWorkerMcpLease(
        input.runAttemptId,
        (await baseActivationEnvironment?.(input)) ?? { env: {} },
      );
      standingPromptDigests.remember(input, lease.standingPromptDigest);
      preparedCards.delete(input.runAttemptId);
      const key = providerSessionKey(
        input,
        revision,
        "kimi-acp/v1",
        lease.standingPromptDigest,
      );
      if (providerSessionStore === undefined || key === undefined)
        return await wake.withBodiedWake(input, lease);
      const previous = await providerSessionStore.load(key, {
        requireExisting: input.agent?.instanceSessionRequired === true,
        instance: input.agent?.instanceChannelId !== undefined,
        instanceGeneration: input.agent?.instanceSessionGeneration,
      });
      const protocolNotice = protocolUpgrade.prepare(
        input,
        lease,
        key,
        previous,
      );
      const rules = rulesCard.prepare(
        input,
        key,
        previous,
        protocolNotice !== undefined,
      );
      if (previous === null) return await wake.withBodiedWake(input, lease);
      // S6 batch B: the card also re-provides the channel memory index; a
      // plain resume keeps the index its first prompt carried.
      const resumed = resumedMemoryIndexLease(rules, lease);
      const card = resumed.card;
      if (card !== undefined) {
        if (preparedCards.size >= 64)
          preparedCards.delete(preparedCards.keys().next().value!);
        preparedCards.set(input.runAttemptId, card);
      }
      return await wake.withBodiedWake(input, {
        // The card states the current rules itself; the notice line would
        // only repeat that they changed.
        ...(card === undefined
          ? protocolUpgrade.withNotice(resumed.lease, protocolNotice)
          : resumed.lease),
        args: [
          ...(lease.args ?? []),
          "--resume-session",
          previous.providerSessionId,
        ],
      });
    },
    args,
    beforeStart: async () => {
      await options.beforeStart?.();
      if (executableIdentity !== undefined) {
        await assertExecutableIdentityCurrent(executableIdentity);
      }
    },
    command: process.execPath,
    ...(config.completedRunRetention === undefined
      ? {}
      : { completedRunRetention: config.completedRunRetention }),
    ...(config.diagnosticByteLimit === undefined
      ? {}
      : { diagnosticByteLimit: config.diagnosticByteLimit }),
    env: { ...revision.manifest.staticEnv },
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
    ...(providerSessionStore === undefined
      ? {}
      : {
          recordProviderCompaction: async (input, compaction) => {
            if (compaction.provider !== "kimi-acp/v1")
              throw new Error(
                `unexpected Provider compaction: ${compaction.provider}`,
              );
            await rulesCard.observe(
              input,
              providerSessionKey(
                input,
                revision,
                "kimi-acp/v1",
                standingPromptDigests.digestFor(input),
              ),
              compaction,
            );
          },
          recordProviderSessionEvidence: async (input, evidence) => {
            if (evidence.provider !== "kimi-acp/v1") {
              throw new Error(
                `unexpected Provider session evidence: ${evidence.provider}`,
              );
            }
            const key = providerSessionKey(
              input,
              revision,
              "kimi-acp/v1",
              standingPromptDigests.digestFor(input),
            );
            if (key !== undefined) {
              await providerSessionStore.record(
                key,
                evidence.providerSessionId,
                {
                  instance: input.agent?.instanceChannelId !== undefined,
                  instanceGeneration: input.agent?.instanceSessionGeneration,
                  standingProtocolVersion:
                    protocolUpgrade.currentVersion(input),
                },
              );
              await rulesCard.afterBinding(input);
            }
          },
        }),
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

/**
 * Current OpenCode local-server/session transport. It keeps Provider session
 * identity in the Host-private continuity store, uses the official HTTP/SSE
 * control plane for prompt/permission/abort, and leaves Room/Message truth to
 * the Worker API. This deliberately supersedes Raft and Multica's thinner
 * per-turn `opencode run` wrapper while preserving their unattended policy.
 */
function createOpenCodeServerRuntime(
  revision: RuntimeProfileRevision,
  options: RuntimeCreationOptions,
  probeReport?: RuntimeProfileProbeReport,
  resolvedModel?: ResolvedModel,
  toolAccessMode?: ToolAccessMode,
): GenericProcessAdapter {
  if (revision.manifest.manifestVersion !== 3) {
    throw new Error("opencode-server/v1 requires RuntimeProfile manifest v3");
  }
  if (revision.manifest.modelCatalogProbe.kind !== "opencode-cli/v1") {
    throw new Error(
      "opencode-server/v1 requires the opencode-cli/v1 capability probe",
    );
  }
  if (revision.manifest.adapter.fixedArgs.length > 1) {
    throw new Error(
      "opencode-server/v1 accepts at most one legacy fixed Room worker prompt",
    );
  }
  const mode = toolAccessMode ?? "full_access";
  if (mode !== "full_access") {
    throw new Error(
      `opencode-server/v1 standard Raft policy requires full_access; received ${mode}`,
    );
  }
  const executableIdentity = probeReport?.executableIdentity;
  const config = revision.manifest.adapter.config;
  const {
    activationEnvironment: baseActivationEnvironment,
    // OpenCode serve has no attached-directory mechanism (references stay
    // empty on the serve path); the daemon adds a standing-prompt line.
    additionalDirectories: _openCodeAttached,
    providerSessionStore,
    recordDeliveryAcceptance,
    ...processOptions
  } = options;
  const args = [
    isSea() ? "__opencode-server-driver" : OPENCODE_SERVER_DRIVER_PATH,
    "--executable",
    executableIdentity?.resolvedExecutablePath ??
      revision.manifest.adapter.executable,
    "--tool-access-mode",
    mode,
    // A legacy frozen manifest still carries the standing prompt here. The
    // daemon standing prompt lease appends a later `--prompt` that wins under
    // every driver's last-wins flag loop; an empty fixedArgs sends only that
    // one copy.
    ...(revision.manifest.adapter.fixedArgs[0] === undefined
      ? []
      : ["--prompt", revision.manifest.adapter.fixedArgs[0]]),
  ];
  if (resolvedModel?.source === "explicit_binding") {
    requireModelBinding(probeReport, resolvedModel.modelBindingId);
    args.push("--model", resolvedModel.modelId);
    if (
      resolvedModel.reasoning !== undefined &&
      resolvedModel.reasoning !== "default"
    ) {
      args.push("--variant", resolvedModel.reasoning);
    }
  }
  const toolAccess = resolveRuntimeToolAccessLaunch(
    revision.manifest.modelCatalogProbe.kind,
    mode,
  );
  const standingPromptDigests = createStandingPromptDigestLedger();
  const protocolUpgrade = new SessionProtocolUpgrade(providerSessionStore);
  // S2-c3: the first assistant whose parent is the driver's caller-chosen
  // user messageID is the acceptance. The standing rules ride in the server's
  // `instructions` (system layer of every request), so compaction needs no
  // rules card.
  const wake = createHostBodiedWake({
    provider: "opencode-server/v1",
    recordDeliveryAcceptance,
  });
  return new GenericProcessAdapter({
    ...processOptions,
    acceptSessionProtocol: async (input) => await protocolUpgrade.accept(input),
    // The driver ends the run with the native `POST /session/:id/abort`.
    finalReplyInterrupt: true,
    ...(wake.enabled ? { beforeLaunch: wake.beforeLaunch } : {}),
    ...(wake.recordDeliveryAcceptance === undefined
      ? {}
      : { recordDeliveryAcceptance: wake.recordDeliveryAcceptance }),
    activationEnvironment: async (input) => {
      const lease = (await baseActivationEnvironment?.(input)) ?? { env: {} };
      standingPromptDigests.remember(input, lease.standingPromptDigest);
      const key = providerSessionKey(
        input,
        revision,
        "opencode-server/v1",
        lease.standingPromptDigest,
      );
      if (providerSessionStore === undefined || key === undefined)
        return await wake.withBodiedWake(input, lease);
      const previous = await providerSessionStore.load(key, {
        requireExisting: input.agent?.instanceSessionRequired === true,
        instance: input.agent?.instanceChannelId !== undefined,
        instanceGeneration: input.agent?.instanceSessionGeneration,
      });
      const protocolNotice = protocolUpgrade.prepare(
        input,
        lease,
        key,
        previous,
      );
      if (previous === null) return await wake.withBodiedWake(input, lease);
      return await wake.withBodiedWake(input, {
        ...protocolUpgrade.withNotice(lease, protocolNotice),
        args: [
          ...(lease.args ?? []),
          "--resume-session",
          previous.providerSessionId,
        ],
      });
    },
    args,
    beforeStart: async () => {
      await options.beforeStart?.();
      if (executableIdentity !== undefined) {
        await assertExecutableIdentityCurrent(executableIdentity);
      }
    },
    command: process.execPath,
    ...(config.completedRunRetention === undefined
      ? {}
      : { completedRunRetention: config.completedRunRetention }),
    ...(config.diagnosticByteLimit === undefined
      ? {}
      : { diagnosticByteLimit: config.diagnosticByteLimit }),
    env: {
      ...revision.manifest.staticEnv,
      ...toolAccess.env,
    },
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
    ...(providerSessionStore === undefined
      ? {}
      : {
          recordProviderSessionEvidence: async (input, evidence) => {
            if (evidence.provider !== "opencode-server/v1") {
              throw new Error(
                `unexpected Provider session evidence: ${evidence.provider}`,
              );
            }
            const key = providerSessionKey(
              input,
              revision,
              "opencode-server/v1",
              standingPromptDigests.digestFor(input),
            );
            if (key !== undefined) {
              await providerSessionStore.record(
                key,
                evidence.providerSessionId,
                {
                  instance: input.agent?.instanceChannelId !== undefined,
                  instanceGeneration: input.agent?.instanceSessionGeneration,
                  standingProtocolVersion:
                    protocolUpgrade.currentVersion(input),
                },
              );
            }
          },
        }),
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
      this.#manifest.manifestVersion === 1
        ? []
        : this.#manifest.credentialSlots;
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
    if (this.#manifest.manifestVersion === 1) return { env, redactions };
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
  supportsAgentPrivateWorkspace?: boolean;
  hostId: string;
  hostInstanceId: string;
  leaseUntil: string;
  maxConcurrent: number;
  observedAt: string;
  probeReport: RuntimeProfileProbeReport;
  runtimeOfferId: string;
  runtimeProfileRevision: RuntimeProfileRevision;
  state: RuntimeOfferState;
  workspaceMountDescriptors?: WorkspaceMountDescriptor[];
}): RuntimeOffer {
  const revision = validateRuntimeProfileRevision(input.runtimeProfileRevision);
  const report = input.probeReport;
  if (revision.state !== "active") {
    throw new Error(
      `RuntimeProfileRevision ${revision.runtimeProfileRevisionId} is not active`,
    );
  }
  validateMatchingProbeReport(revision, report, input.state === "available");
  const workspaceMountDescriptors = input.workspaceMountDescriptors ?? [];
  for (const descriptor of workspaceMountDescriptors) {
    for (const mode of descriptor.modes) {
      if (!revision.manifest.workspacePolicy.allowedModes.includes(mode)) {
        throw new Error(
          `RuntimeProfileRevision ${revision.runtimeProfileRevisionId} does not allow workspace mode ${mode}`,
        );
      }
    }
  }
  return RuntimeOfferSchema.parse({
    ...(customModelRuntime(revision)
      ? { customModelRuntime: customModelRuntime(revision) }
      : {}),
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
    modelBindingDescriptors:
      report.reportVersion === 2
        ? report.modelBindings.map(({ adapterMapping: _mapping, ...binding }) =>
            structuredClone(binding),
          )
        : [],
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
    supportedToolAccessModes: supportedRuntimeToolAccessModes(
      revision.manifest.adapter.kind,
      revision.manifest.manifestVersion === 3
        ? revision.manifest.modelCatalogProbe.kind
        : undefined,
    ),
    workspaceMountDescriptors,
    ...(input.supportsAgentPrivateWorkspace === undefined
      ? {}
      : { supportsAgentPrivateWorkspace: input.supportsAgentPrivateWorkspace }),
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
    let metadata;
    try {
      metadata = await stat(resolvedPath);
    } catch {
      continue;
    }
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
    try {
      return {
        available: true,
        identity: {
          byteLength: metadata.size,
          contentDigest: await hashFile(resolvedPath),
          requestedExecutable,
          resolvedExecutablePath: resolvedPath,
        },
      };
    } catch {
      continue;
    }
  }
  return { available: false, failureCode: lastFailure };
}

export async function assertExecutableIdentityCurrent(expected: {
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

async function executableIdentityMetadataMatches(expected: {
  byteLength: number;
  resolvedExecutablePath: string;
}): Promise<boolean> {
  try {
    const resolvedPath = await realpath(expected.resolvedExecutablePath);
    if (resolvedPath !== expected.resolvedExecutablePath) return false;
    const metadata = await stat(resolvedPath);
    if (!metadata.isFile() || metadata.size !== expected.byteLength) {
      return false;
    }
    await access(resolvedPath, constants.X_OK);
    return true;
  } catch {
    return false;
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

function customModelRuntime(
  revision: RuntimeProfileRevision,
): "claude" | "codex" | undefined {
  return revision.manifest.adapter.kind === "claude-stream-json/v1"
    ? "claude"
    : revision.manifest.adapter.kind === "codex-app-server/v1" ||
        revision.manifest.adapter.kind === "codex-exec/v1"
      ? "codex"
      : undefined;
}

/** One `--additional-dir <abs>` per attached directory, in creation order. */
function attachedDirectoryDriverArgs(
  directories: readonly string[] | undefined,
): string[] {
  return (directories ?? []).flatMap((directory) => [
    "--additional-dir",
    directory,
  ]);
}
