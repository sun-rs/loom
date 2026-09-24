import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { WorkerMessagePresentResponseSchema } from "@rah-os/protocol";

import type { ActivationEnvironmentLease } from "./generic-process-adapter.ts";
import {
  RAH_WORKER_API_URL_ENV,
  RAH_WORKER_SESSION_FILE_ENV,
} from "./worker-credential-file.ts";
import { readMemoryIndexAgainstSystemSnapshot } from "./worker-startup-context.ts";
import { formatBodiedWakeInput } from "./wake-message-input.ts";

const PRESENT_TIMEOUT_MS = 10_000;

/**
 * Runtime implementations whose driver reports a reliable, request-correlated
 * acceptance of the injected wake turn (`rah-delivery-accepted/v1`). Only these
 * may carry a bodied wake: without an acceptance the presented window is never
 * marked sent, the post never confirms delivery, and the model would need a
 * check anyway. Claude, Kimi and OpenCode keep the fixed startup wake until
 * their own acceptance evidence is verified; a stdin write is never faked into
 * acceptance.
 */
const BODIED_WAKE_ADAPTER_KINDS: ReadonlySet<string> = new Set([
  "codex-app-server/v1",
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
      body: "{}",
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
  return formatBodiedWakeInput({
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
