import { prepareLocalWorkbench } from "./workbench-channel-fixture.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";
import type {
  AgentCatalogEntry,
  LocalRuntimeInventoryResponse,
} from "@rah-os/protocol";

import {
  DaemonApplication,
  localCliRuntimeSpec,
} from "../src/index.ts";

/** Independent continuation of original scenario 4 after m5HBvq preamble failed.
 * Original scenario implementation is copied unchanged below; no old business
 * messages or initial role configuration are replayed. All state is retained.
 */
const ENABLED = process.env.RAH_CORE_SWITCH_CHECKPOINT_GATE === "1";
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
const S5_CORRECTED = "ORIOLE-2";
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
  "opt-in checkpoint: original scenario 4 live switch and ordered daemon restart",
  { skip: !ENABLED, timeout: GATE_TIMEOUT_MS + 120_000 },
  async () => {
    const startedAt = Date.now();
    const gateDeadline = startedAt + GATE_TIMEOUT_MS;
    const directory = process.env.RAH_CORE_CHECKPOINT_DIRECTORY;
    assert.ok(directory && directory.includes("rah-core-chain-"));
    console.log(`RAH_CORE_CHAIN_STATE ${directory}`);
    const stateDirectory = join(directory, "state");
    const workspaceDirectory = join(directory, "workspace");
    assert.ok(existsSync(workspaceDirectory));

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
      const checkpointRevisions = () =>
        readOnlyLedger(databasePath, (db) =>
          db
            .prepare(
              "SELECT agent_definition_id,current_revision_id FROM agent_definitions ORDER BY agent_definition_id",
            )
            .all(),
        );
      const initialRevisions = checkpointRevisions();
      const prepared = await prepareLocalWorkbench({
        runtimeSpecs,
        stateDirectory,
        workspaceCwd: workspaceDirectory,
      });
      assert.deepEqual(
        checkpointRevisions(),
        initialRevisions,
        "bootstrap must preserve existing Agent configurations",
      );
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

      for (const role of ROLES) {
        const agent = catalog.agents.find(
          (candidate) => candidate.handle === role.handle,
        );
        assert.ok(agent);
        const intent = activeObserver.getExecutionPolicyRevision(
          agent.currentRevision.executionPolicyRevisionId,
        ).modelIntent;
        const authorized = authorizedRuntime(
          role.executable,
          role.modelId,
          role.reasoning,
        );
        assert.deepEqual(intent.exactBindingIds, [authorized.modelBindingId]);
        assert.equal(intent.reasoning, role.reasoning);
        participantIdByHandle.set(role.handle, agent.definition.participantId);
        definitionIdByHandle.set(role.handle, agent.definition.agentId);
        handleByParticipantId.set(agent.definition.participantId, role.handle);
      }
      const memA = participantIdByHandle.get("mem-a")!;
      const memB = participantIdByHandle.get("mem-b")!;
      const steadyC = participantIdByHandle.get("steady-c")!;
      const agentIds = new Set([memA, memB, steadyC]);

      const roomB = readOnlyLedger(databasePath, (db) =>
        String(
          db
            .prepare("SELECT room_id FROM rooms WHERE slug='core-chain-room-b'")
            .get()?.room_id,
        ),
      );
      const dmRoom = readOnlyLedger(databasePath, (db) =>
        String(
          db.prepare("SELECT room_id FROM rooms WHERE kind='direct'").get()
            ?.room_id,
        ),
      );
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

      assert.ok(agentsIdle(), "checkpoint starts with no active work");
      console.log(
        "SWITCH_CHECKPOINT_DAEMON",
        JSON.stringify({ pid: process.pid, origin: originOf() }),
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
      assert.ok(
        roomAAfter.some((message) => message.body.includes(S4_EXEC_DONE)),
        "original busy request has an explicit reply after switch/restart",
      );
      assert.ok(
        roomAAfter.some((message) => message.body.includes("EXISTS")),
        "independent follow-up file question is answered",
      );
      assert.ok(
        roomAAfter.some((message) => message.body.includes(S5_CORRECTED)),
        "independent follow-up corrected fact question is answered",
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
      // Checkpoint state is always retained.
      console.log(`RAH_CORE_CHAIN_KEPT ${directory}`);
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
