import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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

const ENABLED = process.env.RAH_REAL_SPLIT_CHAIN_GATE === "1";
const GATE_TIMEOUT_MS = 12 * 60_000;
// A phase boundary can briefly show every Activation terminal before the next
// wake is enqueued, so a stall must persist before it is reported as a gap.
const STALL_CONFIRM_MS = 20_000;

type SplitRole = {
  /** Canonical Room handle that `@mention` resolves. */
  readonly handle: "lead" | "helper-a" | "helper-b";
  readonly executable: "codex" | "kimi" | "opencode";
  readonly modelId: string;
  /** Reasoning level used when the catalog publishes it. */
  readonly reasoning: string;
  readonly instructions: string;
};

const LEAD_INSTRUCTIONS = [
  "You are the lead.",
  "When the Human asks for work that should be split, claim the Human message as your Task,",
  "create one unassigned subtask per part with task-create (put the intended helper's @handle in each title),",
  "post one short top-level note that @mentions each helper with their subtask,",
  "then task-block your parent Task until the subtasks are done.",
  "Never do the subtasks yourself and never claim them.",
  "Wait for the Human to accept both subtasks and explicitly ask you to resume the parent.",
  "Then task-unblock your own blocked parent, acknowledge and exit; on the next Activation claim/start that same parent, verify both files and submit it.",
].join(" ");

const HELPER_INSTRUCTIONS = [
  "You are a helper.",
  "Only act on subtasks that name your @handle or that the lead assigned to you by mention;",
  "claim the subtask, do exactly the described file change in the workspace, verify it, and submit.",
  "Do not act on the Human's original request directly and do not touch other helpers' subtasks.",
].join(" ");

const SPLIT_ROLES: readonly SplitRole[] = [
  {
    executable: "codex",
    handle: "lead",
    instructions: LEAD_INSTRUCTIONS,
    modelId: "gpt-5.6-luna",
    reasoning: "low",
  },
  {
    executable: "kimi",
    handle: "helper-a",
    instructions: HELPER_INSTRUCTIONS,
    modelId: "kimi-code/k3",
    reasoning: "high",
  },
  {
    executable: "opencode",
    handle: "helper-b",
    instructions: HELPER_INSTRUCTIONS,
    modelId: "deepseek/deepseek-v4-flash",
    reasoning: "low",
  },
];

const HUMAN_REQUEST = [
  "@lead please split this into two subtasks and hand them to @helper-a and @helper-b, one each:",
  "(A) create SPLIT_A.txt containing the exact single line `RAH split chain A`;",
  "(B) create SPLIT_B.txt containing the exact single line `RAH split chain B`.",
  "Helpers: wait for the lead's subtasks; do not act on this message directly.",
].join(" ");

test(
  "opt-in real lead CLI splits, reworks, resumes the blocked parent and reaches Human acceptance for all tasks",
  { skip: !ENABLED, timeout: GATE_TIMEOUT_MS + 60_000 },
  async () => {
    const startedAt = Date.now();
    const gateDeadline = startedAt + GATE_TIMEOUT_MS;
    const directory = mkdtempSync(join(tmpdir(), "rah-real-split-chain-"));
    console.log(`RAH_REAL_SPLIT_CHAIN_STATE ${directory}`);
    const stateDirectory = join(directory, "state");
    const workspaceDirectory = join(directory, "workspace");
    mkdirSync(workspaceDirectory, { mode: 0o700 });
    const runtimeSpecs = SPLIT_ROLES.map(({ executable }) => {
      const spec = localCliRuntimeSpec(executable, workspaceDirectory);
      assert.ok(spec, `missing local Runtime spec for ${executable}`);
      return spec;
    });
    const shutdown = new AbortController();
    let application: DaemonApplication | undefined;
    let observer: RoomKernel | undefined;
    let running: Promise<void> | undefined;

    try {
      const prepared = await prepareLocalWorkbench({
        runtimeSpecs,
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
      const catalog = await postJson<{ agents: AgentCatalogEntry[] }>(
        origin,
        prepared.humanAccessToken,
        "/v3/client/agents/list",
        { controlRoomId: prepared.metadata.controlRoomId },
      );
      assert.equal(catalog.agents.length, SPLIT_ROLES.length);

      const participantIdByHandle = new Map<string, string>();
      const handleByParticipantId = new Map<string, string>();
      const resolvedReasoningByHandle = new Map<string, string>();
      for (const [index, role] of SPLIT_ROLES.entries()) {
        const spec = runtimeSpecs[index]!;
        const runtime = inventory.runtimes.find(
          (candidate) =>
            candidate.configured &&
            candidate.runtimeProfileId === spec.runtimeProfileId,
        );
        assert.ok(runtime, `configured Runtime missing for ${role.executable}`);
        assert.ok(runtime.runtimeOfferId);
        const binding = runtime.modelBindingDescriptors.find(
          (candidate) => candidate.modelId === role.modelId,
        );
        assert.ok(
          binding,
          `${role.executable} catalog did not publish ${role.modelId}`,
        );
        // The authorized matrix is exact: a gate must never quietly spend on a
        // different reasoning level than the one the user approved.
        assert.ok(
          binding.supportedReasoning.includes(role.reasoning),
          `${role.executable} ${role.modelId} does not publish authorized reasoning ${role.reasoning} (published: ${binding.supportedReasoning.join(", ")})`,
        );
        const reasoning = role.reasoning;
        const agent = catalog.agents.find(
          (candidate) => candidate.handle === spec.agentHandle,
        );
        assert.ok(agent, `Agent missing for ${role.executable}`);

        const controlDelivery = await syncRoom(
          origin,
          prepared.humanAccessToken,
          prepared.metadata.controlRoomId,
          "real-split-chain-control",
        );
        await postJson(
          origin,
          prepared.humanAccessToken,
          "/v3/client/agents/manage",
          {
            action: "configure",
            agentId: agent.definition.agentId,
            basedOnRoomSeq: controlDelivery.latestRoomSeq,
            displayName: spec.displayName,
            handle: role.handle,
            idempotencyKey: `real-split-chain-config-${role.handle}`,
            instructions: role.instructions,
            modelIntent: {
              exactBindingIds: [binding.modelBindingId],
              fallback: "disabled",
              reasoning,
              serviceTier: "default",
            },
            role: spec.role,
            runtimeOfferId: runtime.runtimeOfferId,
            toolAccessMode: "full_access",
          },
        );
        participantIdByHandle.set(role.handle, agent.definition.participantId);
        handleByParticipantId.set(agent.definition.participantId, role.handle);
        resolvedReasoningByHandle.set(role.handle, reasoning);

        const roomDelivery = await syncRoom(
          origin,
          prepared.humanAccessToken,
          roomId,
          "real-split-chain-room-admin",
        );
        await postJson(
          origin,
          prepared.humanAccessToken,
          "/v3/client/rooms/members/add",
          {
            principalId: agent.definition.participantId,
            role: "member",
            basedOnRoomSeq: roomDelivery.latestRoomSeq,
            idempotencyKey: `real-split-chain-onboard-${role.handle}`,
            roomId,
          },
        );
      }
      console.log(
        `RAH_REAL_SPLIT_CHAIN_REASONING ${JSON.stringify(Object.fromEntries(resolvedReasoningByHandle))}`,
      );

      const lead = participantIdByHandle.get("lead")!;
      const helperA = participantIdByHandle.get("helper-a")!;
      const helperB = participantIdByHandle.get("helper-b")!;
      const agentIds = new Set([lead, helperA, helperB]);

      const tasksOf = () => activeObserver.listTasks(humanActor, { roomId });
      const activationsOf = () => activeObserver.listActivations({ roomId });
      const messagesOf = () =>
        activeObserver.listMessages(humanActor, { roomId }).messages;
      const eventsOf = () => roomEvents(activeObserver, humanActor, roomId);
      const agentActivations = () =>
        activationsOf().filter((activation) =>
          agentIds.has(activation.participantId),
        );
      const agentsIdle = () =>
        agentActivations().every(
          (activation) =>
            activation.state !== "queued" && activation.state !== "leased",
        );
      const allActivationsTerminal = () => {
        const activations = agentActivations();
        return (
          activations.length > 0 &&
          activations.every((activation) =>
            ["completed", "quarantined"].includes(activation.state),
          )
        );
      };
      const diagnose = () =>
        JSON.stringify(
          {
            activations: agentActivations().map((activation) => ({
              activationId: activation.activationId,
              participant:
                handleByParticipantId.get(activation.participantId) ??
                activation.participantId,
              state: activation.state,
            })),
            messages: messagesOf().map((message) => ({
              actor: handleByParticipantId.get(message.actorId) ?? "human",
              body: message.body.slice(0, 200),
              threadId: message.threadId,
            })),
            runAttempts: activeObserver
              .listRunAttempts({ roomId })
              .map((attempt) => ({
                exitCode: attempt.exitCode,
                participant:
                  handleByParticipantId.get(attempt.participantId) ??
                  attempt.participantId,
                state: attempt.state,
              })),
            tasks: tasksOf().map((task) => ({
              assignee:
                handleByParticipantId.get(task.assigneeId ?? "") ?? null,
              claimedBy:
                handleByParticipantId.get(task.claimedBy ?? "") ?? null,
              creator: handleByParticipantId.get(task.creatorId) ?? "human",
              sourceMessageId: task.sourceMessageId,
              state: task.state,
              taskId: task.taskId,
              title: task.title,
            })),
          },
          undefined,
          2,
        );

      // 1. One Human message the lead must split.
      const beforeMessage = await syncRoom(
        origin,
        prepared.humanAccessToken,
        roomId,
        "real-split-chain-human",
      );
      const humanMessage = await postJson<{
        activationIds: string[];
        event: { actorId: string; aggregateId: string; roomSeq: number };
      }>(origin, prepared.humanAccessToken, "/v3/client/messages/post", {
        basedOnRoomSeq: beforeMessage.latestRoomSeq,
        body: HUMAN_REQUEST,
        idempotencyKey: "real-split-chain-human-message",
        recipients: [{ participantId: lead, reason: "mention" }],
        roomId,
      });
      assert.ok(humanMessage.activationIds.length >= 1);

      // Business outcome, not transcript: two attributed subtasks, each claimed
      // by the named helper, both submitted, and the Agents quiescent.
      const leadSubtasks = () => {
        const created = tasksOf().filter(
          (task) =>
            task.creatorId === lead &&
            task.sourceMessageId !== humanMessage.event.aggregateId,
        );
        return {
          a: created.find(
            (task) =>
              mentionsHandle(task.title, "helper-a") &&
              !mentionsHandle(task.title, "helper-b"),
          ),
          b: created.find(
            (task) =>
              mentionsHandle(task.title, "helper-b") &&
              !mentionsHandle(task.title, "helper-a"),
          ),
        };
      };
      await waitForOutcome({
        deadline: gateDeadline,
        diagnose,
        label: "two helper subtasks submitted",
        stalled: allActivationsTerminal,
        succeeded: () => {
          const { a, b } = leadSubtasks();
          return (
            a !== undefined &&
            b !== undefined &&
            a.taskId !== b.taskId &&
            a.state === "submitted" &&
            b.state === "submitted" &&
            agentsIdle()
          );
        },
      });

      const { a: subtaskA, b: subtaskB } = leadSubtasks();
      assert.ok(subtaskA);
      assert.ok(subtaskB);
      for (const [subtask, expected, expectedHandle] of [
        [subtaskA, helperA, "helper-a"],
        [subtaskB, helperB, "helper-b"],
      ] as const) {
        const owner = subtask.assigneeId ?? subtask.claimedBy;
        assert.equal(
          owner,
          expected,
          `subtask "${subtask.title}" names @${expectedHandle} but was taken by ${handleByParticipantId.get(owner ?? "") ?? String(owner)}`,
        );
      }

      // 2. One top-level lead note mentioning both helpers.
      const leadTopLevelIds = new Set(
        messagesOf()
          .filter(
            (message) =>
              message.actorId === lead && message.threadId === undefined,
          )
          .map((message) => message.messageId),
      );
      const mentionNote = eventsOf().find(
        (event) =>
          event.type === "message.posted" &&
          event.actorId === lead &&
          leadTopLevelIds.has(event.aggregateId) &&
          recipientPairs(event.payload).some(
            (pair) =>
              pair.participantId === helperA && pair.reason === "mention",
          ) &&
          recipientPairs(event.payload).some(
            (pair) =>
              pair.participantId === helperB && pair.reason === "mention",
          ),
      );
      assert.ok(
        mentionNote,
        `no top-level lead note mentioned both helpers: ${diagnose()}`,
      );

      // 3. The lead's parent Task stays lead-owned and is not worked around.
      const parentTask = tasksOf().find(
        (task) => task.sourceMessageId === humanMessage.event.aggregateId,
      );
      assert.ok(
        parentTask,
        `the lead never claimed the Human message as a Task: ${diagnose()}`,
      );
      // claim-message records the message author (the Human) as creator by design.
      assert.equal(parentTask.creatorId, humanMessage.event.actorId);
      assert.equal(parentTask.assigneeId, lead);
      const parentState = parentTask.state;
      assert.equal(
        parentState,
        "blocked",
        "parent must release its claim while waiting for Human acceptance of subtasks",
      );
      console.log(`RAH_REAL_SPLIT_CHAIN_PARENT_STATE ${parentState}`);

      // 4. Both durable workspace results exist with the exact lines.
      assert.equal(
        readFileSync(join(workspaceDirectory, "SPLIT_A.txt"), "utf8").trim(),
        "RAH split chain A",
      );
      assert.equal(
        readFileSync(join(workspaceDirectory, "SPLIT_B.txt"), "utf8").trim(),
        "RAH split chain B",
      );

      // 5. The Human rejects Subtask A through the canonical UI status path and
      // the named helper reworks it into a second submission.
      const humanMutation = async (
        path: string,
        body: Record<string, unknown>,
      ): Promise<void> => {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const delivery = await syncRoom(
            origin,
            prepared.humanAccessToken,
            roomId,
            "real-split-chain-human-console",
          );
          const response = await fetch(`${origin}${path}`, {
            body: JSON.stringify({
              ...body,
              basedOnRoomSeq: delivery.latestRoomSeq,
            }),
            headers: {
              authorization: `Bearer ${prepared.humanAccessToken}`,
              "content-type": "application/json",
            },
            method: "POST",
          });
          const parsed = (await response.json()) as {
            error?: { code?: string };
          };
          if (response.status === 200) return;
          assert.equal(
            parsed.error?.code,
            "stale_context",
            `${path}: ${JSON.stringify(parsed)}`,
          );
        }
        throw new Error(`${path} never committed at the latest Room sequence`);
      };

      const submissionsOfA = () =>
        activeObserver.taskReviews.listTaskSubmissions(humanActor, {
          roomId,
          taskId: subtaskA.taskId,
        });
      assert.equal(submissionsOfA().length, 1);
      await humanMutation("/v3/client/tasks/workflow", {
        idempotencyKey: "real-split-chain-subtask-a-rejected",
        taskId: subtaskA.taskId,
        workflowStatus: "closed",
      });
      await humanMutation("/v3/client/tasks/workflow", {
        idempotencyKey: "real-split-chain-subtask-a-reopened",
        taskId: subtaskA.taskId,
        workflowStatus: "todo",
      });
      await waitForOutcome({
        deadline: gateDeadline,
        diagnose,
        label: "reworked second submission of subtask A",
        stalled: allActivationsTerminal,
        succeeded: () => {
          const submissions = submissionsOfA();
          const current = tasksOf().find(
            (task) => task.taskId === subtaskA.taskId,
          );
          return (
            submissions.length === 2 &&
            submissions.at(-1)?.submissionNumber === 2 &&
            current?.state === "submitted" &&
            agentsIdle()
          );
        },
      });
      assert.equal(
        tasksOf().find((task) => task.taskId === subtaskA.taskId)?.assigneeId,
        helperA,
      );

      for (const [index, subtask] of [subtaskA, subtaskB].entries()) {
        await humanMutation("/v3/client/tasks/complete", {
          idempotencyKey: `real-split-chain-completed-${String(index)}`,
          taskId: subtask.taskId,
        });
      }
      const byId = () => new Map(tasksOf().map((task) => [task.taskId, task]));
      assert.equal(byId().get(subtaskA.taskId)?.state, "completed");
      assert.equal(byId().get(subtaskB.taskId)?.state, "completed");

      // The parent must finish through a new Agent execution, not a Human
      // unblock shortcut or a report based only on its children's completion.
      await humanMutation("/v3/client/threads/reply", {
        idempotencyKey: "real-split-chain-resume-parent",
        roomId,
        threadId: parentTask.threadId,
        body: `@lead both subtasks have been accepted by the Human. Resume parent ${parentTask.taskId}: task-unblock, ACK and exit; next Activation claim/start the same parent, verify both files and submit. Do not create another Task.`,
        recipientIds: [lead],
      });
      await waitForOutcome({
        deadline: gateDeadline,
        diagnose,
        label: "parent resumed in a new execution and submitted",
        stalled: allActivationsTerminal,
        succeeded: () =>
          byId().get(parentTask.taskId)?.state === "submitted" && agentsIdle(),
      });
      const unblockEvent = eventsOf().find(
        (event) =>
          event.type === "task.unblocked" &&
          event.aggregateId === parentTask.taskId,
      );
      assert.equal(unblockEvent?.actorId, lead);
      assert.ok(unblockEvent?.payload.runAttemptId);
      const resumedClaim = eventsOf().find(
        (event) =>
          event.type === "task.claimed" &&
          event.aggregateId === parentTask.taskId &&
          event.roomSeq > unblockEvent.roomSeq,
      );
      assert.ok(resumedClaim?.payload.runAttemptId);
      assert.notEqual(
        resumedClaim.payload.runAttemptId,
        unblockEvent.payload.runAttemptId,
        "parent execution must use the next Activation's Run",
      );
      const parentSubmissions = activeObserver.taskReviews.listTaskSubmissions(
        humanActor,
        { roomId, taskId: parentTask.taskId },
      );
      assert.equal(parentSubmissions.length, 1);
      await humanMutation("/v3/client/tasks/complete", {
        idempotencyKey: "real-split-chain-parent-completed",
        taskId: parentTask.taskId,
      });
      assert.equal(byId().get(parentTask.taskId)?.state, "completed");
      assert.equal(
        tasksOf().length,
        3,
        "resumption must not create a replacement parent",
      );

      // 7. Report before teardown, while the live projections are still open.
      const finalActivations = agentActivations();
      const finalAttempts = activeObserver.listRunAttempts({ roomId });
      console.log(
        `RAH_REAL_SPLIT_CHAIN_REPORT ${JSON.stringify(
          {
            activations: {
              byState: countBy(finalActivations, (item) => item.state),
              total: finalActivations.length,
            },
            files: ["SPLIT_A.txt", "SPLIT_B.txt"],
            parentState: byId().get(parentTask.taskId)?.state,
            parentWaitState: parentState,
            runAttempts: finalAttempts.map((attempt) => ({
              exitCode: attempt.exitCode,
              participant:
                handleByParticipantId.get(attempt.participantId) ??
                attempt.participantId,
              state: attempt.state,
            })),
            stateDirectory: directory,
            subtasks: [subtaskA, subtaskB].map((subtask) => ({
              owner: handleByParticipantId.get(subtask.assigneeId ?? ""),
              title: subtask.title,
            })),
            wallTimeMs: Date.now() - startedAt,
          },
          undefined,
          2,
        )}`,
      );
      console.log(`RAH_REAL_SPLIT_CHAIN_FACTS ${diagnose()}`);

      // 6. The same evidence survives a fresh connection to the same database.
      shutdown.abort("real-split-chain-complete");
      await running.catch(() => undefined);
      running = undefined;
      observer.close();
      observer = undefined;
      const reopened = new RoomKernel({ databasePath });
      try {
        reopened.initialize();
        const reopenedActor = reopened.authenticateHumanAccessToken(
          prepared.humanAccessToken,
        );
        const persisted = new Map(
          reopened
            .listTasks(reopenedActor, { roomId })
            .map((task) => [task.taskId, task]),
        );
        assert.equal(persisted.get(subtaskA.taskId)?.state, "completed");
        assert.equal(persisted.get(subtaskB.taskId)?.state, "completed");
        assert.equal(persisted.get(subtaskA.taskId)?.assigneeId, helperA);
        assert.equal(persisted.get(subtaskB.taskId)?.assigneeId, helperB);
        const persistedParent = persisted.get(parentTask.taskId);
        assert.equal(persistedParent?.state, "completed");
        assert.equal(persistedParent?.creatorId, humanMessage.event.actorId);
        assert.equal(persistedParent?.assigneeId, lead);
        assert.equal(
          reopened.taskReviews.listTaskSubmissions(reopenedActor, {
            roomId,
            taskId: subtaskA.taskId,
          }).length,
          2,
        );
        const persistedEvents = roomEvents(reopened, reopenedActor, roomId);
        const persistedNote = persistedEvents.find(
          (event) => event.eventId === mentionNote.eventId,
        );
        assert.ok(persistedNote);
        assert.deepEqual(
          recipientPairs(persistedNote.payload)
            .filter((pair) => pair.reason === "mention")
            .map((pair) => handleByParticipantId.get(pair.participantId))
            .sort(),
          ["helper-a", "helper-b"],
        );
      } finally {
        reopened.close();
      }
    } finally {
      shutdown.abort("real-split-chain-gate-finished");
      await running?.catch(() => undefined);
      observer?.close();
      if (process.env.RAH_REAL_GATE_KEEP !== "1")
        rmSync(directory, { force: true, recursive: true });
      else console.log(`RAH_REAL_SPLIT_CHAIN_KEPT ${directory}`);
    }
  },
);

function mentionsHandle(title: string, handle: string): boolean {
  return title.toLowerCase().includes(handle);
}

function recipientPairs(
  payload: Record<string, unknown>,
): { participantId: string; reason: string }[] {
  const recipients = payload.recipients;
  if (!Array.isArray(recipients)) return [];
  return recipients.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    return typeof record.participantId === "string" &&
      typeof record.reason === "string"
      ? [{ participantId: record.participantId, reason: record.reason }]
      : [];
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

function roomEvents(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
) {
  const collected: ReturnType<RoomKernel["sync"]>["events"] = [];
  let afterSeq: number | undefined;
  for (let page = 0; page < 200; page += 1) {
    const delivery = kernel.sync(actor, {
      consumerId: "real-split-chain-verifier",
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
      throw new Error("real split-chain gate timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Waits for a business outcome, but fails fast with canonical evidence when the
 * Agents have all reached a terminal state without producing it.
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
        `real split-chain gate timed out waiting for ${input.label}: ${input.diagnose()}`,
      );
    if (input.stalled()) {
      stalledSince ??= now;
      if (now - stalledSince >= STALL_CONFIRM_MS)
        throw new Error(
          `real Agents reached a terminal state without ${input.label}: ${input.diagnose()}`,
        );
    } else stalledSince = undefined;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
