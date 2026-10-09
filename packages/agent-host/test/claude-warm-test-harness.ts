import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { WorkerApplicationService } from "@rah-os/application-service";
import { RoomKernel, type AuthenticatedHostContext } from "@rah-os/kernel";
import {
  AgentHost,
  CLAUDE_WARM_DRIVER,
  CodexWarmAdapter,
  createKernelAgentHostControlPort,
  createSystemProcessTable,
  InstanceRuntimePool,
  LeftoverProcessSweeper,
  renderBodiedWake,
  RuntimeProcessHygiene,
  type RuntimeAdapter,
  type WarmRuntimePolicyOverrides,
} from "../src/index.ts";

/**
 * S2-c1 warm Claude end to end with a FAKE long-lived Claude stream-json CLI
 * (no model, no paid CLI): real Kernel and SQLite, real Worker HTTP API and
 * Worker CLI, the real Claude warm driver, the shared warm adapter and pool,
 * and AgentHost. The fake's frames follow what the installed Claude Code
 * 2.1.282 emitted locally without a model call (lifecycle per inbound uuid,
 * replay echo with that uuid, `result.user_message_uuid`, interrupt receipt).
 * It cannot prove the real model loop; that is the paid smoke gate.
 */
export const fakePath = fileURLToPath(
  new URL("./fixtures/fake-claude-warm.mjs", import.meta.url),
);

export type Harness = Awaited<ReturnType<typeof harness>>;

export async function harness(
  options: {
    idleTtlMs?: number;
    executable?: string;
    nativeFinalText?: boolean;
    skipPresented?: boolean;
    policy?: WarmRuntimePolicyOverrides;
    env?: Record<string, string>;
    interruptQuiesceTimeoutMs?: number;
    resolvedModel?: ConstructorParameters<
      typeof CodexWarmAdapter
    >[0]["resolvedModel"];
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "rah-warm-claude-"));
  chmodSync(directory, 0o700);
  const socketRoot = mkdtempSync("/tmp/lwc-");
  chmodSync(socketRoot, 0o700);
  const stateDirectory = join(directory, "fake-state");
  const recordPath = join(directory, "record.jsonl");
  const executable = join(directory, "claude");
  writeFileSync(
    executable,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakePath)} "$@"\n`,
    { mode: 0o700 },
  );
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const worker = new WorkerApplicationService({ kernel });
  await worker.start();
  const human = kernel.provisionPrincipal({
    handle: "warm-human",
    kind: "human",
  });
  const agent = kernel.provisionPrincipal({
    handle: "warm-claude",
    kind: "agent",
  });
  const participantId = agent.principal.principalId;
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Warm", slug: "warm" });
  kernel.addMember(actor, { principalId: participantId, roomId: room.roomId });
  const hostToken = kernel.provisionHostCredential({
    hostId: "warm-host",
    participantIds: [participantId],
  }).accessToken;
  const sessions = new Map<string, string>();
  /** Turn inputs the fake had received when each binding was persisted. */
  const inputsAtBinding: number[] = [];
  const acceptances: { inputSha256?: string; turnId: string }[] = [];
  const diagnostics: string[] = [];
  let nowMs = Date.now();
  const hygiene = new RuntimeProcessHygiene({
    sweeper: new LeftoverProcessSweeper({
      graceMs: 300,
      table: createSystemProcessTable(),
    }),
  });
  let messages = 0;
  const credentialEvents: string[] = [];
  const credentials: string[] = [];

  const makeHost = (host: AuthenticatedHostContext) => {
    const control = createKernelAgentHostControlPort(kernel, host);
    const pool = new InstanceRuntimePool({
      control,
      hostGeneration: host.instanceId,
      hygiene,
      idleTtlMs: options.idleTtlMs ?? 60_000,
      ...(options.policy === undefined ? {} : { policy: options.policy }),
      now: () => nowMs,
      onDiagnostic: (message) => diagnostics.push(message),
      socketRoot,
      stateDirectory: join(directory, "warm-runtimes"),
    });
    const legacy: RuntimeAdapter = {
      async probe() {
        return { available: true };
      },
      async start() {
        throw new Error("the per-turn path is not used in this test");
      },
      async cancel() {
        throw new Error("unused");
      },
      async reap() {
        throw new Error("unused");
      },
    };
    const adapter = new CodexWarmAdapter({
      driver: CLAUDE_WARM_DRIVER,
      ...(options.nativeFinalText === undefined
        ? {}
        : { nativeFinalText: options.nativeFinalText }),
      cwd: directory,
      driverArgs: [
        "--executable",
        options.executable ?? executable,
        "--tool-access-mode",
        "full_access",
        "--prompt",
        "FAKE standing prompt for the warm Claude test",
      ],
      env: {
        FAKE_CLAUDE_RECORD_PATH: recordPath,
        FAKE_CLAUDE_STATE_DIR: stateDirectory,
        ...options.env,
      },
      ...(options.interruptQuiesceTimeoutMs === undefined
        ? {}
        : { interruptQuiesceTimeoutMs: options.interruptQuiesceTimeoutMs }),
      ...(options.resolvedModel === undefined
        ? {}
        : { resolvedModel: options.resolvedModel }),
      isWarm: () => true,
      issueWorkerCredential: async (input) => {
        const issued = worker.issueActivationCredential(host, input);
        credentials.push(issued.accessToken);
        credentialEvents.push("issued");
        return {
          ...issued,
          revoke() {
            credentialEvents.push("revoked");
            issued.revoke();
          },
        };
      },
      legacy,
      pool,
      recordDeliveryAcceptance: (input, acceptance) => {
        if (options.nativeFinalText && !options.skipPresented)
          kernel.markPresentedDeliverySent(host, {
            activationId: input.activationId,
            consumerId: input.consumerId,
            runAttemptId: input.runAttemptId,
          });
        acceptances.push({
          turnId: acceptance.turnId,
          ...(acceptance.inputSha256 === undefined
            ? {}
            : { inputSha256: acceptance.inputSha256 }),
        });
      },
      recordProviderSessionEvidence: (input, evidence) => {
        inputsAtBinding.push(
          readRecords().filter((record) => record.event === "input").length,
        );
        sessions.set(input.participantId, evidence.providerSessionId);
      },
      renderWake: async (input) =>
        await renderBodiedWake({
          env: input.env,
          participantId: input.participantId,
          turnHandle: input.turnHandle,
          ...(options.skipPresented ? {} : { onPresented: input.onPresented }),
        }),
      runtimeEnvironment: async (input) => {
        const previous = sessions.get(input.participantId);
        return {
          args: previous === undefined ? [] : ["--resume-session", previous],
          env: {},
        };
      },
      runtimeKey: () => "fake-key",
      workerApiOrigin: worker.origin,
    });
    const agentHost = new AgentHost({
      drainTimeoutMs: 300,
      guideEnabled: () => true,
      host,
      kernel,
      leaseMs: 30_000,
      pollIntervalMs: 20,
      retryAfterMs: 0,
      runtime: adapter,
    });
    return { adapter, agentHost, control, host, pool };
  };

  function readRecords(): Record<string, unknown>[] {
    if (!existsSync(recordPath)) return [];
    return readFileSync(recordPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  const host = kernel.authenticateHostAccessToken(hostToken);
  kernel.heartbeatHost(host);
  const current = makeHost(host);

  return {
    acceptances,
    credentialEvents,
    credentials,
    workerOrigin: worker.origin,
    actor,
    advance(ms: number) {
      nowMs += ms;
    },
    current,
    databasePath,
    directory,
    diagnostics,
    inputsAtBinding,
    kernel,
    participantId,
    post(body: string) {
      messages += 1;
      return kernel.postMessage(actor, {
        body,
        idempotencyKey: `warm-message-${messages}`,
        recipients: [{ participantId, reason: "mention" }],
        roomId: room.roomId,
      });
    },
    records: readRecords,
    roomId: room.roomId,
    sessions,
    stateDirectory,
    async cleanup() {
      await current.pool.shutdown().catch(() => undefined);
      await worker.close();
      kernel.close();
      rmSync(socketRoot, { force: true, recursive: true });
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

export function sql(state: Harness, query: string, ...args: string[]) {
  const database = new DatabaseSync(state.databasePath, { readOnly: true });
  try {
    return database.prepare(query).all(...args) as Record<string, unknown>[];
  } finally {
    database.close();
  }
}

export async function waitFor<T>(
  probe: () => T | undefined | false,
  label: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const events = (state: Harness, event: string) =>
  state.records().filter((record) => record.event === event);
export const starts = (state: Harness) => events(state, "start");
export const inputs = (state: Harness) => events(state, "input");
export const turns = (state: Harness) => events(state, "turn");
export const interrupts = (state: Harness) =>
  events(state, "control").filter(
    (record) => (record.request as { subtype: string }).subtype === "interrupt",
  );
export const orderedRuns = (state: Harness) =>
  state.kernel
    .listRunAttempts({ roomId: state.roomId })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
