import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import {
  WorkerMessagePresentResponseSchema,
  type WorkerMessagePresentResponse,
} from "@rah-os/protocol";

import type {
  ActivationEnvironmentLease,
  GenericProcessAdapterOptions,
} from "./generic-process-adapter.ts";
import {
  providerActivationInput,
  withRuntimeNotice,
} from "./provider-activation-input.js";
import type { ActivationEnvelope } from "./runtime.ts";
import { RAH_PROTOCOL_NOTICE_ENV } from "./session-protocol-upgrade.ts";
import {
  RAH_WORKER_API_URL_ENV,
  RAH_WORKER_SESSION_FILE_ENV,
} from "./worker-credential-file.ts";
import { RAH_MEMORY_INDEX_SEQ_ENV } from "./channel-memory-index.ts";
import { readMemoryIndexAgainstSystemSnapshot } from "./worker-startup-context.ts";
import { formatBodiedWakeInput } from "./wake-message-input.ts";

const PRESENT_TIMEOUT_MS = 10_000;

/**
 * Runtime implementations whose driver reports a reliable, request-correlated
 * acceptance of the injected wake turn (`rah-delivery-accepted/v1`). Only these
 * may carry a bodied wake: without an acceptance the presented window is never
 * marked sent, the post never confirms delivery, and the model would need a
 * check anyway. Codex: the `turn/start` response to the request carrying the
 * wake. Claude (S2-c1): the `--replay-user-messages` echo of the wake's own
 * uuid with exactly its text. Kimi (S2-c2): kimi-code 0.39.1 never echoes a
 * live prompt; the first turn-scoped model update of the only prompt in
 * flight (it runs one prompt at a time and dispatches model output only for
 * that prompt's turn) precedes any tool of the turn, so any post; a post that
 * still beats the Host's registration is parked (`pending_ack_seq`) and
 * replayed when `sent_at` lands, which the Host does before it records the
 * run's exit. OpenCode (S2-c3, 1.18.32): the prompt carries a caller-chosen
 * user `messageID` the server persists as the message id; the first assistant
 * whose `parentID` is that id is created by the session loop before its model
 * request, so before any tool. A stdin write is never faked into acceptance.
 */
const BODIED_WAKE_ADAPTER_KINDS: ReadonlySet<string> = new Set([
  "claude-stream-json/v1",
  "codex-app-server/v1",
  "kimi-acp/v1",
  "opencode-server/v1",
]);

export function runtimeSupportsBodiedWake(adapterKind: string): boolean {
  return BODIED_WAKE_ADAPTER_KINDS.has(adapterKind);
}

/**
 * S1-d Host-side wake rendering. It runs after `registerPrepared` — the
 * RunAttempt is `starting` with a prepared runtime process, so its Worker
 * credential is current — and BEFORE the runtime process is launched:
 *
 * 1. `POST /v1/worker/message-present` with this Activation's own Worker
 *    credential (the route's required identity). The Kernel selects, bounds and
 *    records the window, and registers the presented prefix as a citable causal
 *    marker on this credential's grant. Nothing here chooses a sequence.
 * 2. Compare the current MEMORY.md with the native session's first system
 *    snapshot (the lease env's RAH_AGENT_MEMORY_SYSTEM_SHA256, already replaced
 *    by `ProviderSystemMemory` on resume); include the full index only when they
 *    differ or no snapshot exists (tool mode). The current file's own digest is
 *    never taken as proof that the native session holds it.
 *
 * Returns undefined when nothing is confirmable (the first event degraded), so
 * the caller keeps the fixed startup wake. Throws on any other failure; the
 * caller also falls back, and an unsent window never acknowledges anything.
 */
export async function renderBodiedWake(input: {
  env: Readonly<Record<string, string | undefined>>;
  participantId: string;
  /** Warm runtimes: the turn handle each named command must carry. */
  turnHandle?: string | undefined;
  fetch?: typeof globalThis.fetch;
  /** Host-only snapshot of the exact rendered window, never a latest-head read. */
  onPresented?: (present: WorkerMessagePresentResponse) => void;
}): Promise<string | undefined> {
  const env = input.env;
  const origin = env[RAH_WORKER_API_URL_ENV];
  const tokenPath = env[RAH_WORKER_SESSION_FILE_ENV];
  if (origin === undefined || tokenPath === undefined || !isAbsolute(tokenPath))
    throw new Error("bodied wake requires the Activation Worker credential");
  const token = await readFile(tokenPath, "utf8");
  const response = await (input.fetch ?? globalThis.fetch)(
    `${origin}/v1/worker/message-present`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(memoryIndexSeqBody(env)),
      signal: AbortSignal.timeout(PRESENT_TIMEOUT_MS),
    },
  );
  if (!response.ok)
    throw new Error(`message-present failed with HTTP ${response.status}`);
  const present = WorkerMessagePresentResponseSchema.parse(
    await response.json(),
  );
  const index = await readMemoryIndexAgainstSystemSnapshot({
    ...env,
    RAH_PARTICIPANT_ID: input.participantId,
  });
  const text = formatBodiedWakeInput({
    present,
    turnHandle: input.turnHandle,
    ...(index === undefined || index.matchesSystem
      ? {}
      : {
          memory: {
            content: index.content,
            reason:
              env.RAH_AGENT_MEMORY_SYSTEM_SHA256 === undefined
                ? "not_in_system"
                : "changed",
          },
        }),
  });
  if (text !== undefined) input.onPresented?.(present);
  return text;
}

/**
 * S6 batch B: the channel memory seq of the index this launch's prompt put in
 * the session, when the Host set one; the Kernel's lower bound for the delta.
 */
function memoryIndexSeqBody(
  env: Readonly<Record<string, string | undefined>>,
): { memoryIndexSeq?: number } {
  const raw = env[RAH_MEMORY_INDEX_SEQ_ENV];
  if (raw === undefined) return {};
  const seq = Number(raw);
  if (!Number.isSafeInteger(seq) || seq < 0)
    throw new Error("invalid launch memory index sequence");
  return { memoryIndexSeq: seq };
}

/**
 * Allocates the owner-private file the driver reads as `--wake-input-file`.
 * The argument must be fixed before launch (the process supervisor freezes its
 * argv when it is spawned, before `registerPrepared`); the content is written
 * later by {@link writeWakeInputFile}. The directory is removed on release.
 */
export async function allocateWakeInputFile(
  lease: ActivationEnvironmentLease,
): Promise<{ lease: ActivationEnvironmentLease; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "rah-wake-input-"));
  try {
    await chmod(directory, 0o700);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const path = join(directory, "wake.md");
  return {
    path,
    lease: {
      ...lease,
      args: [...(lease.args ?? []), "--wake-input-file", path],
      release: async () => {
        try {
          await lease.release?.();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
    },
  };
}

/** Writes the wake text and returns its SHA-256, which the acceptance must echo. */
export async function writeWakeInputFile(
  path: string,
  text: string,
): Promise<string> {
  await writeFile(path, text, { mode: 0o600, flag: "wx" });
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The per-turn Host side of a bodied wake for one driver (`provider`): the
 * lease gains `--wake-input-file`, the Kernel renders the window after
 * `registerPrepared` and before launch, and the driver's acceptance is
 * registered only when its digest equals the text this Host prepared for the
 * same RunAttempt. Without `recordDeliveryAcceptance` (a Host that cannot
 * register sends) the lease and launch are unchanged, unless `wakePreface`
 * has text for the RunAttempt: then the Host still composes the (fixed) wake
 * file so the preface reaches the runtime verbatim.
 */
export function createHostBodiedWake(input: {
  provider: string;
  recordDeliveryAcceptance: GenericProcessAdapterOptions["recordDeliveryAcceptance"];
  /**
   * S2-c2: Host text this RunAttempt's wake starts with (the Kimi rules card
   * after a compaction). Read once when the lease is prepared.
   */
  wakePreface?: (activation: ActivationEnvelope) => string | undefined;
}): {
  enabled: boolean;
  withBodiedWake: (
    activation: ActivationEnvelope,
    lease: ActivationEnvironmentLease,
  ) => Promise<ActivationEnvironmentLease>;
  beforeLaunch: NonNullable<GenericProcessAdapterOptions["beforeLaunch"]>;
  recordDeliveryAcceptance: GenericProcessAdapterOptions["recordDeliveryAcceptance"];
} {
  const record = input.recordDeliveryAcceptance;
  const enabled =
    record !== undefined && runtimeSupportsBodiedWake(input.provider);
  // Per RunAttempt: the allocated wake file, then the digest of the bodied
  // text written into it. Bounded, and not cleared on lease release: the
  // adapter releases the lease before it drains the last fd3 frames, and the
  // acceptance must still match then.
  const wakeFiles = new Map<string, string>();
  const preparedWakeDigests = new Map<string, string>();
  // Per RunAttempt: the digest of a wake file that carried the notice line.
  const noticeWakeDigests = new Map<string, string>();
  // Per RunAttempt: the preface its wake file starts with.
  const prefaces = new Map<string, string>();
  const remember = (map: Map<string, string>, key: string, value: string) => {
    if (map.size >= 64 && !map.has(key)) map.delete(map.keys().next().value!);
    map.set(key, value);
  };
  return {
    enabled,
    withBodiedWake: async (activation, lease) => {
      const preface = input.wakePreface?.(activation);
      if (preface === undefined || preface === "")
        prefaces.delete(activation.runAttemptId);
      else remember(prefaces, activation.runAttemptId, preface);
      const bodiedPossible =
        enabled && lease.env[RAH_WORKER_API_URL_ENV] !== undefined;
      if (!bodiedPossible && !prefaces.has(activation.runAttemptId))
        return lease;
      const allocated = await allocateWakeInputFile(lease);
      remember(wakeFiles, activation.runAttemptId, allocated.path);
      return allocated.lease;
    },
    // After registerPrepared, before launch: the Kernel renders the window
    // first, so no acceptance can ever precede the record it registers.
    beforeLaunch: async (activation, lease) => {
      const path = wakeFiles.get(activation.runAttemptId);
      if (path === undefined || lease === undefined) return;
      const preface = prefaces.get(activation.runAttemptId);
      const withPreface = (text: string) =>
        preface === undefined ? text : `${preface}\n\n${text}`;
      let bodied: string | undefined;
      if (enabled && lease.env[RAH_WORKER_API_URL_ENV] !== undefined) {
        try {
          bodied = await renderBodiedWake({
            env: lease.env,
            participantId: activation.participantId,
          });
        } catch (error) {
          process.stderr.write(
            `[rah-os] bodied wake unavailable for ${activation.runAttemptId}, using the startup wake: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      }
      // S2-0 review P2-2: the Host appends the notice line itself, so the
      // file is the whole input and the acceptance digest covers the notice.
      const notice = activation.runtimeNotice ?? "";
      // P2-3: the protocol line rides in the same Host-composed file.
      const protocolNotice = lease.env[RAH_PROTOCOL_NOTICE_ENV] ?? "";
      if (bodied === undefined) {
        // The fixed startup wake; no window digest is remembered, so its
        // acceptance registers no send and the model confirms delivery with
        // message-check. It can still confirm the notice line.
        const digest = await writeWakeInputFile(
          path,
          withPreface(
            providerActivationInput(notice, undefined, protocolNotice),
          ),
        );
        if (notice !== "")
          remember(noticeWakeDigests, activation.runAttemptId, digest);
        return;
      }
      const digest = await writeWakeInputFile(
        path,
        withPreface(withRuntimeNotice(bodied, notice, protocolNotice)),
      );
      remember(preparedWakeDigests, activation.runAttemptId, digest);
      if (notice !== "")
        remember(noticeWakeDigests, activation.runAttemptId, digest);
    },
    recordDeliveryAcceptance:
      record === undefined
        ? undefined
        : async (activation, acceptance) => {
            if (acceptance.provider !== input.provider) {
              throw new Error(
                `unexpected runtime delivery acceptance: ${acceptance.provider}`,
              );
            }
            // Only the exact text this Host prepared for this RunAttempt may
            // be registered as sent; the driver cannot vouch for any other
            // input.
            const prepared = preparedWakeDigests.get(activation.runAttemptId);
            const noticed = noticeWakeDigests.get(activation.runAttemptId);
            // The fixed startup wake has no presented window behind it.
            if (prepared !== undefined) {
              if (acceptance.inputSha256 !== prepared) {
                throw new Error(
                  "runtime delivery acceptance does not match the prepared wake input",
                );
              }
              await record(activation, acceptance);
            }
            return {
              runtimeNoticeAccepted:
                noticed !== undefined && acceptance.inputSha256 === noticed,
            };
          },
  };
}
