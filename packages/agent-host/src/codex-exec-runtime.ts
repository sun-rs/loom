import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";
import type {
  RuntimeProfileRevision,
  RuntimeProfileProbeReport,
  ResolvedModel,
  ToolAccessMode,
} from "@rah-os/protocol";
import {
  GenericProcessAdapter,
  type ActivationEnvironmentLease,
} from "./generic-process-adapter.ts";
import type { RuntimeCreationOptions } from "./runtime-implementation-registry.ts";
import { assertExecutableIdentityCurrent } from "./runtime-implementation-registry.ts";
import {
  createStandingPromptDigestLedger,
  providerSessionKey,
  requireModelBinding,
} from "./provider-runtime-binding.ts";
import {
  allocateWakeInputFile,
  renderBodiedWake,
  writeWakeInputFile,
} from "./bodied-wake.ts";
import {
  providerActivationInput,
  withRuntimeNotice,
} from "./provider-activation-input.js";
import {
  RAH_PROTOCOL_NOTICE_ENV,
  SessionProtocolUpgrade,
} from "./session-protocol-upgrade.ts";
import { ProviderSystemMemory } from "./provider-system-memory.ts";
import {
  nativeFinalEnvelope,
  nativeFinalSequence,
} from "./native-final-transport.ts";
import { WorkerFinalOutput } from "./worker-final-output.ts";
import {
  RAH_WORKER_API_URL_ENV,
  RAH_WORKER_SESSION_FILE_ENV,
} from "./worker-credential-file.ts";

const PROVIDER = "codex-exec/v1";
const DRIVER = fileURLToPath(
  new URL("./codex-exec-driver.mjs", import.meta.url),
);
type Turn = {
  wakePath: string;
  proofPath: string;
  launchId: string;
  sequence?: number | null | undefined;
  digest?: string;
  noticeDigest?: string;
  submitter?: WorkerFinalOutput;
  live: boolean;
  sessionId?: string;
  turnId?: string;
};

/** An explicit ordinary CLI transport. Never replaces an app-server binding. */
export function createCodexExecRuntime(
  revision: RuntimeProfileRevision,
  options: RuntimeCreationOptions & { nativeFinalText?: boolean },
  probeReport?: RuntimeProfileProbeReport,
  resolvedModel?: ResolvedModel,
  toolAccessMode: ToolAccessMode = "full_access",
): GenericProcessAdapter {
  if (isSea())
    throw new Error(
      "codex-exec/v1 is not yet packaged in standalone executables",
    );
  const manifest = revision.manifest;
  if (
    manifest.manifestVersion !== 3 ||
    manifest.adapter.kind !== PROVIDER ||
    manifest.modelCatalogProbe.kind !== "codex-cli/v1"
  )
    throw new Error(
      "codex-exec/v1 requires its explicit v3 profile and codex-cli/v1 probe",
    );
  if (toolAccessMode !== "full_access")
    throw new Error("codex-exec/v1 currently requires full_access");
  if (options.additionalDirectories?.length)
    throw new Error("codex-exec/v1 attached-directory resume is not verified");
  if (manifest.adapter.fixedArgs.length > 1)
    throw new Error("codex-exec/v1 accepts at most one fixed standing prompt");
  if (
    resolvedModel !== undefined &&
    (resolvedModel.source === "runtime_default" ||
      resolvedModel.reasoning === undefined ||
      resolvedModel.reasoning === "default")
  )
    throw new Error(
      "codex-exec/v1 requires an explicit model and reasoning binding",
    );
  if (resolvedModel?.source === "explicit_binding") {
    const binding = requireModelBinding(
      probeReport,
      resolvedModel.modelBindingId,
    );
    if (
      resolvedModel.serviceTier !== undefined &&
      !binding.supportedServiceTiers.includes(resolvedModel.serviceTier)
    )
      throw new Error(
        "Codex model binding does not support service tier " +
          resolvedModel.serviceTier,
      );
  }
  if (
    resolvedModel?.source === "custom_model" &&
    resolvedModel.runtime !== "codex"
  )
    throw new Error("custom model does not match Codex");
  const {
    activationEnvironment,
    providerSessionStore,
    recordDeliveryAcceptance,
    nativeFinalText = false,
    additionalDirectories: _directories,
    ...processOptions
  } = options;
  const turns = new Map<string, Turn>();
  const digests = createStandingPromptDigestLedger();
  const memory = new ProviderSystemMemory();
  const protocol = new SessionProtocolUpgrade(providerSessionStore);
  const identity = probeReport?.executableIdentity;
  const config = manifest.adapter.config;
  return new GenericProcessAdapter({
    ...processOptions,
    ...Object.fromEntries(
      Object.entries(config).filter(([, value]) => value !== undefined),
    ),
    command: process.execPath,
    guideRuntimeId: "codex",
    args: [
      DRIVER,
      "--executable",
      identity?.resolvedExecutablePath ?? manifest.adapter.executable,
      "--tool-access-mode",
      toolAccessMode,
      ...(resolvedModel === undefined
        ? []
        : [
            "--model",
            resolvedModel.modelId,
            "--reasoning",
            resolvedModel.reasoning!,
          ]),
      ...(manifest.adapter.fixedArgs[0] === undefined
        ? []
        : ["--prompt", manifest.adapter.fixedArgs[0]]),
      "-c",
      `service_tier=${JSON.stringify(resolvedModel?.source === "explicit_binding" ? (resolvedModel.serviceTier ?? "default") : "default")}`,
      ...(nativeFinalText ? ["--native-final-text"] : []),
    ],
    env: { ...manifest.staticEnv },
    recoveryProvenance: {
      runtimeProfileDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
      recoveryDriverImplementationVersions: {
        "rah-process-supervisor-v1": "rah-process-supervisor/v1",
      },
    },
    beforeStart: async () => {
      await options.beforeStart?.();
      if (identity) await assertExecutableIdentityCurrent(identity);
    },
    acceptSessionProtocol: async (input) => await protocol.accept(input),
    activationEnvironment: async (input) => {
      // Daemon startup probes an offer before a placement selects a model.
      // That probe-only instance must never issue authority or launch a turn.
      if (resolvedModel === undefined)
        throw new Error(
          "codex-exec/v1 requires an explicit model and reasoning binding",
        );
      let lease: ActivationEnvironmentLease = (await activationEnvironment?.(
        input,
      )) ?? { env: {} };
      let directory: string | undefined;
      try {
        digests.remember(input, lease.standingPromptDigest);
        const key = providerSessionKey(
          input,
          revision,
          PROVIDER,
          lease.standingPromptDigest,
        );
        if (
          input.agent?.instanceChannelId !== undefined &&
          (!key || !providerSessionStore)
        )
          throw new Error(
            "ordinary Codex instance requires durable session binding",
          );
        if (key && providerSessionStore) {
          const previous = await providerSessionStore.load(key, {
            requireExisting: input.agent?.instanceSessionRequired === true,
            instance: input.agent?.instanceChannelId !== undefined,
            instanceGeneration: input.agent?.instanceSessionGeneration,
          });
          lease = protocol.withNotice(
            memory.prepare(input.runAttemptId, lease, previous),
            protocol.prepare(input, lease, key, previous),
          );
          if (previous)
            lease = {
              ...lease,
              args: [
                ...(lease.args ?? []),
                "--resume-session",
                previous.providerSessionId,
              ],
            };
        }
        const allocated = await allocateWakeInputFile(lease);
        lease = allocated.lease;
        directory = await mkdtemp(join(tmpdir(), "rah-codex-final-"));
        const state: Turn = {
          wakePath: allocated.path,
          proofPath: join(directory, "proof.json"),
          launchId: randomUUID(),
          live: true,
        };
        if (nativeFinalText) {
          const origin = lease.env[RAH_WORKER_API_URL_ENV];
          const tokenPath = lease.env[RAH_WORKER_SESSION_FILE_ENV];
          if (!origin || !tokenPath)
            throw new Error("native final requires original Worker credential");
          state.submitter = new WorkerFinalOutput({
            origin,
            accessToken: await readFile(tokenPath, "utf8"),
            isActive: () => state.live,
          });
        }
        if (turns.size >= 64) turns.delete(turns.keys().next().value!);
        turns.set(input.runAttemptId, state);
        const retained = lease;
        const proofDirectory = directory;
        return {
          ...lease,
          args: [
            ...(lease.args ?? []),
            "--final-proof-file",
            state.proofPath,
            "--launch-id",
            state.launchId,
          ],
          ...(nativeFinalText
            ? {
                settleFinalOutput: async (exit, signal) => {
                  if (!state.submitter || state.sequence === null) return;
                  const abort = () => state.submitter?.close();
                  signal.addEventListener("abort", abort, { once: true });
                  if (signal.aborted) abort();
                  try {
                    const text =
                      exit.code === 0 &&
                      exit.signal === undefined &&
                      exit.failure === undefined
                        ? await readProof(state)
                        : undefined;
                    return await state.submitter.submit(
                      nativeFinalEnvelope(text, state.sequence),
                    );
                  } finally {
                    signal.removeEventListener("abort", abort);
                    state.submitter.close();
                  }
                },
              }
            : {}),
          release: async () => {
            state.live = false;
            state.submitter?.close();
            try {
              await retained.release?.();
            } finally {
              await rm(proofDirectory, { recursive: true, force: true });
            }
          },
        };
      } catch (error) {
        try {
          await lease.release?.();
        } finally {
          if (directory) await rm(directory, { recursive: true, force: true });
        }
        throw error;
      }
    },
    beforeLaunch: async (input, lease) => {
      const state = turns.get(input.runAttemptId);
      if (!state || !lease)
        throw new Error("missing ordinary Codex launch lease");
      let bodied: string | undefined;
      let sequence: number | null | undefined;
      if (recordDeliveryAcceptance) {
        try {
          bodied = await renderBodiedWake({
            env: lease.env,
            participantId: input.participantId,
            onPresented: (present) => {
              sequence = nativeFinalSequence(present) ?? null;
            },
          });
        } catch {
          /* No delivery proof: retain Worker fallback and fail closed native settlement. */
        }
      }
      state.sequence = bodied === undefined ? undefined : sequence;
      if (state.sequence === null) state.submitter?.close();
      const notice = input.runtimeNotice ?? "";
      const protocolNotice = lease.env[RAH_PROTOCOL_NOTICE_ENV] ?? "";
      const text =
        bodied === undefined
          ? providerActivationInput(notice, undefined, protocolNotice)
          : withRuntimeNotice(bodied, notice, protocolNotice) +
            (nativeFinalText && state.sequence != null
              ? "\nReply transport: native-final-text for this delivery's single target."
              : "");
      const digest = await writeWakeInputFile(state.wakePath, text);
      if (bodied !== undefined) state.digest = digest;
      if (notice) state.noticeDigest = digest;
    },
    recordDeliveryAcceptance: async (input, acceptance) => {
      const state = turns.get(input.runAttemptId);
      if (!state || acceptance.provider !== PROVIDER)
        throw new Error("unexpected ordinary Codex input acceptance");
      if (state.digest !== undefined) {
        if (acceptance.inputSha256 !== state.digest)
          throw new Error("Codex accepted input does not match rendered wake");
        await recordDeliveryAcceptance?.(input, acceptance);
        state.turnId = acceptance.turnId;
      }
      return {
        runtimeNoticeAccepted:
          state.noticeDigest !== undefined &&
          state.noticeDigest === acceptance.inputSha256,
      };
    },
    recordProviderSessionEvidence: async (input, evidence) => {
      if (evidence.provider !== PROVIDER)
        throw new Error("unexpected ordinary Codex session evidence");
      const turn = turns.get(input.runAttemptId);
      if (
        !turn ||
        (turn.sessionId !== undefined &&
          turn.sessionId !== evidence.providerSessionId)
      )
        throw new Error("conflicting native session identity");
      turn.sessionId = evidence.providerSessionId;
      const key = providerSessionKey(
        input,
        revision,
        PROVIDER,
        digests.digestFor(input),
      );
      if (key && providerSessionStore)
        await providerSessionStore.record(key, evidence.providerSessionId, {
          instance: input.agent?.instanceChannelId !== undefined,
          instanceGeneration: input.agent?.instanceSessionGeneration,
          standingProtocolVersion: protocol.currentVersion(input),
          systemMemorySha256: memory.evidence(
            input.runAttemptId,
            evidence.providerSessionId,
          ),
        });
    },
  });
}

async function readProof(state: Turn): Promise<string | undefined> {
  try {
    const file = await open(
      state.proofPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.size > 512 * 1024 ||
        (stat.mode & 0o077) !== 0 ||
        stat.uid !== process.getuid?.()
      )
        return;
      const proof = JSON.parse(await file.readFile("utf8"));
      if (
        proof.launchId !== state.launchId ||
        proof.sessionId !== state.sessionId ||
        proof.turnId !== state.turnId ||
        typeof proof.sessionId !== "string" ||
        typeof proof.turnId !== "string" ||
        typeof proof.nativeMessageId !== "string" ||
        typeof proof.text !== "string" ||
        !proof.sessionId.trim() ||
        !proof.turnId.trim() ||
        !proof.nativeMessageId.trim()
      )
        return;
      return proof.text;
    } finally {
      await file.close();
    }
  } catch {
    return;
  }
}
