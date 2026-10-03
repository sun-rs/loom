import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  agentMemoryWorkspacePath,
  readAgentMemoryMaterializationReceipt,
} from "@rah-os/agent-host";
import { RoomKernel } from "@rah-os/kernel";
import type {
  AgentCatalogEntry,
  LocalRuntimeInventoryResponse,
} from "@rah-os/protocol";

import {
  DaemonApplication,
  localCliRuntimeSpec,
  prepareLocalWorkbench,
} from "../src/index.ts";

/**
 * Opt-in acceptance gate for the four core-chain scenarios that
 * `docs/product/core-chain-acceptance-protocol.zh-CN.md` marks as having no
 * automated coverage at all: scenario 2 (cross-Room), scenario 3 (DM
 * continuity), scenario 5 (memory positive/negative control) and the
 * un-covered half of scenario 4 (is the model switch real underneath, and does
 * unfinished work survive a restart).
 *
 * Scenario 1 is deliberately absent. Its split/rework chain, its busy-time hold
 * and its role contrast are already paid for by `real-agent-split-chain-gate`,
 * `real-busy-hold-gate` and `real-role-contrast-gate`; re-running them here
 * would only spend money twice.
 *
 * Evidence discipline follows the protocol: every pass/fail assertion reads the
 * ledger (`room.db`), the memory filesystem or a live `ps` snapshot. Anything
 * that can only be judged from what a model said is copied verbatim into
 * `RAH_CORE_CHAIN_REPORT` as an observation for the Human, and is never
 * asserted.
 */
const ENABLED = process.env.RAH_CORE_CHAIN_GATE === "1";
/**
 * The budget for one pass. The documented 15 minutes was measured, not
 * estimated, and does not fit: run 1 (2026-09-10) spent 930 s and reached its
 * wall while the pre-switch Run was still in flight, so scenario 4 never got a
 * post-switch Run at all. The observed cost of the script is roughly 17 minutes
 * with three real CLIs, of which the seven Human turns before scenario 4 are
 * about 12; 35 minutes leaves headroom for models that answer at
 * half that speed without letting a genuinely stuck run burn indefinitely (a
 * stall is caught much earlier by `waitForOutcome`). A supervisor can still
 * override it, and the gate never retries a scenario on its own.
 */
const GATE_TIMEOUT_MS = Number.parseInt(
  process.env.RAH_CORE_CHAIN_TIMEOUT_MS ?? String(35 * 60_000),
  10,
);
/**
 * Scenario 4 is the only scenario whose evidence cannot be collected after the
 * fact: the switch has to land while a Run is in flight, a later Run has to be
 * scheduled from the new revision, and its argv has to be read off a live
 * process. If the preamble has eaten the budget, the gate says so before paying
 * for two more real turns it could never judge.
 */
const SCENARIO_4_RESERVE_MS = 10 * 60_000;
/** How long the post-switch wake is waited for before the timeline is dumped. */
const POST_SWITCH_WAIT_MS = 5 * 60_000;
// A phase boundary can briefly show every Activation terminal before the next
// wake is enqueued, so a stall must persist before it is reported as a gap.
const STALL_CONFIRM_MS = 20_000;
const ARGV_SAMPLE_INTERVAL_MS = 300;

/** Business markers, so every message and answer is attributable. */
const S5_ORIGINAL = "ORIOLE-1";
const S5_CORRECTED = "ORIOLE-2";
const S3_PASSPHRASE = "CANARY-S3-7741";
const S4_ACTIVE_MARKER = "acceptance/S4-active.marker";
const S4_EXEC_FILE = "acceptance/S4.txt";
const S4_AUDIT_FILE = "acceptance/S4-audit.txt";
const S4_AUDIT_BODY = "S4 AUDIT OK";
const S4_EXEC_BODY = "S4 EXEC OK";
const S4_EXEC_DONE = "S4 BUSY DONE";
const S4_AUDIT_DONE = "S4 AUDIT DONE";

const AGENT_INSTRUCTIONS = [
  "You are a collaborating Agent in a shared workspace.",
  "Answer only in the Room the Human addressed you in, in one or two short sentences.",
  "When the Human asks you to remember something, write it into your own memory index (MEMORY.md) or a file under notes/ before you answer, and say that you saved it.",
  "When the Human corrects an earlier fact, edit your memory so the old value is gone or is explicitly marked as superseded.",
  "Never invent a fact you were not told; if you do not know something, say plainly that you do not know.",
  "Do not create Tasks.",
].join(" ");

/**
 * The exact authorized paid matrix (`AGENTS.md`, 2026-09-09). The gate asserts
 * these catalog binding ids and reasoning levels and fails rather than
 * substituting: a gate must never quietly spend on a model or a reasoning level
 * the user did not approve. Fable is never run.
 */
const CLAUDE_BINDING = { modelId: "sonnet", reasoning: "low" } as const;
const CODEX_BINDING = { modelId: "gpt-5.6-luna", reasoning: "low" } as const;
const KIMI_BINDING = { modelId: "kimi-code/k3", reasoning: "high" } as const;
const OPENCODE_BINDING = {
  modelId: "deepseek/deepseek-v4-flash",
  reasoning: "low",
} as const;

type CoreChainHandle = "mem-a" | "mem-b" | "steady-c";

type CoreChainRole = {
  readonly executable: "codex" | "kimi" | "opencode";
  readonly handle: CoreChainHandle;
  readonly modelId: string;
  readonly reasoning: string;
};

/**
 * Three Agents is the minimum the four scenarios need: one identity that lives
 * in both Rooms and in a DM and gets switched (`mem-a`), one negative control
 * that is a member of Room A only (`mem-b`), and one Agent that must keep
 * working untouched while `mem-a` is switched (`steady-c`).
 *
 * Each local Runtime offer publishes `maxConcurrent: 1`, so the switch target
 * is deliberately the Runtime of the Agent that is idle during scenario 4
 * (`mem-b`'s OpenCode offer) and never `steady-c`'s Codex offer, whose Run has
 * to stay concurrent to prove 4.7.
 */
const ROLES: readonly CoreChainRole[] = [
  {
    executable: "kimi",
    handle: "mem-a",
    modelId: KIMI_BINDING.modelId,
    reasoning: KIMI_BINDING.reasoning,
  },
  {
    executable: "opencode",
    handle: "mem-b",
    modelId: OPENCODE_BINDING.modelId,
    reasoning: OPENCODE_BINDING.reasoning,
  },
  {
    executable: "codex",
    handle: "steady-c",
    modelId: CODEX_BINDING.modelId,
    reasoning: CODEX_BINDING.reasoning,
  },
];

/** `mem-a` is switched from Kimi high to OpenCode low mid-collaboration. */
const SWITCH_TARGET = {
  effortFlag: "--variant",
  executable: "opencode",
  modelId: OPENCODE_BINDING.modelId,
  reasoning: OPENCODE_BINDING.reasoning,
} as const;

type ArgvObservation = {
  efforts: { flag: string; value: string }[];
  modelIds: string[];
  observedAt: string;
  pid: string;
};

type ReportRow = {
  evidence: unknown;
  mode: "asserted" | "observed" | "not_covered";
  note?: string;
};

test(
  "opt-in real core-chain gate covers cross-Room, DM continuity, memory control and a live model switch",
  { skip: !ENABLED, timeout: GATE_TIMEOUT_MS + 120_000 },
  async () => {
    const startedAt = Date.now();
    const gateDeadline = startedAt + GATE_TIMEOUT_MS;
    const directory = mkdtempSync(join(tmpdir(), "rah-core-chain-"));
    console.log(`RAH_CORE_CHAIN_STATE ${directory}`);
    const stateDirectory = join(directory, "state");
    const workspaceDirectory = join(directory, "workspace");
    mkdirSync(workspaceDirectory, { mode: 0o700 });
    const memoryRoot = join(stateDirectory, "supervisors", "agent-memory");

    const runtimeSpecs = ROLES.map(({ executable }) => {
      const spec = localCliRuntimeSpec(executable, workspaceDirectory);
      assert.ok(spec, `missing local Runtime spec for ${executable}`);
      return spec;
    });

    const rows: Record<string, ReportRow> = {};
    const observations: Record<string, unknown> = {};
    const record = (
      row: string,
      mode: ReportRow["mode"],
      evidence: unknown,
      note?: string,
    ): void => {
      rows[row] = { evidence, mode, ...(note === undefined ? {} : { note }) };
    };

    // Argv is written to no table, no trajectory and no log file: the live
    // process is the only evidence for 4.4 and it cannot be collected after the
    // fact, so sampling runs for the whole gate rather than only around the
    // switch.
    const argvByRunAttempt = new Map<string, ArgvObservation[]>();
    // Sampling runs on a timer for the whole gate and is additionally driven by
    // hand while the post-switch Run is being waited for, so 4.4's window is
    // sampled deliberately rather than only by luck of the interval.
    const recordArgvSamples = (): void => {
      try {
        for (const [runAttemptId, observation] of sampleDriverArgv()) {
          const seen = argvByRunAttempt.get(runAttemptId) ?? [];
          const fingerprint = (candidate: ArgvObservation): string =>
            JSON.stringify([
              candidate.pid,
              candidate.modelIds,
              candidate.efforts,
            ]);
          if (
            !seen.some(
              (previous) => fingerprint(previous) === fingerprint(observation),
            )
          )
            seen.push(observation);
          argvByRunAttempt.set(runAttemptId, seen);
        }
      } catch {
        // A transient `ps` failure must never break the paid run.
      }
    };
    const sampler = setInterval(recordArgvSamples, ARGV_SAMPLE_INTERVAL_MS);
    sampler.unref();

    const shutdown = { controller: new AbortController() };
    let application: DaemonApplication | undefined;
    let observer: RoomKernel | undefined;
    let running: Promise<void> | undefined;
    let reported = false;
    const databasePath = join(stateDirectory, "room.db");

    const emitReport = (outcome: string, error?: unknown): void => {
      if (reported) return;
      reported = true;
      let ledger: unknown = "unavailable";
      try {
        ledger = ledgerSummary(databasePath);
      } catch (summaryError) {
        ledger = `ledger summary failed: ${String(summaryError)}`;
      }
      console.log(
        `RAH_CORE_CHAIN_REPORT ${JSON.stringify(
          {
            argvObservations: Object.fromEntries(argvByRunAttempt),
            authorizedMatrix: {
              claude: CLAUDE_BINDING,
              codex: CODEX_BINDING,
              kimi: KIMI_BINDING,
              opencode: OPENCODE_BINDING,
            },
            error: error === undefined ? undefined : String(error),
            ledger,
            modelObservations: observations,
            outcome,
            protocolRows: rows,
            stateDirectory: directory,
            wallTimeMs: Date.now() - startedAt,
          },
          undefined,
          2,
        )}`,
      );
    };

    try {
      const prepared = await prepareLocalWorkbench({
        runtimeSpecs,
        stateDirectory,
        workspaceCwd: workspaceDirectory,
      });
      application = new DaemonApplication({ config: prepared.config });
      running = application.run({ signal: shutdown.controller.signal });
      await waitUntil(
        () =>
          application?.health().state === "online" &&
          application.clientOrigin() !== undefined,
        60_000,
      );
      const originOf = (): string => {
        const value = application?.clientOrigin();
        assert.ok(value, "the daemon has no client origin");
        return value;
      };
      const token = prepared.humanAccessToken;
      const roomA = prepared.metadata.defaultRoomId;
      const controlRoomId = prepared.metadata.controlRoomId;

      observer = new RoomKernel({ databasePath });
      observer.initialize();
      let activeObserver = observer;
      let humanActor = activeObserver.authenticateHumanAccessToken(token);
      const humanId =
        activeObserver.getAuthenticatedPrincipal(humanActor).principalId;

      const inventory = await postJson<LocalRuntimeInventoryResponse>(
        originOf(),
        token,
        "/v1/local/runtimes/list",
        {},
      );
      const catalog = await postJson<{ agents: AgentCatalogEntry[] }>(
        originOf(),
        token,
        "/v3/client/agents/list",
        { controlRoomId },
      );
      assert.equal(catalog.agents.length, ROLES.length);

      /** Resolves an authorized (offerId, bindingId) pair or fails the gate. */
      const authorizedRuntime = (
        executable: string,
        modelId: string,
        reasoning: string,
      ): { modelBindingId: string; runtimeOfferId: string } => {
        const spec = runtimeSpecs.find(
          (candidate) => candidate.executable === executable,
        );
        assert.ok(spec, `no Runtime spec for ${executable}`);
        const runtime = inventory.runtimes.find(
          (candidate) =>
            candidate.configured &&
            candidate.runtimeProfileId === spec.runtimeProfileId,
        );
        assert.ok(runtime, `configured Runtime missing for ${executable}`);
        assert.ok(runtime.runtimeOfferId);
        const binding = runtime.modelBindingDescriptors.find(
          (candidate) => candidate.modelId === modelId,
        );
        assert.ok(binding, `${executable} catalog did not publish ${modelId}`);
        assert.ok(
          binding.supportedReasoning.includes(reasoning),
          `${executable} ${modelId} does not publish authorized reasoning ${reasoning} (published: ${binding.supportedReasoning.join(", ")})`,
        );
        return {
          modelBindingId: binding.modelBindingId,
          runtimeOfferId: runtime.runtimeOfferId,
        };
      };

      const participantIdByHandle = new Map<CoreChainHandle, string>();
      const definitionIdByHandle = new Map<CoreChainHandle, string>();
      const handleByParticipantId = new Map<string, string>();

      const configureAgent = async (input: {
        agentId: string;
        executable: string;
        handle: string;
        idempotencyKey: string;
        modelId: string;
        reasoning: string;
      }): Promise<void> => {
        const { modelBindingId, runtimeOfferId } = authorizedRuntime(
          input.executable,
          input.modelId,
          input.reasoning,
        );
        const spec = runtimeSpecs.find(
          (candidate) => candidate.executable === input.executable,
        );
        assert.ok(spec);
        const control = await syncRoom(
          originOf(),
          token,
          controlRoomId,
          "core-chain-control",
        );
        await postJson(originOf(), token, "/v3/client/agents/manage", {
          action: "configure",
          agentId: input.agentId,
          basedOnRoomSeq: control.latestRoomSeq,
          displayName: `core-chain ${input.handle}`,
          handle: input.handle,
          idempotencyKey: input.idempotencyKey,
          instructions: AGENT_INSTRUCTIONS,
          modelIntent: {
            exactBindingIds: [modelBindingId],
            fallback: "disabled",
            reasoning: input.reasoning,
            serviceTier: "default",
          },
          role: spec.role,
          runtimeOfferId,
          toolAccessMode: "full_access",
        });
      };

      for (const [index, role] of ROLES.entries()) {
        const spec = runtimeSpecs[index]!;
        const agent = catalog.agents.find(
          (candidate) => candidate.handle === spec.agentHandle,
        );
        assert.ok(agent, `Agent missing for ${role.executable}`);
        await configureAgent({
          agentId: agent.definition.agentId,
          executable: role.executable,
          handle: role.handle,
          idempotencyKey: `core-chain-config-${role.handle}`,
          modelId: role.modelId,
          reasoning: role.reasoning,
        });
        participantIdByHandle.set(role.handle, agent.definition.participantId);
        definitionIdByHandle.set(role.handle, agent.definition.agentId);
        handleByParticipantId.set(agent.definition.participantId, role.handle);
        const roomDelivery = await syncRoom(
          originOf(),
          token,
          roomA,
          "core-chain-room-admin",
        );
        await postJson(originOf(), token, "/v3/client/rooms/members/add", {
          principalId: agent.definition.participantId,
          role: "member",
          basedOnRoomSeq: roomDelivery.latestRoomSeq,
          idempotencyKey: `core-chain-onboard-a-${role.handle}`,
          roomId: roomA,
        });
      }

      const memA = participantIdByHandle.get("mem-a")!;
      const memB = participantIdByHandle.get("mem-b")!;
      const steadyC = participantIdByHandle.get("steady-c")!;
      const agentIds = new Set([memA, memB, steadyC]);

      // Room B: `mem-a` and `steady-c` only. `mem-b` is deliberately left out,
      // which is what makes 2.2/2.3 provable at all.
      const control = await syncRoom(
        originOf(),
        token,
        controlRoomId,
        "core-chain-control",
      );
      const createdRoomB = await postJson<{ room: { roomId: string } }>(
        originOf(),
        token,
        "/v3/client/rooms/create",
        {
          basedOnControlRoomSeq: control.latestRoomSeq,
          idempotencyKey: "core-chain-room-b",
          kind: "channel",
          name: "core-chain-room-b",
          slug: "core-chain-room-b",
          workspaceId: prepared.metadata.workspaceId,
        },
      );
      const roomB = createdRoomB.room.roomId;
      for (const handle of ["mem-a", "steady-c"] as const) {
        const delivery = await syncRoom(
          originOf(),
          token,
          roomB,
          "core-chain-room-b-admin",
        );
        await postJson(originOf(), token, "/v3/client/rooms/members/add", {
          principalId: participantIdByHandle.get(handle)!,
          role: "member",
          basedOnRoomSeq: delivery.latestRoomSeq,
          idempotencyKey: `core-chain-onboard-b-${handle}`,
          roomId: roomB,
        });
      }

      let dmRoom: string | undefined;
      const rooms = (): string[] => [
        roomA,
        roomB,
        ...(dmRoom === undefined ? [] : [dmRoom]),
      ];

      const activationsOf = () =>
        rooms()
          .flatMap((roomId) => activeObserver.listActivations({ roomId }))
          .filter((activation) => agentIds.has(activation.participantId));
      const runAttemptsOf = () =>
        rooms().flatMap((roomId) => activeObserver.listRunAttempts({ roomId }));
      const messagesOf = (roomId: string) =>
        activeObserver.listMessages(humanActor, { roomId }).messages;
      const allMessages = () => rooms().flatMap((roomId) => messagesOf(roomId));
      const agentsIdle = () =>
        activationsOf().every(
          (activation) =>
            activation.state !== "queued" && activation.state !== "leased",
        );
      const allActivationsTerminal = () => {
        const activations = activationsOf();
        return (
          activations.length > 0 &&
          activations.every((activation) =>
            ["cancelled", "completed", "quarantined"].includes(
              activation.state,
            ),
          )
        );
      };
      const diagnose = () =>
        JSON.stringify(
          {
            activations: activationsOf().map((activation) => ({
              activationId: activation.activationId,
              participant:
                handleByParticipantId.get(activation.participantId) ??
                activation.participantId,
              reason: activation.reason,
              roomId: activation.roomId,
              state: activation.state,
            })),
            messages: allMessages().map((message) => ({
              actor: handleByParticipantId.get(message.actorId) ?? "human",
              body: message.body.slice(0, 240),
              roomId: message.roomId,
              roomSeq: message.roomSeq,
            })),
            runAttempts: runAttemptsOf().map((attempt) => ({
              attemptNumber: attempt.attemptNumber,
              exitCode: attempt.exitCode,
              participant:
                handleByParticipantId.get(attempt.participantId) ??
                attempt.participantId,
              runAttemptId: attempt.runAttemptId,
              state: attempt.state,
            })),
          },
          undefined,
          2,
        );

      /** Posts one Human message at the latest Room sequence. */
      const humanSay = async (input: {
        body: string;
        idempotencyKey: string;
        recipients: { participantId: string; reason: "dm" | "mention" }[];
        roomId: string;
      }): Promise<{
        event: { aggregateId: string; eventId: string; roomSeq: number };
      }> => {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const delivery = await syncRoom(
            originOf(),
            token,
            input.roomId,
            "core-chain-human",
          );
          const response = await fetch(
            `${originOf()}/v3/client/messages/post`,
            {
              body: JSON.stringify({
                basedOnRoomSeq: delivery.latestRoomSeq,
                body: input.body,
                idempotencyKey: input.idempotencyKey,
                recipients: input.recipients,
                roomId: input.roomId,
              }),
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
              },
              method: "POST",
            },
          );
          const parsed = (await response.json()) as {
            error?: { code?: string };
            event?: { aggregateId: string; eventId: string; roomSeq: number };
          };
          if (response.status === 200) {
            assert.ok(parsed.event);
            return { event: parsed.event };
          }
          assert.equal(
            parsed.error?.code,
            "stale_context",
            `messages/post: ${JSON.stringify(parsed)}`,
          );
        }
        throw new Error("messages/post never committed at the latest sequence");
      };

      /**
       * One Human turn: post, then wait for every addressed Agent to answer.
       * `waitFor` names the answering Agents when they are not simply the
       * recipients, which is what lets one message carry two unrelated
       * questions to two Agents without weakening either row's evidence.
       */
      const turn = async (input: {
        body: string;
        idempotencyKey: string;
        label: string;
        recipients: { participantId: string; reason: "dm" | "mention" }[];
        roomId: string;
        waitFor?: readonly string[];
      }): Promise<{
        event: { aggregateId: string; eventId: string; roomSeq: number };
        replies: { actorId: string; body: string }[];
      }> => {
        const posted = await humanSay(input);
        const targets =
          input.waitFor ??
          input.recipients.map((recipient) => recipient.participantId);
        const replies = () =>
          messagesOf(input.roomId).filter(
            (message) =>
              targets.includes(message.actorId) &&
              message.roomSeq > posted.event.roomSeq,
          );
        await waitForOutcome({
          deadline: gateDeadline,
          diagnose,
          label: input.label,
          stalled: allActivationsTerminal,
          succeeded: () =>
            targets.every((target) =>
              replies().some((message) => message.actorId === target),
            ) && agentsIdle(),
        });
        return {
          event: posted.event,
          replies: replies().map((message) => ({
            actorId: message.actorId,
            body: message.body,
          })),
        };
      };

      // ---------------------------------------------------------------
      // Scenario 5 (formation) + scenario 2 (cross-Room).
      // ---------------------------------------------------------------
      const formation = await turn({
        body: `@mem-a [CCG-1] 请记住一条只属于你的信息：S5 项目代号是 ${S5_ORIGINAL}。存进你自己的记忆，然后确认已存。`,
        idempotencyKey: "core-chain-s5-form",
        label: "mem-a stores the S5 code in Room A",
        recipients: [{ participantId: memA, reason: "mention" }],
        roomId: roomA,
      });
      observations["5.4-formation-reply"] = formation.replies;

      const memAMemory = agentMemoryWorkspacePath(memoryRoot, memA);
      const memBMemory = agentMemoryWorkspacePath(memoryRoot, memB);
      const formationFiles = readMemoryTree(memAMemory);
      record(
        "5.1",
        "asserted",
        {
          hits: formationFiles
            .filter((file) => file.text.includes(S5_ORIGINAL))
            .map((file) => file.path),
          memoryDirectory: memAMemory,
        },
        `${S5_ORIGINAL} must be on disk under mem-a's memory directory`,
      );
      assert.ok(
        formationFiles.some((file) => file.text.includes(S5_ORIGINAL)),
        `5.1 failed: ${S5_ORIGINAL} is not in any file under ${memAMemory}; the model claimed or declined to save it. Files: ${JSON.stringify(formationFiles.map((file) => file.path))}`,
      );

      const formationAttempt = runAttemptsOf()
        .filter(
          (attempt) =>
            attempt.participantId === memA && attempt.roomId === roomA,
        )
        .at(-1);
      assert.ok(formationAttempt);
      const formationReceipt = await readAgentMemoryMaterializationReceipt({
        rootDirectory: memoryRoot,
        runAttemptId: formationAttempt.runAttemptId,
      });
      assert.ok(formationReceipt, "5.2 failed: no materialization receipt");
      assert.equal(formationReceipt.ownerParticipantId, memA);
      assert.equal(formationReceipt.schemaVersion, 2);
      record("5.2", "asserted", {
        ownerParticipantId: formationReceipt.ownerParticipantId,
        runAttemptId: formationAttempt.runAttemptId,
        schemaVersion: formationReceipt.schemaVersion,
      });

      // Room B, addressed to mem-a only.
      const crossRoom = await turn({
        body: `@mem-a [CCG-2] 这是另一个房间。请只回答：S5 项目代号是什么？并说明你从哪里读到的。`,
        idempotencyKey: "core-chain-s2-mem-a",
        label: "mem-a answers in Room B",
        recipients: [{ participantId: memA, reason: "mention" }],
        roomId: roomB,
      });
      observations["5.4-cross-room-reply"] = crossRoom.replies;
      record(
        "5.4",
        "observed",
        {
          containsOriginal: crossRoom.replies.some((reply) =>
            reply.body.includes(S5_ORIGINAL),
          ),
          replies: crossRoom.replies,
        },
        "whether the model recalled is a model behavior; the ledger has no read-memory column",
      );
      record(
        "2.9",
        "observed",
        {
          replies: crossRoom.replies,
        },
        "recall itself is observed; only the memory directory and its receipt are asserted",
      );

      // Room B, addressed to steady-c only: message addressing must be exact.
      const crossRoomSecond = await turn({
        body: `@steady-c [CCG-3] 请在这个房间确认：mem-a 刚才在本房间说了什么？只回答一句。`,
        idempotencyKey: "core-chain-s2-steady-c",
        label: "steady-c answers in Room B",
        recipients: [{ participantId: steadyC, reason: "mention" }],
        roomId: roomB,
      });
      observations["2.4-steady-c-reply"] = crossRoomSecond.replies;

      const memberships = activeObserver.listRoomMemberships(humanActor, {
        roomId: roomB,
      });
      const memberIds = new Set(
        memberships.map((membership) => membership.principalId),
      );
      assert.ok(memberIds.has(memA) && memberIds.has(steadyC));
      assert.ok(!memberIds.has(memB), "2.1 failed: mem-b joined Room B");
      record("2.1", "asserted", {
        members: [...memberIds].map(
          (principalId) =>
            handleByParticipantId.get(principalId) ??
            (principalId === humanId ? "human" : principalId),
        ),
        roomId: roomB,
      });

      const roomBInbox = inboxItems(databasePath, { roomId: roomB });
      assert.equal(
        roomBInbox.filter((item) => item.participantId === memB).length,
        0,
        "2.2 failed: a Room B event was delivered to the non-member mem-b",
      );
      record("2.2", "asserted", {
        byParticipant: countBy(
          roomBInbox,
          (item) =>
            handleByParticipantId.get(item.participantId) ?? item.participantId,
        ),
      });
      const roomBActivations = activeObserver.listActivations({
        roomId: roomB,
      });
      assert.equal(
        roomBActivations.filter(
          (activation) => activation.participantId === memB,
        ).length,
        0,
        "2.3 failed: the non-member mem-b was activated for a Room B event",
      );
      record("2.3", "asserted", {
        byParticipant: countBy(
          roomBActivations,
          (activation) =>
            handleByParticipantId.get(activation.participantId) ??
            activation.participantId,
        ),
      });

      const mentionsOf = (eventId: string) =>
        roomBInbox
          .filter(
            (item) => item.eventId === eventId && item.reason === "mention",
          )
          .map(
            (item) =>
              handleByParticipantId.get(item.participantId) ??
              item.participantId,
          );
      assert.deepEqual(mentionsOf(crossRoom.event.eventId), ["mem-a"]);
      assert.deepEqual(mentionsOf(crossRoomSecond.event.eventId), ["steady-c"]);
      record("2.4", "asserted", {
        "ccg-2 mentions": mentionsOf(crossRoom.event.eventId),
        "ccg-3 mentions": mentionsOf(crossRoomSecond.event.eventId),
      });

      // Context attribution: a reply lands in the Room it was addressed to.
      const roomBAgentMessages = messagesOf(roomB).filter((message) =>
        agentIds.has(message.actorId),
      );
      assert.ok(roomBAgentMessages.length > 0);
      assert.ok(
        roomBAgentMessages.every((message) => message.roomId === roomB),
        "2.5 failed: a Room B reply carries another Room's room_id",
      );
      const roomAMessageIds = new Set(
        messagesOf(roomA).map((message) => message.messageId),
      );
      assert.ok(
        roomBAgentMessages.every(
          (message) => !roomAMessageIds.has(message.messageId),
        ),
        "2.5 failed: one message_id appears in two Rooms",
      );
      record("2.5", "asserted", {
        roomBAgentMessages: roomBAgentMessages.map((message) => ({
          actor: handleByParticipantId.get(message.actorId),
          roomId: message.roomId,
        })),
      });

      for (const activation of [
        ...activeObserver.listActivations({ roomId: roomA }),
        ...roomBActivations,
      ]) {
        const bound = maxRoomSeq(databasePath, activation.roomId);
        assert.ok(
          activation.fromSeq <= bound && activation.toSeq <= bound,
          `2.6 failed: Activation ${activation.activationId} spans [${String(activation.fromSeq)},${String(activation.toSeq)}] beyond room ${activation.roomId} bound ${String(bound)}`,
        );
      }
      record("2.6", "asserted", {
        roomBounds: Object.fromEntries(
          [roomA, roomB].map((roomId) => [
            roomId,
            maxRoomSeq(databasePath, roomId),
          ]),
        ),
      });

      const readPositions = workerReadPositions(databasePath, memA);
      assert.ok(
        readPositions.some((position) => position.roomId === roomA) &&
          readPositions.some((position) => position.roomId === roomB),
        `2.7 failed: mem-a has no per-Room read position pair: ${JSON.stringify(readPositions)}`,
      );
      record("2.7", "asserted", { readPositions });

      const memoryDirectories = readdirSync(memoryRoot).filter(
        (entry) => entry !== ".materialization-receipts",
      );
      assert.ok(
        memoryDirectories.includes(relative(memoryRoot, memAMemory)),
        "2.8 failed: mem-a's memory directory changed identity",
      );
      record("2.8", "asserted", {
        directories: memoryDirectories,
        memAMemory,
      });

      // ---------------------------------------------------------------
      // Scenario 3: DM continuity.
      // ---------------------------------------------------------------
      const directControl = await syncRoom(
        originOf(),
        token,
        controlRoomId,
        "core-chain-control",
      );
      const opened = await postJson<{ room: { roomId: string } }>(
        originOf(),
        token,
        "/v3/client/rooms/direct/open",
        {
          basedOnControlRoomSeq: directControl.latestRoomSeq,
          idempotencyKey: "core-chain-dm-open",
          peerPrincipalId: memA,
          workspaceId: prepared.metadata.workspaceId,
        },
      );
      dmRoom = opened.room.roomId;

      const pair = directRoomPair(databasePath, dmRoom);
      assert.ok(pair, "3.1 failed: no direct_room_pairs row for the DM");
      assert.deepEqual(
        [pair.leftPrincipalId, pair.rightPrincipalId].sort(),
        [humanId, memA].sort(),
      );
      assert.ok(pair.leftPrincipalId < pair.rightPrincipalId);
      record("3.1", "asserted", { pair, roomId: dmRoom });

      const directOpenedEvents = roomEventTypes(databasePath, [
        "workspace.direct_opened",
      ]);
      assert.ok(
        directOpenedEvents.length > 0,
        "3.2 failed: no workspace.direct_opened event",
      );
      record("3.2", "asserted", { events: directOpenedEvents });

      const dmTurn = await turn({
        body: `[CCG-4] 这里是私聊。请回答两件事：1) S5 项目代号是什么，你从哪里读到的；2) 请记住一条只属于你的信息：S3 私聊口令是 ${S3_PASSPHRASE}，存进你自己的记忆并确认已存。`,
        idempotencyKey: "core-chain-dm-1",
        label: "mem-a answers and stores in the DM",
        recipients: [{ participantId: memA, reason: "dm" }],
        roomId: dmRoom,
      });
      observations["3.6-dm-reply"] = dmTurn.replies;

      const dmInbox = inboxItems(databasePath, { roomId: dmRoom }).filter(
        (item) => item.eventId === dmTurn.event.eventId,
      );
      record(
        "3.3",
        "asserted",
        { reasons: dmInbox.map((item) => item.reason) },
        "the protocol accepts either dm or room_policy here; the measured value is recorded",
      );
      assert.ok(dmInbox.some((item) => item.participantId === memA));

      const dmAgentMessages = messagesOf(dmRoom).filter(
        (message) => message.actorId === memA,
      );
      assert.ok(dmAgentMessages.length > 0);
      assert.ok(dmAgentMessages.every((message) => message.roomId === dmRoom));
      record("3.4", "asserted", {
        dmRoomId: dmRoom,
        replies: dmAgentMessages.length,
      });

      const dmAttempt = runAttemptsOf()
        .filter(
          (attempt) =>
            attempt.participantId === memA && attempt.roomId === dmRoom,
        )
        .at(-1);
      assert.ok(dmAttempt);
      const dmReceipt = await readAgentMemoryMaterializationReceipt({
        rootDirectory: memoryRoot,
        runAttemptId: dmAttempt.runAttemptId,
      });
      assert.ok(dmReceipt, "3.5 failed: the DM Run has no memory receipt");
      assert.equal(dmReceipt.ownerParticipantId, memA);
      record("3.5", "asserted", {
        memoryDirectory: memAMemory,
        ownerParticipantId: dmReceipt.ownerParticipantId,
        runAttemptId: dmAttempt.runAttemptId,
      });
      record(
        "3.6",
        "observed",
        { replies: dmTurn.replies },
        "cross-Room recall inside the DM is a model behavior; only the directory and receipt are asserted",
      );

      const afterDmFiles = readMemoryTree(memAMemory);
      const passphraseHits = afterDmFiles
        .filter((file) => file.text.includes(S3_PASSPHRASE))
        .map((file) => file.path);
      assert.ok(
        passphraseHits.length > 0,
        `3.7 failed: ${S3_PASSPHRASE} is in no file under ${memAMemory}; the model said it saved but the filesystem disagrees`,
      );
      record("3.7", "asserted", { hits: passphraseHits });

      // S5 was published in Room A, where mem-b is a member. It is not a
      // private fact. Test the DM-only S3 before allowing mem-a to publish it.
      const negativeControlHead = await syncRoom(
        originOf(),
        token,
        controlRoomId,
        "core-chain-control",
      );
      const negativeDm = await postJson<{ room: { roomId: string } }>(
        originOf(),
        token,
        "/v3/client/rooms/direct/open",
        {
          basedOnControlRoomSeq: negativeControlHead.latestRoomSeq,
          idempotencyKey: "core-chain-negative-dm-open",
          peerPrincipalId: memB,
          workspaceId: prepared.metadata.workspaceId,
        },
      );
      assert.notEqual(negativeDm.room.roomId, dmRoom);
      const negative = await turn({
        body: "[CCG-6] 请只读取你自己的私有记忆，回答 S3 私聊口令是什么。如果不知道请明确说不知道。不要猜，不要询问其他Agent或搜索聊天历史。",
        idempotencyKey: "core-chain-s3-negative-private",
        label: "mem-b negative control before any public S3 disclosure",
        recipients: [{ participantId: memB, reason: "dm" }],
        roomId: negativeDm.room.roomId,
      });
      observations["5.6-negative-reply"] = negative.replies;
      const memBFiles = readMemoryTree(memBMemory);
      assert.equal(
        memBFiles.filter((file) => file.text.includes(S3_PASSPHRASE)).length,
        0,
        "5.6/3.9 failed: DM-only S3 appeared in the other Agent's memory before disclosure",
      );
      assert.ok(
        negative.replies.every((reply) => !reply.body.includes(S3_PASSPHRASE)),
        "5.6/3.9 failed: negative control spoke the unexposed DM-only fact",
      );
      for (const roomId of [roomA, roomB, negativeDm.room.roomId]) {
        assert.ok(
          messagesOf(roomId).every(
            (message) => !message.body.includes(S3_PASSPHRASE),
          ),
          "invalid negative control: S3 was already disclosed in a shared target",
        );
      }
      record("5.6", "asserted", {
        memBFiles: memBFiles.map((file) => file.path),
        replies: negative.replies,
        scope: "DM-only S3, before public recall; public S5 is excluded",
      });
      record("3.9", "asserted", {
        memBFiles: memBFiles.map((file) => file.path),
        replies: negative.replies,
      });
      const backInRoom = await turn({
        body: "@mem-a [CCG-5] 负对照已结束，现在请在这个房间说出 S3 私聊口令。",
        idempotencyKey: "core-chain-s3-return-after-negative",
        label: "mem-a returns from DM after the independent negative control",
        recipients: [{ participantId: memA, reason: "mention" }],
        roomId: roomA,
      });
      observations["3.8-return-reply"] = backInRoom.replies;
      record(
        "3.8",
        "observed",
        {
          containsPassphrase: backInRoom.replies.some((reply) =>
            reply.body.includes(S3_PASSPHRASE),
          ),
          replies: backInRoom.replies,
        },
        "public recall runs only after the private negative control is complete",
      );

      assert.notEqual(memAMemory, memBMemory);
      const modes = {
        memAIndex: (statSync(join(memAMemory, "MEMORY.md")).mode & 0o777)
          .toString(8)
          .padStart(3, "0"),
        memAWorkspace: (statSync(memAMemory).mode & 0o777)
          .toString(8)
          .padStart(3, "0"),
        memBIndex: (statSync(join(memBMemory, "MEMORY.md")).mode & 0o777)
          .toString(8)
          .padStart(3, "0"),
        memBWorkspace: (statSync(memBMemory).mode & 0o777)
          .toString(8)
          .padStart(3, "0"),
      };
      assert.equal(modes.memAWorkspace, "700");
      assert.equal(modes.memBWorkspace, "700");
      assert.equal(modes.memAIndex, "600");
      assert.equal(modes.memBIndex, "600");
      record("5.7", "asserted", modes);

      const homes = agentMemoryHomes(databasePath, [memA, memB, steadyC]);
      const memAHome = homes.find((home) => home.participantId === memA);
      assert.ok(memAHome);
      assert.equal(memAHome.state, "bound");
      assert.ok(memAHome.ownerHostId);
      record("5.11", "asserted", {
        homes: homes.map((home) => ({
          handle: handleByParticipantId.get(home.participantId),
          ownerHostIdPresent: home.ownerHostId !== null,
          state: home.state,
        })),
      });

      // ---------------------------------------------------------------
      // Scenario 5: correction, then a brand new session.
      // ---------------------------------------------------------------
      const correction = await turn({
        body: `@mem-a [CCG-7] 更正：S5 项目代号从 ${S5_ORIGINAL} 改为 ${S5_CORRECTED}。请更新你的记忆，让旧值不再被当作当前事实。`,
        idempotencyKey: "core-chain-s5-correct",
        label: "mem-a records the correction",
        recipients: [{ participantId: memA, reason: "mention" }],
        roomId: roomA,
      });
      observations["5.8-correction-reply"] = correction.replies;
      const correctedFiles = readMemoryTree(memAMemory);
      const correctedHits = correctedFiles.filter((file) =>
        file.text.includes(S5_CORRECTED),
      );
      assert.ok(
        correctedHits.length > 0,
        `5.8 failed: ${S5_CORRECTED} is in no file under ${memAMemory} after the correction`,
      );
      record(
        "5.8",
        "asserted",
        {
          correctedHits: correctedHits.map((file) => file.path),
          staleStillPresentIn: correctedFiles
            .filter((file) => file.text.includes(S5_ORIGINAL))
            .map((file) => file.path),
          supersessionText: correctedFiles
            .flatMap((file) =>
              file.text
                .split("\n")
                .filter(
                  (line) =>
                    line.includes(S5_ORIGINAL) || line.includes(S5_CORRECTED),
                )
                .map((line) => `${file.path}: ${line.trim()}`),
            )
            .slice(0, 40),
        },
        "the corrected value on disk is asserted; whether the old value is marked superseded is Human judgment over the quoted lines",
      );

      // A new RunAttempt can resume the same provider session. Use the real
      // Human reset facade, preserve private memory, and verify native identity.
      const providerDirectory = join(
        stateDirectory,
        "supervisors",
        "provider-sessions",
      );
      const sessionsBeforeReset = providerSessionIds(providerDirectory, memA);
      assert.ok(
        sessionsBeforeReset.length > 0,
        "correction must produce provider continuity evidence",
      );
      const memoryBeforeReset = readMemoryTree(memAMemory);
      const resetControl = await syncRoom(
        originOf(),
        token,
        prepared.metadata.controlRoomId,
        "core-chain-reset",
      );
      const sessionReset = await postJson<{
        providerContinuityRecords: number;
      }>(originOf(), token, "/v3/client/agents/execution/reset", {
        agentId: definitionIdByHandle.get("mem-a")!,
        basedOnRoomSeq: resetControl.latestRoomSeq,
        idempotencyKey: "core-chain-fresh-provider-session",
        mode: "session",
      });
      assert.ok(sessionReset.providerContinuityRecords > 0);
      assert.deepEqual(
        readMemoryTree(memAMemory),
        memoryBeforeReset,
        "session reset preserves Agent private files",
      );
      assert.deepEqual(
        providerSessionIds(providerDirectory, memA),
        [],
        "session reset removes resumable continuity",
      );

      const beforeNewSession = runAttemptsOf()
        .filter((attempt) => attempt.participantId === memA)
        .map((attempt) => attempt.runAttemptId);
      const newSession = await turn({
        body: `@mem-a [CCG-8] 请说出 S5 项目代号的当前值，并说明你从哪里读到的。`,
        idempotencyKey: "core-chain-s5-new-session",
        label: "a new mem-a session recalls the corrected value",
        recipients: [{ participantId: memA, reason: "mention" }],
        roomId: roomB,
      });
      observations["5.9-new-session-reply"] = newSession.replies;
      const sessionsAfterReset = providerSessionIds(providerDirectory, memA);
      assertFreshProviderSessions(sessionsBeforeReset, sessionsAfterReset);
      assert.ok(
        newSession.replies.some(
          (reply) =>
            reply.actorId === memA && reply.body.includes(S5_CORRECTED),
        ),
        "new provider session recalls the corrected value",
      );
      observations["5.9-provider-reset"] = {
        sessionsBeforeReset,
        sessionsAfterReset,
        resetReceipt: sessionReset,
      };

      const newSessionAttempt = runAttemptsOf()
        .filter(
          (attempt) =>
            attempt.participantId === memA &&
            !beforeNewSession.includes(attempt.runAttemptId),
        )
        .at(-1);
      assert.ok(
        newSessionAttempt,
        "5.9 failed: the recall did not run in a new RunAttempt",
      );
      const newSessionReceipt = await readAgentMemoryMaterializationReceipt({
        rootDirectory: memoryRoot,
        runAttemptId: newSessionAttempt.runAttemptId,
      });
      assert.ok(newSessionReceipt);
      assert.equal(newSessionReceipt.ownerParticipantId, memA);
      record(
        "5.9",
        "observed",
        {
          containsCorrected: newSession.replies.some((reply) =>
            reply.body.includes(S5_CORRECTED),
          ),
          containsStale: newSession.replies.some((reply) =>
            reply.body.includes(S5_ORIGINAL),
          ),
          newRunAttemptId: newSessionAttempt.runAttemptId,
          replies: newSession.replies,
        },
        "provider session identity changed through Human session reset; private files are unchanged by reset and corrected recall is asserted; mentions of the old value still require semantic review",
      );
      record("5.3", "asserted", {
        memoryDirectory: memAMemory,
        receiptOwners: [
          formationReceipt.ownerParticipantId,
          dmReceipt.ownerParticipantId,
          newSessionReceipt.ownerParticipantId,
        ],
      });
      record(
        "5.12",
        "asserted",
        {
          contextManifestMemoryKeys: contextManifestMemoryKeys(
            databasePath,
            newSessionAttempt.runAttemptId,
          ),
        },
        "the manifest carries only memoryPolicyRef: no ledger column proves a model read its memory",
      );

      // ---------------------------------------------------------------
      // Scenario 4: switch the model while collaboration is in progress.
      //
      // Everything scenario 4 proves has to happen live, so it is never
      // started on a budget that cannot hold it. Run 1 paid for the switch and
      // for the post-switch Human turn and then hit its wall 31 s after the
      // last placement, which made 4.3 unsatisfiable by any implementation.
      // ---------------------------------------------------------------
      const scenario4Remaining = gateDeadline - Date.now();
      assert.ok(
        scenario4Remaining >= SCENARIO_4_RESERVE_MS,
        `scenario 4 not started: only ${String(Math.round(scenario4Remaining / 1000))} s of the ${String(Math.round(GATE_TIMEOUT_MS / 1000))} s budget remain and it needs at least ${String(Math.round(SCENARIO_4_RESERVE_MS / 1000))} s. This is a harness budget failure, not a product failure: raise RAH_CORE_CHAIN_TIMEOUT_MS and re-run. Scenarios 2, 3 and 5 above are unaffected.`,
      );

      const baselineDefinition = agentDefinitionState(
        databasePath,
        definitionIdByHandle.get("mem-a")!,
      );
      const steadyBaseline = agentDefinitionState(
        databasePath,
        definitionIdByHandle.get("steady-c")!,
      );

      const busyMessage = await humanSay({
        body: [
          `@mem-a [CCG-9] 请用终端执行 mkdir -p acceptance && touch ${S4_ACTIVE_MARKER}; sleep 12，`,
          `然后把 ${S4_EXEC_FILE} 写成一行 ${S4_EXEC_BODY}，最后只回复 ${S4_EXEC_DONE}。`,
          `@steady-c [CCG-9] 请独立地把 ${S4_AUDIT_FILE} 写成一行 ${S4_AUDIT_BODY}，然后只回复 ${S4_AUDIT_DONE}。`,
        ].join(" "),
        idempotencyKey: "core-chain-s4-busy",
        recipients: [
          { participantId: memA, reason: "mention" },
          { participantId: steadyC, reason: "mention" },
        ],
        roomId: roomA,
      });

      // The busy window is judged from the ledger plus a workspace marker, never
      // from a timer.
      const runningAttemptOf = (participantId: string) =>
        runAttemptsOf().find(
          (attempt) =>
            attempt.participantId === participantId &&
            attempt.state === "running",
        );
      await waitForOutcome({
        deadline: gateDeadline,
        diagnose,
        label: "mem-a busy window (running RunAttempt plus workspace marker)",
        stalled: allActivationsTerminal,
        succeeded: () =>
          runningAttemptOf(memA) !== undefined &&
          existsSync(join(workspaceDirectory, S4_ACTIVE_MARKER)),
      });
      const preSwitchAttempt = runningAttemptOf(memA);
      assert.ok(preSwitchAttempt);
      const preSwitchPlacement = activeObserver
        .listPlacements({ roomId: roomA })
        .find(
          (placement) =>
            placement.placementId === preSwitchAttempt.placement?.placementId,
        );
      assert.ok(preSwitchPlacement);
      const frozenSnapshot = JSON.stringify({
        agentDefinitionRevisionId: preSwitchPlacement.agentDefinitionRevisionId,
        executionPolicyRevisionId: preSwitchPlacement.executionPolicyRevisionId,
        resolvedModel: preSwitchPlacement.resolvedModel,
        runtimeProfileRevisionId: preSwitchPlacement.runtimeProfileRevisionId,
      });

      // The switch itself.
      await configureAgent({
        agentId: definitionIdByHandle.get("mem-a")!,
        executable: SWITCH_TARGET.executable,
        handle: "mem-a",
        idempotencyKey: "core-chain-s4-switch",
        modelId: SWITCH_TARGET.modelId,
        reasoning: SWITCH_TARGET.reasoning,
      });

      const switchedDefinition = agentDefinitionState(
        databasePath,
        definitionIdByHandle.get("mem-a")!,
      );
      assert.notEqual(
        switchedDefinition.currentRevisionId,
        baselineDefinition.currentRevisionId,
        "4.1 failed: the switch did not write a new AgentDefinition revision",
      );
      assert.notEqual(
        switchedDefinition.executionPolicyRevisionId,
        baselineDefinition.executionPolicyRevisionId,
        "4.1 failed: the switch reused the old ExecutionPolicy revision",
      );
      assert.ok(
        agentDefinitionRevisionExists(
          databasePath,
          baselineDefinition.currentRevisionId,
        ),
        "4.1 failed: the old revision row disappeared",
      );
      record("4.1", "asserted", {
        after: switchedDefinition,
        before: baselineDefinition,
      });

      const switchedIntent = modelIntentOf(
        databasePath,
        switchedDefinition.executionPolicyRevisionId,
      );
      assert.equal(switchedIntent.reasoning, SWITCH_TARGET.reasoning);
      assert.equal(switchedIntent.exactBindingIds.length, 1);
      const switchTargetRuntime = authorizedRuntime(
        SWITCH_TARGET.executable,
        SWITCH_TARGET.modelId,
        SWITCH_TARGET.reasoning,
      );
      assert.equal(
        switchedIntent.exactBindingIds[0],
        switchTargetRuntime.modelBindingId,
      );
      assert.deepEqual(switchedIntent.allowedOfferIds, [
        switchTargetRuntime.runtimeOfferId,
      ]);
      record("4.2", "asserted", switchedIntent);

      // The switch has to be observable in the ledger before anything is
      // asserted about what it did, so the exact `agent.configured` moment is
      // read back and every later claim is timed against it.
      const switchEvent = agentConfiguredEventAt(
        databasePath,
        switchedDefinition.currentRevisionId,
      );
      assert.ok(
        switchEvent,
        `4.1 failed: the switch wrote revision ${switchedDefinition.currentRevisionId} but no agent.configured event carries it`,
      );
      const switchedAtMs = Date.parse(switchEvent);

      // The post-switch turn: a genuinely independent question that neither
      // cancels nor replaces the original request, and a mention mem-a is
      // obliged to answer, so a post-switch wake is guaranteed rather than
      // hoped for. The dwell keeps its process alive long enough for the live
      // argv snapshot and for the restart to land on a Run in flight.
      const followUp = await humanSay({
        body: [
          `@mem-a [CCG-10] 插一个独立的新问题，它不取消也不替换你上一条尚未发出的结论：`,
          `请先执行 sleep 10，然后回答两件事：${S4_EXEC_FILE} 现在存在吗（只答 EXISTS 或 MISSING），`,
          `以及 S5 项目代号的当前值是什么。两条答复都要，各自作为一条消息发出。`,
        ].join(" "),
        idempotencyKey: "core-chain-s4-followup",
        recipients: [{ participantId: memA, reason: "mention" }],
        roomId: roomA,
      });

      // Wait for the evidence instead of assuming it. A placement is the
      // scheduler's own record of a decision taken for mem-a, so the gate
      // waits until one exists that was created after the switch event and
      // carries the switched AgentDefinition revision. What that placement
      // resolved to is then asserted, which is what separates "the switch
      // never reached a Run" (a harness or scheduling gap) from "the Run kept
      // the old model" (a product defect).
      const placementsOfMemA = () =>
        rooms()
          .flatMap((roomId) => activeObserver.listPlacements({ roomId }))
          .filter((placement) => placement.participantId === memA)
          .sort(
            (left, right) =>
              Date.parse(left.createdAt) - Date.parse(right.createdAt),
          );
      const postSwitchPlacements = () =>
        placementsOfMemA().filter(
          (placement) =>
            Date.parse(placement.createdAt) > switchedAtMs &&
            placement.agentDefinitionRevisionId ===
              switchedDefinition.currentRevisionId,
        );
      const switchTimeline = () =>
        JSON.stringify(
          {
            lastPreSwitchPlacement: placementsOfMemA()
              .filter(
                (placement) => Date.parse(placement.createdAt) <= switchedAtMs,
              )
              .at(-1),
            memAPlacements: placementsOfMemA().map((placement) => ({
              agentDefinitionRevisionId: placement.agentDefinitionRevisionId,
              createdAt: placement.createdAt,
              placementId: placement.placementId,
              resolvedModel: placement.resolvedModel,
              state: placement.state,
            })),
            postSwitchHumanMessageRoomSeq: followUp.event.roomSeq,
            switchedAgentDefinitionRevisionId:
              switchedDefinition.currentRevisionId,
            switchEventAt: switchEvent,
          },
          undefined,
          2,
        );

      const postSwitchDeadline = Math.min(
        Date.now() + POST_SWITCH_WAIT_MS,
        gateDeadline,
      );
      try {
        await waitForOutcome({
          deadline: postSwitchDeadline,
          diagnose: () => `${switchTimeline()} ${diagnose()}`,
          label:
            "a placement for mem-a created after the switch (the CCG-10 mention must wake it)",
          stalled: () =>
            allActivationsTerminal() && postSwitchPlacements().length === 0,
          succeeded: () => postSwitchPlacements().length > 0,
        });
      } catch (waitError) {
        assert.fail(
          `4.3 failed: no placement for mem-a was created after the switch, so no post-switch RunAttempt could exist. ${String(waitError)}`,
        );
      }
      // 4.4: the live process is the only evidence, and only while it runs, so
      // this window is sampled by hand on top of the background interval.
      let postSwitchAttemptId: string | undefined;
      while (Date.now() < postSwitchDeadline) {
        recordArgvSamples();
        const placementIds = new Set(
          postSwitchPlacements().map((placement) => placement.placementId),
        );
        const candidate = runAttemptsOf().find(
          (attempt) =>
            attempt.placement !== undefined &&
            placementIds.has(attempt.placement.placementId),
        );
        if (candidate !== undefined) {
          postSwitchAttemptId = candidate.runAttemptId;
          // Stop as soon as the live driver has been sampled; otherwise keep
          // sampling until the process is gone, then give up on 4.4 rather
          // than substituting the ledger value.
          if (argvByRunAttempt.has(candidate.runAttemptId)) break;
          if (candidate.state !== "starting" && candidate.state !== "running")
            break;
        }
        await sleep(200);
      }

      assert.ok(
        postSwitchAttemptId,
        `4.3 failed: a post-switch placement exists for mem-a but no RunAttempt ever consumed it: ${switchTimeline()} ${diagnose()}`,
      );
      const postSwitchAttempt = runAttemptsOf().find(
        (attempt) => attempt.runAttemptId === postSwitchAttemptId,
      );
      assert.ok(postSwitchAttempt);
      assert.notEqual(
        postSwitchAttempt.runAttemptId,
        preSwitchAttempt.runAttemptId,
        "4.3 failed: the post-switch placement was consumed by the pre-switch RunAttempt",
      );
      const postSwitchPlacement = postSwitchAttempt.placement;
      assert.ok(postSwitchPlacement);
      assert.equal(
        postSwitchPlacement.resolvedModel.source,
        "explicit_binding",
      );
      assert.ok(
        postSwitchPlacement.resolvedModel.source === "explicit_binding",
      );
      assert.equal(
        postSwitchPlacement.resolvedModel.modelBindingId,
        switchTargetRuntime.modelBindingId,
      );
      assert.equal(
        postSwitchPlacement.resolvedModel.modelId,
        SWITCH_TARGET.modelId,
      );
      assert.equal(
        postSwitchPlacement.resolvedModel.reasoning,
        SWITCH_TARGET.reasoning,
      );
      assert.notEqual(
        postSwitchPlacement.runtimeProfileRevisionId,
        preSwitchPlacement.runtimeProfileRevisionId,
        "4.3 failed: the post-switch placement kept the old RuntimeProfile revision",
      );
      record("4.3", "asserted", {
        postSwitch: {
          createdAt: postSwitchPlacement.createdAt,
          resolvedModel: postSwitchPlacement.resolvedModel,
          runAttemptId: postSwitchAttempt.runAttemptId,
          runtimeProfileRevisionId:
            postSwitchPlacement.runtimeProfileRevisionId,
        },
        preSwitch: {
          createdAt: preSwitchPlacement.createdAt,
          resolvedModel: preSwitchPlacement.resolvedModel,
          runAttemptId: preSwitchAttempt.runAttemptId,
          runtimeProfileRevisionId: preSwitchPlacement.runtimeProfileRevisionId,
        },
        switchEventAt: switchEvent,
      });

      const postSwitchArgv = argvByRunAttempt.get(
        postSwitchAttempt.runAttemptId,
      );
      const preSwitchArgv = argvByRunAttempt.get(preSwitchAttempt.runAttemptId);
      if (postSwitchArgv === undefined || postSwitchArgv.length === 0) {
        // The protocol is explicit: a missed window is "not collected" and the
        // step must be re-run; the ledger value must never stand in for it.
        record(
          "4.4",
          "not_covered",
          { preSwitchArgv: preSwitchArgv ?? null },
          "the live process window was missed; 4.4 is NOT COLLECTED and must be re-run. The 4.3 ledger value must not be used in its place.",
        );
      } else {
        const carriesModel = postSwitchArgv.some((observation) =>
          observation.modelIds.includes(SWITCH_TARGET.modelId),
        );
        const carriesEffort = postSwitchArgv.some((observation) =>
          observation.efforts.some(
            (effort) =>
              effort.flag === SWITCH_TARGET.effortFlag &&
              effort.value === SWITCH_TARGET.reasoning,
          ),
        );
        record("4.4", "asserted", {
          expectedEffortFlag: SWITCH_TARGET.effortFlag,
          postSwitchArgv,
          preSwitchArgv: preSwitchArgv ?? null,
          runAttemptId: postSwitchAttempt.runAttemptId,
        });
        assert.ok(
          carriesModel,
          `4.4 failed: the live driver for RunAttempt ${postSwitchAttempt.runAttemptId} did not carry --model ${SWITCH_TARGET.modelId}: ${JSON.stringify(postSwitchArgv)}`,
        );
        assert.ok(
          carriesEffort,
          `4.4 failed: the live driver did not carry ${SWITCH_TARGET.effortFlag} ${SWITCH_TARGET.reasoning}: ${JSON.stringify(postSwitchArgv)}`,
        );
      }

      // 4.5: the Run that was in flight when the switch landed keeps its frozen
      // decision, byte for byte, apart from its lifecycle state.
      const refrozen = activeObserver
        .listPlacements({ roomId: roomA })
        .find(
          (placement) =>
            placement.placementId === preSwitchPlacement.placementId,
        );
      assert.ok(refrozen);
      assert.equal(
        JSON.stringify({
          agentDefinitionRevisionId: refrozen.agentDefinitionRevisionId,
          executionPolicyRevisionId: refrozen.executionPolicyRevisionId,
          resolvedModel: refrozen.resolvedModel,
          runtimeProfileRevisionId: refrozen.runtimeProfileRevisionId,
        }),
        frozenSnapshot,
        "4.5 failed: the in-flight placement's frozen decision was rewritten",
      );
      record("4.5", "asserted", {
        placementId: refrozen.placementId,
        resolvedModel: refrozen.resolvedModel,
        state: refrozen.state,
      });

      // 4.9 / 4.8: cut the daemon while the post-switch Run is in flight and
      // never re-send the Human request.
      const restartedDuringRun =
        runAttemptsOf().find(
          (attempt) => attempt.runAttemptId === postSwitchAttempt.runAttemptId,
        )?.state === "running";
      shutdown.controller.abort("core-chain-restart");
      await running?.catch(() => undefined);
      running = undefined;
      activeObserver.close();
      observer = undefined;

      shutdown.controller = new AbortController();
      application = new DaemonApplication({ config: prepared.config });
      running = application.run({ signal: shutdown.controller.signal });
      await waitUntil(
        () =>
          application?.health().state === "online" &&
          application.clientOrigin() !== undefined,
        60_000,
      );
      observer = new RoomKernel({ databasePath });
      observer.initialize();
      activeObserver = observer;
      humanActor = activeObserver.authenticateHumanAccessToken(token);

      await waitForOutcome({
        deadline: gateDeadline,
        diagnose,
        label: "every Activation reaches a terminal state after the restart",
        stalled: () => false,
        succeeded: () =>
          activationsOf().length > 0 &&
          activationsOf().every((activation) =>
            ["cancelled", "completed", "quarantined"].includes(
              activation.state,
            ),
          ),
      });

      const followUpActivation = activationsOf().find(
        (activation) =>
          activation.participantId === memA &&
          activation.fromSeq <= followUp.event.roomSeq &&
          activation.toSeq >= followUp.event.roomSeq,
      );
      assert.ok(
        followUpActivation,
        `4.8 failed: no Activation covers the post-switch Human message seq ${String(followUp.event.roomSeq)}`,
      );
      assert.equal(
        followUpActivation.state,
        "completed",
        `4.8 failed: the interrupted Activation did not complete without a re-sent request: ${diagnose()}`,
      );
      const followUpAttempts = runAttemptsOf().filter(
        (attempt) => attempt.activationId === followUpActivation.activationId,
      );
      record("4.8", "asserted", {
        activationId: followUpActivation.activationId,
        attemptCount: followUpActivation.attemptCount,
        attempts: followUpAttempts.map((attempt) => ({
          attemptNumber: attempt.attemptNumber,
          exitCode: attempt.exitCode,
          runAttemptId: attempt.runAttemptId,
          state: attempt.state,
        })),
        restartHitAnInFlightRun: restartedDuringRun,
        state: followUpActivation.state,
      });

      const processes = rooms().flatMap((roomId) =>
        activeObserver.listRuntimeProcesses({ roomId }),
      );
      record(
        "4.9",
        restartedDuringRun ? "asserted" : "not_covered",
        {
          processStates: countBy(processes, (item) => item.state),
          runAttemptStates: countBy(runAttemptsOf(), (item) => item.state),
        },
        restartedDuringRun
          ? undefined
          : "the post-switch Run had already finished when the daemon was cut, so no orphan convergence was exercised",
      );
      if (restartedDuringRun) {
        assert.ok(
          processes.every((item) =>
            ["orphaned", "terminated"].includes(item.state),
          ),
          `4.9 failed: a runtime process is neither orphaned nor terminated: ${JSON.stringify(processes.map((item) => item.state))}`,
        );
      }

      // 4.6 / 4.7: the pre-switch Run finished cleanly and the other Agent was
      // untouched across the whole switch window.
      const settledPreSwitch = runAttemptsOf().find(
        (attempt) => attempt.runAttemptId === preSwitchAttempt.runAttemptId,
      );
      assert.ok(settledPreSwitch);
      record("4.6", "asserted", {
        exitCode: settledPreSwitch.exitCode,
        state: settledPreSwitch.state,
      });
      assert.ok(
        ["exited", "orphaned"].includes(settledPreSwitch.state),
        `4.6 failed: the switch disturbed the in-flight Run (${settledPreSwitch.state})`,
      );
      if (settledPreSwitch.state === "exited")
        assert.equal(settledPreSwitch.exitCode, 0);

      const steadyAttempts = runAttemptsOf().filter(
        (attempt) => attempt.participantId === steadyC,
      );
      assert.ok(steadyAttempts.length > 0);
      assert.ok(
        steadyAttempts.every(
          (attempt) =>
            attempt.state === "exited" &&
            attempt.exitCode === 0 &&
            attempt.placement?.agentDefinitionRevisionId ===
              steadyBaseline.currentRevisionId,
        ),
        `4.7 failed: steady-c was affected by the switch: ${JSON.stringify(
          steadyAttempts.map((attempt) => ({
            exitCode: attempt.exitCode,
            revision: attempt.placement?.agentDefinitionRevisionId,
            state: attempt.state,
          })),
        )}`,
      );
      const auditFile = join(workspaceDirectory, S4_AUDIT_FILE);
      const auditContent = existsSync(auditFile)
        ? readFileSync(auditFile, "utf8").trim()
        : null;
      record("4.7", "asserted", {
        auditFile: auditContent,
        steadyAttempts: steadyAttempts.map((attempt) => ({
          exitCode: attempt.exitCode,
          state: attempt.state,
        })),
      });
      assert.equal(
        auditContent,
        S4_AUDIT_BODY,
        `4.7 failed: ${S4_AUDIT_FILE} is ${JSON.stringify(auditContent)}`,
      );

      assert.ok(
        messagesOf(roomA).some(
          (message) =>
            message.actorId === steadyC &&
            message.roomSeq > busyMessage.event.roomSeq &&
            message.body.trim() === S4_AUDIT_DONE,
        ),
        "4.7 failed: steady-c must publish its audit reply in the Human request Room; a file and exit 0 are insufficient",
      );

      const roomAAfter = messagesOf(roomA).filter(
        (message) =>
          message.actorId === memA &&
          message.roomSeq > busyMessage.event.roomSeq,
      );
      observations["4.11-mem-a-messages-after-switch"] = roomAAfter.map(
        (message) => message.body,
      );
      record(
        "4.11",
        "observed",
        {
          bodies: roomAAfter.map((message) => message.body),
          duplicateBodies: Object.entries(
            countBy(roomAAfter, (message) => message.body.trim()),
          ).filter(([, count]) => count > 1),
        },
        "duplicate publication is read from the message bodies; which of them is 'the same conclusion' is Human judgment",
      );
      const drafts = heldMessageDrafts(databasePath, memA);
      record(
        "4.12",
        "asserted",
        { drafts },
        "if a hold happened, its resolution_kind must not be revised/expired",
      );
      assert.ok(
        drafts.every(
          (draft) =>
            draft.resolutionKind === null ||
            !["expired", "revised"].includes(draft.resolutionKind),
        ),
        `4.12 failed: a held draft was dropped: ${JSON.stringify(drafts)}`,
      );
      record(
        "5.10",
        "observed",
        {
          replies: roomAAfter.map((message) => message.body),
          resolvedModel: postSwitchPlacement.resolvedModel,
        },
        "cross-CLI recall after the switch: the resolved binding is asserted by 4.3/4.4, the recall itself is observed",
      );

      // Infrastructure floor for the whole run.
      const finalActivations = activationsOf();
      const finalAttempts = runAttemptsOf();
      assert.ok(
        finalActivations.every((activation) =>
          ["cancelled", "completed", "quarantined"].includes(activation.state),
        ),
        `infrastructure floor failed: a non-terminal Activation remains: ${diagnose()}`,
      );
      assert.ok(
        finalAttempts.every(
          (attempt) =>
            attempt.state === "orphaned" ||
            (attempt.state === "exited" && attempt.exitCode === 0),
        ),
        `infrastructure floor failed: a RunAttempt did not exit 0: ${diagnose()}`,
      );
      record("2.10", "asserted", {
        byRoom: Object.fromEntries(
          rooms().map((roomId) => [
            roomId,
            countBy(
              activeObserver.listRunAttempts({ roomId }),
              (attempt) => attempt.state,
            ),
          ]),
        ),
        placementStates: countBy(
          rooms().flatMap((roomId) =>
            activeObserver.listPlacements({ roomId }),
          ),
          (placement) => placement.state,
        ),
      });
      record("3.10", "asserted", {
        activations: countBy(finalActivations, (item) => item.state),
        runAttempts: countBy(finalAttempts, (item) => item.state),
      });

      emitReport("passed");
    } catch (error) {
      emitReport("failed", error);
      throw error;
    } finally {
      clearInterval(sampler);
      emitReport("incomplete");
      shutdown.controller.abort("core-chain-gate-finished");
      await running?.catch(() => undefined);
      observer?.close();
      if (process.env.RAH_REAL_GATE_KEEP !== "1")
        rmSync(directory, { force: true, recursive: true });
      else console.log(`RAH_CORE_CHAIN_KEPT ${directory}`);
    }
  },
);

/**
 * One `ps` snapshot mapped to `RAH_RUN_ATTEMPT_ID`. Argv is written to no table,
 * no trajectory entry and no log file, so this is the only evidence for the
 * protocol's row 4.4 and it exists only while the process is alive. Only the
 * matched flags are kept: the raw line also carries the supervisor control token
 * and the standing prompt, which must never reach a report.
 */
function sampleDriverArgv(): [string, ArgvObservation][] {
  const result = spawnSync(
    "ps",
    ["-Aww", "-o", "pid=", "-o", "command=", "-E"],
    { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
  );
  if (result.status !== 0 || typeof result.stdout !== "string") return [];
  const observedAt = new Date().toISOString();
  const observations: [string, ArgvObservation][] = [];
  for (const line of result.stdout.split("\n")) {
    const runAttemptId = /RAH_RUN_ATTEMPT_ID=(\S+)/u.exec(line)?.[1];
    if (runAttemptId === undefined) continue;
    const modelIds = [...line.matchAll(/--model[\s",]+([^\s",]+)/gu)].map(
      (match) => match[1]!,
    );
    if (modelIds.length === 0) continue;
    const efforts = [
      ...line.matchAll(
        /--(effort|reasoning|thinking-level|variant)[\s",]+([^\s",]+)/gu,
      ),
    ].map((match) => ({ flag: `--${match[1]!}`, value: match[2]! }));
    observations.push([
      runAttemptId,
      {
        efforts,
        modelIds: [...new Set(modelIds)],
        observedAt,
        pid: line.trim().split(/\s+/u)[0] ?? "",
      },
    ]);
  }
  return observations;
}

function readMemoryTree(directory: string): { path: string; text: string }[] {
  if (!existsSync(directory)) return [];
  const files: { path: string; text: string }[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        try {
          files.push({ path, text: readFileSync(path, "utf8") });
        } catch {
          // Unreadable memory files are reported by their absence from hits.
        }
      }
    }
  };
  walk(directory);
  return files;
}

function readOnlyLedger<T>(
  databasePath: string,
  read: (database: DatabaseSync) => T,
): T {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return read(database);
  } finally {
    database.close();
  }
}

function inboxItems(
  databasePath: string,
  input: { roomId: string },
): {
  eventId: string;
  participantId: string;
  reason: string;
  state: string;
}[] {
  return readOnlyLedger(databasePath, (database) =>
    database
      .prepare(
        `SELECT event_id, participant_id, reason, state FROM inbox_items
         WHERE room_id = ? ORDER BY event_seq, inbox_item_id`,
      )
      .all(input.roomId)
      .map((row) => ({
        eventId: String(row.event_id ?? ""),
        participantId: String(row.participant_id ?? ""),
        reason: String(row.reason ?? ""),
        state: String(row.state ?? ""),
      })),
  );
}

function maxRoomSeq(databasePath: string, roomId: string): number {
  return readOnlyLedger(databasePath, (database) =>
    Number(
      (
        database
          .prepare(
            "SELECT COALESCE(MAX(room_seq), 0) AS bound FROM room_events WHERE room_id = ?",
          )
          .get(roomId) as { bound?: number } | undefined
      )?.bound ?? 0,
    ),
  );
}

function workerReadPositions(
  databasePath: string,
  participantId: string,
): { roomId: string; threadKey: string; throughRoomSeq: number }[] {
  return readOnlyLedger(databasePath, (database) =>
    database
      .prepare(
        `SELECT room_id, thread_key, through_room_seq
         FROM worker_target_read_positions WHERE participant_id = ?`,
      )
      .all(participantId)
      .map((row) => ({
        roomId: String(row.room_id ?? ""),
        threadKey: String(row.thread_key ?? ""),
        throughRoomSeq: Number(row.through_room_seq ?? 0),
      })),
  );
}

function directRoomPair(
  databasePath: string,
  roomId: string,
): { leftPrincipalId: string; rightPrincipalId: string } | undefined {
  return readOnlyLedger(databasePath, (database) => {
    const row = database
      .prepare(
        "SELECT left_principal_id, right_principal_id FROM direct_room_pairs WHERE room_id = ?",
      )
      .get(roomId) as
      { left_principal_id?: string; right_principal_id?: string } | undefined;
    return row === undefined
      ? undefined
      : {
          leftPrincipalId: String(row.left_principal_id ?? ""),
          rightPrincipalId: String(row.right_principal_id ?? ""),
        };
  });
}

function roomEventTypes(
  databasePath: string,
  types: readonly string[],
): { roomId: string; type: string }[] {
  return readOnlyLedger(databasePath, (database) =>
    database
      .prepare(
        `SELECT room_id, type FROM room_events WHERE type IN (${types.map(() => "?").join(",")})`,
      )
      .all(...types)
      .map((row) => ({
        roomId: String(row.room_id ?? ""),
        type: String(row.type ?? ""),
      })),
  );
}

function agentMemoryHomes(
  databasePath: string,
  participantIds: readonly string[],
): { ownerHostId: string | null; participantId: string; state: string }[] {
  return readOnlyLedger(databasePath, (database) =>
    database
      .prepare(
        `SELECT participant_id, owner_host_id, state FROM agent_memory_homes
         WHERE participant_id IN (${participantIds.map(() => "?").join(",")})`,
      )
      .all(...participantIds)
      .map((row) => ({
        ownerHostId:
          row.owner_host_id === null || row.owner_host_id === undefined
            ? null
            : String(row.owner_host_id),
        participantId: String(row.participant_id ?? ""),
        state: String(row.state ?? ""),
      })),
  );
}

function agentDefinitionState(
  databasePath: string,
  agentId: string,
): { currentRevisionId: string; executionPolicyRevisionId: string } {
  return readOnlyLedger(databasePath, (database) => {
    const row = database
      .prepare(
        `SELECT d.current_revision_id AS revision_id,
                r.execution_policy_revision_id AS policy_revision_id
           FROM agent_definitions d
           JOIN agent_definition_revisions r
             ON r.agent_definition_revision_id = d.current_revision_id
          WHERE d.agent_definition_id = ?`,
      )
      .get(agentId) as
      { policy_revision_id?: string; revision_id?: string } | undefined;
    assert.ok(row, `no AgentDefinition row for ${agentId}`);
    return {
      currentRevisionId: String(row.revision_id ?? ""),
      executionPolicyRevisionId: String(row.policy_revision_id ?? ""),
    };
  });
}

/**
 * The moment the switch was recorded, read from the `agent.configured` event
 * that carries the new revision. Every post-switch claim is timed against this
 * value rather than against the wall clock of the test process, so a failure
 * report can say whether a placement came before or after the switch.
 */
function agentConfiguredEventAt(
  databasePath: string,
  agentDefinitionRevisionId: string,
): string | undefined {
  return readOnlyLedger(databasePath, (database) => {
    const row = database
      .prepare(
        `SELECT created_at FROM room_events
          WHERE type = 'agent.configured'
            AND payload_json LIKE ?
          ORDER BY created_at DESC LIMIT 1`,
      )
      .get(`%${agentDefinitionRevisionId}%`) as
      { created_at?: string } | undefined;
    return row?.created_at === undefined ? undefined : String(row.created_at);
  });
}

function agentDefinitionRevisionExists(
  databasePath: string,
  agentDefinitionRevisionId: string,
): boolean {
  return readOnlyLedger(
    databasePath,
    (database) =>
      database
        .prepare(
          "SELECT 1 AS present FROM agent_definition_revisions WHERE agent_definition_revision_id = ?",
        )
        .get(agentDefinitionRevisionId) !== undefined,
  );
}

function modelIntentOf(
  databasePath: string,
  executionPolicyRevisionId: string,
): {
  allowedOfferIds: string[];
  exactBindingIds: string[];
  reasoning: string | null;
} {
  return readOnlyLedger(databasePath, (database) => {
    const row = database
      .prepare(
        "SELECT policy_json FROM execution_policy_revisions WHERE execution_policy_revision_id = ?",
      )
      .get(executionPolicyRevisionId) as { policy_json?: string } | undefined;
    assert.ok(
      row !== undefined && typeof row.policy_json === "string",
      `no policy row for ${executionPolicyRevisionId}`,
    );
    const parsed = JSON.parse(row.policy_json) as {
      modelIntent?: { exactBindingIds?: string[]; reasoning?: string };
      required?: { allowedOfferIds?: string[] };
    };
    return {
      allowedOfferIds: parsed.required?.allowedOfferIds ?? [],
      exactBindingIds: parsed.modelIntent?.exactBindingIds ?? [],
      reasoning: parsed.modelIntent?.reasoning ?? null,
    };
  });
}

/**
 * Row 5.12 is a constraint on the protocol itself: the manifest may reference a
 * memory policy, never memory content or a read record. This lists the
 * memory-related keys actually present so the claim is checked, not assumed.
 */
function contextManifestMemoryKeys(
  databasePath: string,
  runAttemptId: string,
): string[] {
  return readOnlyLedger(databasePath, (database) => {
    const row = database
      .prepare(
        "SELECT manifest_json FROM context_manifests WHERE run_attempt_id = ?",
      )
      .get(runAttemptId) as { manifest_json?: string } | undefined;
    if (row === undefined || typeof row.manifest_json !== "string") return [];
    const keys: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        for (const [index, item] of value.entries())
          walk(item, `${path}[${String(index)}]`);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      for (const [key, item] of Object.entries(value)) {
        const next = path === "" ? key : `${path}.${key}`;
        if (key.toLowerCase().includes("memory")) keys.push(next);
        walk(item, next);
      }
    };
    walk(JSON.parse(row.manifest_json), "");
    return keys;
  });
}

function heldMessageDrafts(
  databasePath: string,
  participantId: string,
): {
  body: string;
  resolutionKind: string | null;
  state: string;
}[] {
  return readOnlyLedger(databasePath, (database) =>
    database
      .prepare(
        `SELECT body, state, resolution_kind FROM held_message_drafts
         WHERE participant_id = ? ORDER BY created_at`,
      )
      .all(participantId)
      .map((row) => ({
        body: String(row.body ?? ""),
        resolutionKind:
          row.resolution_kind === null || row.resolution_kind === undefined
            ? null
            : String(row.resolution_kind),
        state: String(row.state ?? ""),
      })),
  );
}

/** Canonical counts for the report, readable even after teardown started. */
function ledgerSummary(databasePath: string): unknown {
  if (!existsSync(databasePath)) return "no room.db";
  return readOnlyLedger(databasePath, (database) => {
    const counts = (sql: string): Record<string, number> => {
      const summary: Record<string, number> = {};
      for (const row of database.prepare(sql).all() as {
        bucket?: string;
        total?: number;
      }[])
        summary[String(row.bucket ?? "")] = Number(row.total ?? 0);
      return summary;
    };
    return {
      activationsByState: counts(
        "SELECT state AS bucket, COUNT(*) AS total FROM activations GROUP BY state",
      ),
      inboxByReason: counts(
        "SELECT reason AS bucket, COUNT(*) AS total FROM inbox_items GROUP BY reason",
      ),
      runAttemptsByState: counts(
        "SELECT state AS bucket, COUNT(*) AS total FROM run_attempts GROUP BY state",
      ),
      runtimeProcessesByState: counts(
        "SELECT state AS bucket, COUNT(*) AS total FROM runtime_processes GROUP BY state",
      ),
    };
  });
}

function countBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const bucket = key(item);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

async function postJson<T = unknown>(
  origin: string,
  accessToken: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const responseBody = (await response.json()) as T;
  assert.equal(
    response.status,
    200,
    `${path} failed: ${JSON.stringify(responseBody)}`,
  );
  return responseBody;
}

async function syncRoom(
  origin: string,
  accessToken: string,
  roomId: string,
  consumerId: string,
): Promise<{ latestRoomSeq: number }> {
  return await postJson(origin, accessToken, "/v3/client/rooms/sync", {
    consumerId,
    roomId,
  });
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error("real core-chain gate timed out");
    await sleep(100);
  }
}

/**
 * Waits for a business outcome, but fails fast with canonical evidence when the
 * Agents have all reached a terminal state without producing it. A stalled run
 * must never be left to burn down to the gate timeout.
 */
async function waitForOutcome(input: {
  deadline: number;
  diagnose: () => string;
  label: string;
  stalled: () => boolean;
  succeeded: () => boolean;
}): Promise<void> {
  let stalledSince: number | undefined;
  while (!input.succeeded()) {
    const now = Date.now();
    if (now >= input.deadline)
      throw new Error(
        `real core-chain gate timed out waiting for ${input.label}: ${input.diagnose()}`,
      );
    if (input.stalled()) {
      stalledSince ??= now;
      if (now - stalledSince >= STALL_CONFIRM_MS)
        throw new Error(
          `real Agents reached a terminal state without ${input.label}: ${input.diagnose()}`,
        );
    } else stalledSince = undefined;
    await sleep(500);
  }
}

function providerSessionIds(
  directory: string,
  participantId: string,
): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const record = JSON.parse(
        readFileSync(join(directory, name), "utf8"),
      ) as { participantId?: string; providerSessionId?: string };
      return record.participantId === participantId &&
        typeof record.providerSessionId === "string"
        ? [record.providerSessionId]
        : [];
    })
    .sort();
}

function assertFreshProviderSessions(before: string[], after: string[]): void {
  assert.ok(
    before.length > 0 && after.length > 0,
    "both sides need actual provider evidence",
  );
  assert.ok(
    after.every((id) => !before.includes(id)),
    "new RunAttempt must not masquerade as a new provider session",
  );
}

test("fresh-session evidence rejects resumed identities and missing receipts", () => {
  assert.throws(() =>
    assertFreshProviderSessions(["session-a"], ["session-a"]),
  );
  assert.throws(() => assertFreshProviderSessions(["session-a"], []));
  assert.throws(() => assertFreshProviderSessions([], ["session-b"]));
  assertFreshProviderSessions(["session-a"], ["session-b"]);
});
