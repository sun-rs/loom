import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { WorkerMessagePresentResponse } from "@rah-os/protocol";
import type { ActivationEnvelope } from "./runtime.ts";
import type {
  ActivationEnvironmentLease,
  RuntimeDeliveryAcceptance,
  RuntimeProviderSessionEvidence,
} from "./generic-process-adapter.ts";
import {
  nativeFinalEnvelope,
  nativeFinalSequence,
} from "./native-final-transport.ts";
import { WorkerFinalOutput } from "./worker-final-output.ts";
import {
  RAH_WORKER_API_URL_ENV,
  RAH_WORKER_SESSION_FILE_ENV,
} from "./worker-credential-file.ts";

type Turn = {
  live: boolean;
  launchId: string;
  proofPath: string;
  sequence?: number | undefined;
  presented: boolean;
  sessionId?: string;
  turnId?: string;
  acceptedSessionId?: string;
  submitter: WorkerFinalOutput;
};

/** Per-Run proof/credential lifetime only. Kernel owns delivery and publication. */
export function createKimiNativeFinalTransport() {
  const turns = new Map<string, Turn>();
  return {
    async prepare(
      input: ActivationEnvelope,
      lease: ActivationEnvironmentLease,
    ): Promise<ActivationEnvironmentLease> {
      let directory: string | undefined;
      let state: Turn | undefined;
      let released: Promise<void> | undefined;
      const release = () =>
        (released ??= (async () => {
          if (state) {
            state.live = false;
            state.submitter.close();
            if (turns.get(input.runAttemptId) === state)
              turns.delete(input.runAttemptId);
          }
          try {
            await lease.release?.();
          } finally {
            if (directory)
              await rm(directory, { recursive: true, force: true });
          }
        })());
      try {
        if (turns.has(input.runAttemptId))
          throw new Error("Kimi native final run already prepared");
        const origin = lease.env[RAH_WORKER_API_URL_ENV];
        const tokenPath = lease.env[RAH_WORKER_SESSION_FILE_ENV];
        if (!origin || !tokenPath)
          throw new Error(
            "Kimi native final requires original Worker credential",
          );
        const url = new URL(origin);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.origin !== origin
        )
          throw new Error("Invalid original Worker origin");
        const token = await readPrivateFile(tokenPath, 65536);
        if (!token || /\s/.test(token))
          throw new Error("Invalid original Worker credential");
        directory = await mkdtemp(join(tmpdir(), "rah-kimi-final-"));
        state = {
          live: true,
          launchId: randomUUID(),
          proofPath: join(directory, "final.json"),
          presented: false,
          submitter: new WorkerFinalOutput({
            origin,
            accessToken: token,
            isActive: () => state?.live === true,
          }),
        };
        const turn = state;
        turns.set(input.runAttemptId, turn);
        return {
          ...lease,
          args: [
            ...(lease.args ?? []),
            "--native-final-text",
            "true",
            "--launch-id",
            turn.launchId,
            "--final-proof-file",
            turn.proofPath,
          ],
          async settleFinalOutput(exit, signal) {
            if (turn.sequence === undefined) return;
            const abort = () => turn.submitter.close();
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) abort();
            try {
              const text =
                exit.code === 0 &&
                exit.signal === undefined &&
                exit.failure === undefined
                  ? await readProof(turn)
                  : undefined;
              return await turn.submitter.submit(
                nativeFinalEnvelope(text, turn.sequence),
              );
            } finally {
              signal.removeEventListener("abort", abort);
              turn.submitter.close();
            }
          },
          release,
        };
      } catch (error) {
        await release();
        throw error;
      }
    },
    presented(
      input: ActivationEnvelope,
      present: WorkerMessagePresentResponse,
    ) {
      const turn = turns.get(input.runAttemptId);
      if (!turn) return;
      const sequence = nativeFinalSequence(present);
      if (turn.presented && turn.sequence !== sequence) {
        turn.live = false;
        turn.submitter.close();
        throw new Error("Kimi final delivery selection changed");
      }
      turn.presented = true;
      turn.sequence = sequence;
    },
    suffix(input: ActivationEnvelope) {
      return turns.get(input.runAttemptId)?.sequence === undefined
        ? ""
        : "\nReply transport: native-final-text for this delivery's single target.";
    },
    accepted(input: ActivationEnvelope, evidence: RuntimeDeliveryAcceptance) {
      const turn = turns.get(input.runAttemptId);
      if (!turn) return;
      if (
        evidence.provider !== "kimi-acp/v1" ||
        !evidence.threadId ||
        !evidence.turnId ||
        (turn.sessionId !== undefined &&
          turn.sessionId !== evidence.threadId) ||
        (turn.acceptedSessionId !== undefined &&
          turn.acceptedSessionId !== evidence.threadId) ||
        (turn.turnId !== undefined && turn.turnId !== evidence.turnId)
      ) {
        turn.live = false;
        turn.submitter.close();
        throw new Error("Kimi accepted prompt identity changed");
      }
      turn.acceptedSessionId = evidence.threadId;
      turn.turnId = evidence.turnId;
    },
    session(
      input: ActivationEnvelope,
      evidence: RuntimeProviderSessionEvidence,
    ) {
      const turn = turns.get(input.runAttemptId);
      if (!turn) return;
      if (
        evidence.provider !== "kimi-acp/v1" ||
        !evidence.providerSessionId ||
        (turn.sessionId !== undefined &&
          turn.sessionId !== evidence.providerSessionId) ||
        (turn.acceptedSessionId !== undefined &&
          turn.acceptedSessionId !== evidence.providerSessionId)
      ) {
        turn.live = false;
        turn.submitter.close();
        throw new Error("Kimi native session identity changed");
      }
      turn.sessionId = evidence.providerSessionId;
    },
  };
}

async function readProof(turn: Turn): Promise<string | undefined> {
  try {
    if (
      !turn.live ||
      !turn.sessionId ||
      !turn.turnId ||
      turn.acceptedSessionId !== turn.sessionId
    )
      return;
    const proof: unknown = JSON.parse(
      await readPrivateFile(turn.proofPath, 512 * 1024),
    );
    if (!proof || typeof proof !== "object" || Array.isArray(proof)) return;
    const p = proof as Record<string, unknown>;
    if (
      p.launchId !== turn.launchId ||
      p.sessionId !== turn.sessionId ||
      p.turnId !== turn.turnId ||
      typeof p.nativeMessageId !== "string" ||
      !p.nativeMessageId.trim() ||
      typeof p.text !== "string"
    )
      return;
    return p.text;
  } catch {
    return;
  }
}

/** Never follow a symlink or let a concurrently grown file bypass the bound. */
async function readPrivateFile(path: string, limit: number): Promise<string> {
  if (!isAbsolute(path)) throw new Error("Private file path must be absolute");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (
      !before.isFile() ||
      before.size > limit ||
      (before.mode & 0o077) !== 0 ||
      before.uid !== process.getuid?.()
    )
      throw new Error("Private file identity/mode invalid");
    const bytes = Buffer.alloc(before.size + 1);
    let n = 0;
    while (n < bytes.length) {
      const next = await file.read(bytes, n, bytes.length - n, n);
      if (!next.bytesRead) break;
      n += next.bytesRead;
    }
    const after = await file.stat();
    if (
      n !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      throw new Error("Private file changed during read");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, n),
    );
  } finally {
    await file.close();
  }
}
