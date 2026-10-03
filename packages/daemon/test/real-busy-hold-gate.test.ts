import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";
import type {
  AgentCatalogEntry,
  LocalRuntimeInventoryResponse,
  RuntimeTrajectoryRecord,
} from "@rah-os/protocol";

import {
  DaemonApplication,
  localCliRuntimeSpec,
  prepareLocalWorkbench,
} from "../src/index.ts";

const ENABLED = process.env.RAH_REAL_BUSY_HOLD_GATE === "1";
const GATE_TIMEOUT_MS = 10 * 60_000;
// A phase boundary can briefly show every Activation terminal before the next
// wake is enqueued, so a stall must persist before it is reported as a gap.
const STALL_CONFIRM_MS = 20_000;

/**
 * Authorized paid runtimes for this gate only. `claude`, `codex` and Fable are
 * deliberately absent: the observed failure was produced by OpenCode, and this
 * gate must not silently swap in a different vendor.
 */
const BUSY_HOLD_RUNTIMES = {
  kimi: {
    executable: "kimi",
    modelId: "kimi-code/k3",
    reasoning: "high",
  },
  opencode: {
    executable: "opencode",
    modelId: "deepseek/deepseek-v4-flash",
    reasoning: "low",
  },
} as const satisfies Record<
  string,
  {
    executable: string;
    modelId: string;
    reasoning: string;
  }
>;

type BusyHoldRuntimeKey = keyof typeof BUSY_HOLD_RUNTIMES;

const RUNTIME_KEY = (process.env.RAH_REAL_BUSY_HOLD_CLI ??
  "opencode") as BusyHoldRuntimeKey;

const EXPERIMENT = "F0909G";
const ORIGINAL_MARKER = `${EXPERIMENT} BUSY DONE`;
const FOLLOW_UP_MARKER = `${EXPERIMENT} FOLLOWUP DONE`;
const ACTIVE_MARKER_FILE = `.f0909g-active`;

/**
 * The original failing wording of F0909B/F0909E, verbatim in shape and language
 * (only the experiment id and the workspace marker name differ). The Agent is
 * asked to leave a durable workspace marker and then sleep, so the second Human
 * message lands while the first turn is genuinely mid-flight, and to answer with
 * one exact token.
 */
const HUMAN_ORIGINAL_REQUEST = `${EXPERIMENT} BUSY: 请用终端执行 touch ${ACTIVE_MARKER_FILE}; sleep 20 （仅在当前工作区留下实验标记），完成后只回复 ${ORIGINAL_MARKER}，不创建 Task。`;

/**
 * The retired follow-up wording (F0909B/F0909E). It is preserved verbatim as
 * evidence and is selectable with `RAH_REAL_BUSY_HOLD_WORDING=ambiguous`, but it
 * is OBSERVATION ONLY — see `AMBIGUOUS_WORDING_EVIDENCE`. `只回复 …，不重复上条
 * 回复` is read by real models as "send the follow-up answer and nothing else",
 * so under this wording dropping the unsent original result is a defensible
 * reading of the Human's own words, and upstream Raft likewise permits replacing
 * a held draft. Asserting both markers here would test a judgment call, not a
 * RAH mechanism.
 */
const HUMAN_FOLLOW_UP_REQUEST_AMBIGUOUS = `${EXPERIMENT} FOLLOWUP: 这是忙时追加消息，请完成当前消息后只回复 ${FOLLOW_UP_MARKER}，不重复上条回复，不创建 Task。`;

/**
 * Three paid runs on 2026-09-09 with the ambiguous wording, all kept:
 *
 * 1. OpenCode `deepseek/deepseek-v4-flash` low, state `…/rah-real-busy-hold-0IppKH`.
 *    The Agent used the new contract (`message-post --target "#agent-council"`
 *    with a heredoc body), the send was held, `held_message_drafts` kept the
 *    body `F0909G BUSY DONE`, then a second compose replaced it
 *    (`state='replaced'`, `resolution_kind='revised'`). The Agent had not
 *    redirected stderr on its sends and the hold guidance was printed to stderr
 *    only, so it never saw the hold. Root cause of the stdout port that is now
 *    committed.
 * 2. OpenCode `deepseek/deepseek-v4-flash` low, after the stdout fix, state
 *    `…/rah-real-busy-hold-WYOrkV`. The Agent saw the hold and reasoned:
 *    "There's a newer follow-up message at seq 8 … The latest message is seq 8,
 *    which supersedes. I should send only 'F0909G FOLLOWUP DONE' … Per
 *    instructions, an additional message does not cancel an unsent original
 *    result, but the follow-up says '不重复上条回复' (don't repeat the previous
 *    reply)". It then replaced the draft deliberately.
 * 3. Kimi `kimi-code/k3` high, state `…/rah-real-busy-hold-emRa7R`. Same
 *    outcome: "Instruction from the follow-up: don't repeat the previous reply,
 *    only reply 'F0909G FOLLOWUP DONE'. So the saved draft 'F0909G BUSY DONE'
 *    should be replaced." and "per its instruction, I'll replace the draft with
 *    the follow-up reply."
 *
 * Two independent models, one low and one high effort, read the wording the
 * same way. The self-invented prompt rules that run 2 weighed and overrode were
 * removed the same day: a tool contract, not prompt coaching, has to carry
 * behavior.
 */
const AMBIGUOUS_WORDING_EVIDENCE =
  "F0909G runs 1-3 (OpenCode deepseek-v4-flash low x2, Kimi k3 high): the Agent replaced the held draft on purpose";

/**
 * The wording this gate asserts against. The user's requirement is "no lost
 * replies when the Human appends work while an Agent is busy", so the appended
 * request states explicitly that it neither cancels nor replaces the original
 * request and that both answers are wanted, each as its own message. The
 * original request is unchanged and the markers are unchanged; only the Human's
 * intent is made unambiguous, so that what remains under test is the mechanism
 * (freshness hold + `--send-draft` recovery) rather than a judgment call.
 */
const HUMAN_FOLLOW_UP_REQUEST_EXPLICIT = `${EXPERIMENT} FOLLOWUP: 这是忙时追加消息，它不取消、也不替代上一条请求；上一条请求的结果仍然必须发出。请分两条消息回复：第一条照原样只写 ${ORIGINAL_MARKER}，第二条只写 ${FOLLOW_UP_MARKER}。两条缺一不可，不要合并成一条，不要省略任何一条，不创建 Task。`;

const WORDING = (process.env.RAH_REAL_BUSY_HOLD_WORDING ?? "explicit") as
  "ambiguous" | "explicit";
const HUMAN_FOLLOW_UP_REQUEST =
  WORDING === "ambiguous"
    ? HUMAN_FOLLOW_UP_REQUEST_AMBIGUOUS
    : HUMAN_FOLLOW_UP_REQUEST_EXPLICIT;

test(
  "opt-in real busy freshness hold republishes the original result and the follow-up exactly once",
  { skip: !ENABLED, timeout: GATE_TIMEOUT_MS + 60_000 },
  async () => {
    const startedAt = Date.now();
    const gateDeadline = startedAt + GATE_TIMEOUT_MS;
    const runtime = BUSY_HOLD_RUNTIMES[RUNTIME_KEY] as
      (typeof BUSY_HOLD_RUNTIMES)[BusyHoldRuntimeKey] | undefined;
    assert.ok(
      runtime,
      `RAH_REAL_BUSY_HOLD_CLI must be one of ${Object.keys(BUSY_HOLD_RUNTIMES).join(", ")}; received ${String(process.env.RAH_REAL_BUSY_HOLD_CLI)}`,
    );
    assert.ok(
      WORDING === "ambiguous" || WORDING === "explicit",
      `RAH_REAL_BUSY_HOLD_WORDING must be "explicit" (default) or "ambiguous"; received ${String(process.env.RAH_REAL_BUSY_HOLD_WORDING)}`,
    );

    const directory = mkdtempSync(join(tmpdir(), "rah-real-busy-hold-"));
    console.log(`RAH_REAL_BUSY_HOLD_STATE ${directory}`);
    const stateDirectory = join(directory, "state");
    const workspaceDirectory = join(directory, "workspace");
    mkdirSync(workspaceDirectory, { mode: 0o700 });
    const activeMarkerPath = join(workspaceDirectory, ACTIVE_MARKER_FILE);
    const spec = localCliRuntimeSpec(runtime.executable, workspaceDirectory);
    assert.ok(spec, `missing local Runtime spec for ${runtime.executable}`);

    const shutdown = new AbortController();
    let application: DaemonApplication | undefined;
    let observer: RoomKernel | undefined;
    let running: Promise<void> | undefined;

    try {
      const prepared = await prepareLocalWorkbench({
        runtimeSpecs: [spec],
        stateDirectory,
        workspaceCwd: workspaceDirectory,
      });
      const databasePath = join(stateDirectory, "room.db");
      application = new DaemonApplication({ config: prepared.config });
      running = application.run({ signal: shutdown.signal });
      await waitUntil(
        () =>
          application?.health().state === "online" &&
          application.clientOrigin() !== undefined,
        60_000,
      );
      const origin = application.clientOrigin();
      assert.ok(origin);
      const roomId = prepared.metadata.defaultRoomId;

      observer = new RoomKernel({ databasePath });
      observer.initialize();
      const activeObserver = observer;
      const humanActor = activeObserver.authenticateHumanAccessToken(
        prepared.humanAccessToken,
      );

      const inventory = await postJson<LocalRuntimeInventoryResponse>(
        origin,
        prepared.humanAccessToken,
        "/v1/local/runtimes/list",
        {},
      );
      const configuredRuntime = inventory.runtimes.find(
        (candidate) =>
          candidate.configured &&
          candidate.runtimeProfileId === spec.runtimeProfileId,
      );
      assert.ok(
        configuredRuntime,
        `configured Runtime missing for ${runtime.executable}`,
      );
      assert.ok(configuredRuntime.runtimeOfferId);
      const binding = configuredRuntime.modelBindingDescriptors.find(
        (candidate) => candidate.modelId === runtime.modelId,
      );
      assert.ok(
        binding,
        `${runtime.executable} catalog did not publish ${runtime.modelId}`,
      );
      // The authorized matrix is exact: a gate must never quietly spend on a
      // different reasoning level than the one the user approved.
      assert.ok(
        binding.supportedReasoning.includes(runtime.reasoning),
        `${runtime.executable} ${runtime.modelId} does not publish authorized reasoning ${runtime.reasoning} (published: ${binding.supportedReasoning.join(", ")})`,
      );

      const catalog = await postJson<{ agents: AgentCatalogEntry[] }>(
        origin,
        prepared.humanAccessToken,
        "/v3/client/agents/list",
        { controlRoomId: prepared.metadata.controlRoomId },
      );
      const agent = catalog.agents.find(
        (candidate) => candidate.handle === spec.agentHandle,
      );
      assert.ok(agent, `Agent missing for ${runtime.executable}`);
      const agentId = agent.definition.agentId;
      const participantId = agent.definition.participantId;

      const controlDelivery = await syncRoom(
        origin,
        prepared.humanAccessToken,
        prepared.metadata.controlRoomId,
        "real-busy-hold-control",
      );
      await postJson(
        origin,
        prepared.humanAccessToken,
        "/v3/client/agents/manage",
        {
          action: "configure",
          agentId,
          basedOnRoomSeq: controlDelivery.latestRoomSeq,
          displayName: spec.displayName,
          handle: spec.agentHandle,
          idempotencyKey: "real-busy-hold-configure",
          // The shipped default for this CLI; the gate adds no coaching of its
          // own, because prompt coaching is exactly what the audit refuses to
          // count as a fix.
          instructions: spec.instructions,
          modelIntent: {
            exactBindingIds: [binding.modelBindingId],
            fallback: "disabled",
            reasoning: runtime.reasoning,
            serviceTier: "default",
          },
          role: spec.role,
          runtimeOfferId: configuredRuntime.runtimeOfferId,
          toolAccessMode: "full_access",
        },
      );

      const roomDelivery = await syncRoom(
        origin,
        prepared.humanAccessToken,
        roomId,
        "real-busy-hold-room-admin",
      );
      await postJson(
        origin,
        prepared.humanAccessToken,
        "/v3/client/rooms/members/add",
        {
          principalId: participantId,
          role: "member",
          basedOnRoomSeq: roomDelivery.latestRoomSeq,
          idempotencyKey: "real-busy-hold-onboard",
          roomId,
        },
      );

      const eventsOf = () => roomEvents(activeObserver, humanActor, roomId);
      const agentMessages = () =>
        eventsOf()
          .filter(
            (event) =>
              event.type === "message.posted" &&
              event.actorId === participantId,
          )
          .map((event) => ({
            body: String(event.payload.body ?? ""),
            messageId: event.aggregateId,
            roomSeq: event.roomSeq,
          }));
      const markerCount = (marker: string) =>
        agentMessages().filter((message) => message.body.includes(marker))
          .length;
      const attemptsOf = () =>
        activeObserver
          .listRunAttempts({ roomId })
          .filter((attempt) => attempt.participantId === participantId);
      const activationsOf = () =>
        activeObserver
          .listActivations({ roomId })
          .filter((activation) => activation.participantId === participantId);
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
            ["completed", "quarantined"].includes(activation.state),
          )
        );
      };
      const trajectoryOf = () =>
        agentTrajectory(activeObserver, humanActor, agentId);
      // The two mechanism facts, read from the canonical state DB and the
      // recorded trajectory rather than from the published bodies: a run that
      // never held anything, or that recovered by retyping the original by
      // hand, would otherwise pass this gate for the wrong reason.
      const heldDraftsOf = () => heldMessageDrafts(databasePath, participantId);
      const originalHeldDraftsOf = () =>
        heldDraftsOf().filter((draft) => draft.body.includes(ORIGINAL_MARKER));
      const sendDraftInvocationsOf = () => sendDraftInvocations(trajectoryOf());

      let reported = false;
      const publishReport = () => {
        if (reported) return;
        reported = true;
        const messages = agentMessages();
        const originalCount = messages.filter((message) =>
          message.body.includes(ORIGINAL_MARKER),
        ).length;
        const followUpCount = messages.filter((message) =>
          message.body.includes(FOLLOW_UP_MARKER),
        ).length;
        let sendSignals: ReturnType<typeof messagePostSignals> = {
          exitEvidenceAvailable: false,
          nonzeroObserved: false,
          samples: [],
        };
        try {
          sendSignals = messagePostSignals(trajectoryOf());
        } catch (error) {
          sendSignals = {
            exitEvidenceAvailable: false,
            error: String(error),
            nonzeroObserved: false,
            samples: [],
          };
        }
        let heldDrafts: ReturnType<typeof heldMessageDrafts> = [];
        let heldDraftsError: string | undefined;
        try {
          heldDrafts = heldDraftsOf();
        } catch (error) {
          heldDraftsError = String(error);
        }
        let sendDraftCalls: ReturnType<typeof sendDraftInvocations> = [];
        try {
          sendDraftCalls = sendDraftInvocationsOf();
        } catch {
          sendDraftCalls = [];
        }
        console.log(
          `RAH_REAL_BUSY_HOLD_REPORT ${JSON.stringify(
            {
              activations: activationsOf().map((activation) => ({
                activationId: activation.activationId,
                state: activation.state,
              })),
              agentMessages: messages.map((message) => ({
                body: message.body.slice(0, 400),
                messageId: message.messageId,
                roomSeq: message.roomSeq,
              })),
              // What the Agent decided to do with the held original result:
              // `sent_unchanged` is the recovery this gate is about, `revised`
              // is the deliberate replacement observed in F0909G runs 1-3.
              agentDecision: heldDrafts
                .filter((draft) => draft.body.includes(ORIGINAL_MARKER))
                .map((draft) => ({
                  heldDraftId: draft.heldDraftId,
                  reholdCount: draft.reholdCount,
                  resolutionKind: draft.resolutionKind,
                  state: draft.state,
                })),
              cli: RUNTIME_KEY,
              followUpMarker: {
                count: followUpCount,
                exactlyOnce: followUpCount === 1,
                marker: FOLLOW_UP_MARKER,
              },
              // The single diagnostic the human needs when this fails: which
              // half of the exchange was dropped.
              lostHalf:
                originalCount === 0 && followUpCount === 0
                  ? "both"
                  : originalCount === 0
                    ? "original"
                    : followUpCount === 0
                      ? "follow-up"
                      : null,
              heldDrafts: heldDrafts.map((draft) => ({
                body: draft.body.slice(0, 200),
                heldDraftId: draft.heldDraftId,
                reholdCount: draft.reholdCount,
                resolutionKind: draft.resolutionKind,
                state: draft.state,
              })),
              ...(heldDraftsError === undefined ? {} : { heldDraftsError }),
              messagePost: sendSignals,
              modelId: runtime.modelId,
              originalMarker: {
                count: originalCount,
                exactlyOnce: originalCount === 1,
                marker: ORIGINAL_MARKER,
              },
              reasoning: runtime.reasoning,
              runAttempts: attemptsOf().map((attempt) => ({
                exitCode: attempt.exitCode ?? null,
                runAttemptId: attempt.runAttemptId,
                state: attempt.state,
              })),
              sendDraftRecovery: sendDraftCalls,
              stateDirectory: directory,
              wallTimeMs: Date.now() - startedAt,
              wording: WORDING,
              ...(WORDING === "ambiguous"
                ? { wordingEvidence: AMBIGUOUS_WORDING_EVIDENCE }
                : {}),
            },
            undefined,
            2,
          )}`,
        );
      };
      const diagnose = () => {
        publishReport();
        return `see RAH_REAL_BUSY_HOLD_REPORT above; state ${directory}`;
      };

      try {
        // 1. The Human posts the original work request.
        const beforeOriginal = await syncRoom(
          origin,
          prepared.humanAccessToken,
          roomId,
          "real-busy-hold-human",
        );
        const originalMessage = await postJson<{ activationIds: string[] }>(
          origin,
          prepared.humanAccessToken,
          "/v3/client/messages/post",
          {
            basedOnRoomSeq: beforeOriginal.latestRoomSeq,
            body: HUMAN_ORIGINAL_REQUEST,
            idempotencyKey: "real-busy-hold-original",
            recipients: [{ participantId: participantId, reason: "mention" }],
            roomId,
          },
        );
        assert.ok(originalMessage.activationIds.length >= 1);

        // 2. Busy is read from the canonical ledger (a RunAttempt actually
        //    running) together with the experiment's own durable workspace
        //    marker — never from a timer in the test.
        await waitForOutcome({
          deadline: gateDeadline,
          diagnose,
          label: "the Agent to be genuinely busy on the original request",
          stalled: allActivationsTerminal,
          succeeded: () =>
            attemptsOf().some((attempt) => attempt.state === "running") &&
            existsSync(activeMarkerPath),
        });

        // 3. While it is busy, the follow-up arrives at the same target with the
        //    ORIGINAL wording that previously lost the held draft.
        const beforeFollowUp = await syncRoom(
          origin,
          prepared.humanAccessToken,
          roomId,
          "real-busy-hold-human",
        );
        await postJson(
          origin,
          prepared.humanAccessToken,
          "/v3/client/messages/post",
          {
            basedOnRoomSeq: beforeFollowUp.latestRoomSeq,
            body: HUMAN_FOLLOW_UP_REQUEST,
            idempotencyKey: "real-busy-hold-follow-up",
            recipients: [{ participantId: participantId, reason: "mention" }],
            roomId,
          },
        );

        // 4. Both halves must be published, each exactly once, with the Agent
        //    quiescent. No retry loop: one honest sample per run.
        //    Under the retired ambiguous wording there is nothing to wait for
        //    beyond quiescence: the Human's own words permit dropping the
        //    original, so that variant only observes and reports.
        if (WORDING === "ambiguous")
          await waitForQuiescence({
            deadline: gateDeadline,
            diagnose,
            settled: () => allActivationsTerminal() && agentsIdle(),
          });
        else
          await waitForOutcome({
            deadline: gateDeadline,
            diagnose,
            label: "both the original result and the follow-up answer",
            stalled: allActivationsTerminal,
            succeeded: () =>
              markerCount(ORIGINAL_MARKER) >= 1 &&
              markerCount(FOLLOW_UP_MARKER) >= 1 &&
              agentsIdle(),
          });
        // Infrastructure facts.
        const activations = activationsOf();
        assert.ok(activations.length > 0);
        for (const activation of activations)
          assert.ok(
            ["completed", "quarantined"].includes(activation.state),
            `Activation ${activation.activationId} ended in ${activation.state}`,
          );
        const attempts = attemptsOf();
        assert.ok(attempts.length > 0);
        for (const attempt of attempts)
          assert.equal(
            attempt.exitCode,
            0,
            `RunAttempt ${attempt.runAttemptId} exited ${String(attempt.exitCode)} (${attempt.state})`,
          );

        if (WORDING === "ambiguous") {
          // Observation only. F0909G runs 1-3 (see AMBIGUOUS_WORDING_EVIDENCE)
          // showed two independent models — OpenCode deepseek-v4-flash at low
          // effort twice and Kimi k3 at high effort once — reading
          // `只回复 …，不重复上条回复` as permission to replace the held
          // original. That is a judgment the Human's own words invite, not a
          // mechanism defect, so this variant asserts no business outcome; the
          // Agent's decision is in RAH_REAL_BUSY_HOLD_REPORT.agentDecision.
          console.log(
            `RAH_REAL_BUSY_HOLD_OBSERVATION ${JSON.stringify({
              evidence: AMBIGUOUS_WORDING_EVIDENCE,
              followUpMarkerCount: markerCount(FOLLOW_UP_MARKER),
              heldOriginalDrafts: originalHeldDraftsOf().map((draft) => ({
                resolutionKind: draft.resolutionKind,
                state: draft.state,
              })),
              originalMarkerCount: markerCount(ORIGINAL_MARKER),
              sendDraftInvocations: sendDraftInvocationsOf().length,
            })}`,
          );
          return;
        }

        // The one business fact this batch is about.
        assert.equal(
          markerCount(ORIGINAL_MARKER),
          1,
          `the original result marker "${ORIGINAL_MARKER}" must appear in exactly one Agent message`,
        );
        assert.equal(
          markerCount(FOLLOW_UP_MARKER),
          1,
          `the follow-up marker "${FOLLOW_UP_MARKER}" must appear in exactly one Agent message`,
        );

        // The mechanism, not just the outcome. Without these, an Agent that was
        // never held — or one that lost the draft and simply retyped the
        // original result — would satisfy the marker counts above.
        const originalHeldDrafts = originalHeldDraftsOf();
        assert.ok(
          originalHeldDrafts.length > 0,
          `no held_message_drafts row for this Agent carried "${ORIGINAL_MARKER}": the run never produced a real freshness hold; ${diagnose()}`,
        );
        // Ledger truth, not trajectory text: only `--send-draft` resolves a held
        // draft as `sent_unchanged`, so this proves the original result was
        // republished through the tool rather than retyped. The trajectory
        // command text is corroborating evidence only — it is CLI-shaped, and
        // Kimi's ACP frames carry structured rawInput rather than the shell
        // command line, so requiring it would fail a run that actually passed
        // (observed 2026-09-09, state …-fuv591: both markers published, draft
        // resolution_kind `sent_unchanged`, zero message-post trajectory rows).
        const recovered = originalHeldDrafts.filter(
          (draft) => draft.resolutionKind === "sent_unchanged",
        );
        const recoveries = sendDraftInvocationsOf();
        assert.ok(
          recovered.length > 0,
          `no held draft carrying "${ORIGINAL_MARKER}" was resolved as sent_unchanged: the original result was not republished through --send-draft; ${diagnose()}`,
        );
      } finally {
        publishReport();
      }
    } finally {
      shutdown.abort("real-busy-hold-gate-finished");
      await running?.catch(() => undefined);
      observer?.close();
      if (process.env.RAH_REAL_GATE_KEEP !== "1")
        rmSync(directory, { force: true, recursive: true });
      else console.log(`RAH_REAL_BUSY_HOLD_KEPT ${directory}`);
    }
  },
);

/**
 * Best-effort read of `message-post` invocations from the recorded trajectory.
 * Runtime trajectory carries tool and status text, not process exit codes, so a
 * held send is recognised by its canonical `SEND_HELD_AS_DRAFT` payload; the raw
 * samples are reported so a human can judge rather than trust a derived flag.
 */
function messagePostSignals(activities: readonly RuntimeTrajectoryRecord[]): {
  error?: string;
  exitEvidenceAvailable: boolean;
  nonzeroObserved: boolean;
  samples: { observedAt: string; text: string }[];
} {
  const samples: { observedAt: string; text: string }[] = [];
  let nonzeroObserved = false;
  let exitEvidenceAvailable = false;
  for (const activity of activities) {
    const text = JSON.stringify(activity.entry);
    if (!text.includes("message-post") && !text.includes("SEND_HELD_AS_DRAFT"))
      continue;
    samples.push({ observedAt: activity.observedAt, text: text.slice(0, 400) });
    if (text.includes("SEND_HELD_AS_DRAFT")) {
      exitEvidenceAvailable = true;
      nonzeroObserved = true;
    }
    if (/exit(?:ed)?[^0-9]{0,16}[1-9]/iu.test(text)) {
      exitEvidenceAvailable = true;
      nonzeroObserved = true;
    }
  }
  return {
    exitEvidenceAvailable,
    nonzeroObserved,
    samples: samples.slice(0, 20),
  };
}

/**
 * `--send-draft` recoveries taken from recorded tool invocations only. Tool
 * output is deliberately not searched: the hold guidance itself prints the
 * `message-post --send-draft --target …` line, so matching free text would let
 * a run that merely READ the guidance stand in for one that followed it.
 */
function sendDraftInvocations(
  activities: readonly RuntimeTrajectoryRecord[],
): { observedAt: string; toolInput: string; toolName: string }[] {
  const invocations: {
    observedAt: string;
    toolInput: string;
    toolName: string;
  }[] = [];
  for (const activity of activities) {
    const entry = activity.entry;
    if (entry.kind !== "tool_start") continue;
    const toolInput = entry.toolInput ?? "";
    if (!toolInput.includes("message-post")) continue;
    if (!toolInput.includes("--send-draft")) continue;
    invocations.push({
      observedAt: activity.observedAt,
      toolInput: toolInput.slice(0, 400),
      toolName: entry.toolName,
    });
  }
  return invocations;
}

/**
 * The canonical hold evidence: every draft row this Agent ever produced, in the
 * same state DB the daemon writes. Rows survive their resolution (`state` plus
 * `resolution_kind`), so this reads both "a hold happened" and "what the Agent
 * decided to do with it".
 */
function heldMessageDrafts(
  databasePath: string,
  participantId: string,
): {
  body: string;
  heldDraftId: string;
  reholdCount: number;
  resolutionKind: string | null;
  state: string;
}[] {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database
      .prepare(
        `SELECT held_draft_id, body, state, resolution_kind, rehold_count
         FROM held_message_drafts
         WHERE participant_id = ?
         ORDER BY created_at`,
      )
      .all(participantId)
      .map((row) => ({
        body: String(row.body ?? ""),
        heldDraftId: String(row.held_draft_id ?? ""),
        reholdCount: Number(row.rehold_count ?? 0),
        resolutionKind:
          row.resolution_kind === null || row.resolution_kind === undefined
            ? null
            : String(row.resolution_kind),
        state: String(row.state ?? ""),
      }));
  } finally {
    database.close();
  }
}

function agentTrajectory(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  agentId: string,
): RuntimeTrajectoryRecord[] {
  const collected: RuntimeTrajectoryRecord[] = [];
  let beforeActivityId: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const delivery = kernel.listAgentTrajectory(actor, {
      agentId,
      limit: 100,
      ...(beforeActivityId === undefined ? {} : { beforeActivityId }),
    });
    collected.push(...delivery.activities);
    if (delivery.nextCursor === undefined) break;
    beforeActivityId = delivery.nextCursor;
  }
  return collected.toReversed();
}

function roomEvents(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
) {
  const collected: ReturnType<RoomKernel["sync"]>["events"] = [];
  let afterSeq: number | undefined;
  for (let page = 0; page < 200; page += 1) {
    const delivery = kernel.sync(actor, {
      consumerId: "real-busy-hold-verifier",
      limit: 500,
      roomId,
      ...(afterSeq === undefined ? {} : { afterSeq }),
    });
    collected.push(...delivery.events);
    if (delivery.cursorAfter >= delivery.latestRoomSeq) break;
    if (delivery.cursorAfter === afterSeq) break;
    afterSeq = delivery.cursorAfter;
  }
  return collected;
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

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = GATE_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error("real busy-hold gate timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Waits for the Agent to be done, whatever it decided. Used by the retired
 * ambiguous wording, which has no business outcome to wait for: a phase
 * boundary can briefly look terminal, so the settled state must persist.
 */
async function waitForQuiescence(input: {
  deadline: number;
  diagnose: () => string;
  settled: () => boolean;
}): Promise<void> {
  let settledSince: number | undefined;
  for (;;) {
    const now = Date.now();
    if (input.settled()) {
      settledSince ??= now;
      if (now - settledSince >= STALL_CONFIRM_MS) return;
    } else settledSince = undefined;
    if (now >= input.deadline)
      throw new Error(
        `real busy-hold gate timed out waiting for the Agent to settle: ${input.diagnose()}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Waits for a business outcome, but fails fast with canonical evidence when the
 * Agent has reached a terminal state without producing it.
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
        `real busy-hold gate timed out waiting for ${input.label}: ${input.diagnose()}`,
      );
    if (input.stalled()) {
      stalledSince ??= now;
      if (now - stalledSince >= STALL_CONFIRM_MS)
        throw new Error(
          `the real Agent reached a terminal state without ${input.label}: ${input.diagnose()}`,
        );
    } else stalledSince = undefined;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
