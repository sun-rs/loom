import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    reasoning: "low",
  },
  opencode: {
    executable: "opencode",
    // Only used when the catalog does not publish `low` for this binding; the
    // report says which one was actually resolved.
    fallbackReasoning: "high",
    modelId: "deepseek/deepseek-v4-flash",
    reasoning: "low",
  },
} as const satisfies Record<
  string,
  {
    executable: string;
    fallbackReasoning?: string;
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
 * The original follow-up wording that previously lost the held draft. It is a
 * plain additional question. It deliberately does NOT carry F0909C/F0909D's
 * strengthened coaching ("this is an independent addition, it neither cancels
 * nor replaces the earlier request, send the original result first"), because
 * that strengthened wording is what made the model pass; re-using it here would
 * silently replace the failing scenario with the passing one.
 */
const HUMAN_FOLLOW_UP_REQUEST = `${EXPERIMENT} FOLLOWUP: 这是忙时追加消息，请完成当前消息后只回复 ${FOLLOW_UP_MARKER}，不重复上条回复，不创建 Task。`;

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
    const fallbackReasoning =
      "fallbackReasoning" in runtime ? runtime.fallbackReasoning : undefined;

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
      const resolvedReasoning = binding.supportedReasoning.includes(
        runtime.reasoning,
      )
        ? runtime.reasoning
        : fallbackReasoning;
      assert.ok(
        resolvedReasoning !== undefined &&
          binding.supportedReasoning.includes(resolvedReasoning),
        `${runtime.executable} ${runtime.modelId} publishes neither ${runtime.reasoning} nor a permitted fallback (${binding.supportedReasoning.join(", ")})`,
      );
      const reasoningFallbackUsed = resolvedReasoning !== runtime.reasoning;

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
      const agentDefinitionId = agent.definition.agentDefinitionId;
      const agentId = agent.definition.participantId;

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
          agentDefinitionId,
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
            reasoning: resolvedReasoning,
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
        "/v3/client/agents/onboard",
        {
          agentDefinitionId,
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
              event.type === "message.posted" && event.actorId === agentId,
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
          .filter((attempt) => attempt.participantId === agentId);
      const activationsOf = () =>
        activeObserver
          .listActivations({ roomId })
          .filter((activation) => activation.participantId === agentId);
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
        agentTrajectory(activeObserver, humanActor, agentDefinitionId);

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
              messagePost: sendSignals,
              modelId: runtime.modelId,
              originalMarker: {
                count: originalCount,
                exactlyOnce: originalCount === 1,
                marker: ORIGINAL_MARKER,
              },
              reasoning: resolvedReasoning,
              reasoningFallbackUsed,
              runAttempts: attemptsOf().map((attempt) => ({
                exitCode: attempt.exitCode ?? null,
                runAttemptId: attempt.runAttemptId,
                state: attempt.state,
              })),
              stateDirectory: directory,
              wallTimeMs: Date.now() - startedAt,
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
            recipients: [{ participantId: agentId, reason: "mention" }],
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
            recipients: [{ participantId: agentId, reason: "mention" }],
            roomId,
          },
        );

        // 4. Both halves must be published, each exactly once, with the Agent
        //    quiescent. No retry loop: one honest sample per run.
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

function agentTrajectory(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  agentDefinitionId: string,
): RuntimeTrajectoryRecord[] {
  const collected: RuntimeTrajectoryRecord[] = [];
  let beforeActivityId: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const delivery = kernel.listAgentTrajectory(actor, {
      agentDefinitionId,
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
