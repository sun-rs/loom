import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { agentExecutionWorkspacePath } from "../../agent-host/src/agent-execution-workspace.ts";

import { RoomKernel } from "@rah-os/kernel";
import type {
  AgentCatalogEntry,
  LocalRuntimeInventoryResponse,
} from "@rah-os/protocol";

import {
  DaemonApplication,
  localCliRuntimeSpec,
  prepareLocalWorkbench,
  type LocalWorkbenchRuntimeSpec,
} from "../src/index.ts";

const ENABLED = process.env.RAH_REAL_MULTI_CLI_GATE === "1";
const GATE_TIMEOUT_MS = 10 * 60_000;

type ApprovedCli = {
  executable: "codex" | "kimi" | "opencode" | "claude";
  modelId: string;
  reasoning: "default" | "low" | "high" | "max";
};

const ALL_APPROVED_CLIS: readonly ApprovedCli[] = [
  { executable: "claude", modelId: "sonnet", reasoning: "low" },
  { executable: "codex", modelId: "gpt-5.6-luna", reasoning: "low" },
  { executable: "kimi", modelId: "kimi-code/k3", reasoning: "high" },
  {
    executable: "opencode",
    modelId: "deepseek/deepseek-v4-flash",
    reasoning: "low",
  },
];
const selectedNames = (
  process.env.RAH_REAL_CLI_NAMES ?? "codex,kimi,opencode"
).split(",");
const APPROVED_CLIS = ALL_APPROVED_CLIS.filter((cli) =>
  selectedNames.includes(cli.executable),
);
if (ENABLED) {
  assert.equal(
    APPROVED_CLIS.length,
    new Set(selectedNames).size,
    "unknown CLI selection",
  );
}

test(
  `opt-in ${APPROVED_CLIS.map((cli) => cli.executable).join(", ")} keep ordinary chat as Messages and elect one automatic Task owner`,
  { skip: !ENABLED, timeout: GATE_TIMEOUT_MS + 30_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-real-multi-cli-"));
    console.log(`RAH_REAL_MULTI_CLI_STATE ${directory}`);
    const stateDirectory = join(directory, "state");
    const workspaceDirectory = join(directory, "workspace");
    mkdirSync(workspaceDirectory, { mode: 0o700 });
    const runtimeSpecs = APPROVED_CLIS.map(({ executable }) => {
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

      observer = new RoomKernel({
        databasePath: join(stateDirectory, "room.db"),
      });
      observer.initialize();
      const humanActor = observer.authenticateHumanAccessToken(
        prepared.humanAccessToken,
      );

      const inventory = await postJson<LocalRuntimeInventoryResponse>(
        origin,
        prepared.humanAccessToken,
        "/v1/local/runtimes/list",
        {},
      );
      await waitUntil(
        () =>
          runtimeSpecs.every((spec) => {
            const offerId = inventory.runtimes.find(
              (runtime) => runtime.runtimeProfileId === spec.runtimeProfileId,
            )?.runtimeOfferId;
            return (
              offerId !== undefined &&
              observer!.runtimeOfferIsCurrentlyAvailable(offerId)
            );
          }),
        60_000,
      );
      const catalog = await postJson<{ agents: AgentCatalogEntry[] }>(
        origin,
        prepared.humanAccessToken,
        "/v3/client/agents/list",
        { controlRoomId: prepared.metadata.controlRoomId },
      );
      assert.equal(catalog.agents.length, APPROVED_CLIS.length);

      const expectedByParticipant = new Map<
        string,
        { modelId: string; reasoning: string; runtimeOfferId: string }
      >();
      for (const [index, approved] of APPROVED_CLIS.entries()) {
        const spec = runtimeSpecs[index]!;
        const runtime = inventory.runtimes.find(
          (candidate) =>
            candidate.configured &&
            candidate.runtimeProfileId === spec.runtimeProfileId,
        );
        assert.ok(
          runtime,
          `configured Runtime missing for ${approved.executable}`,
        );
        assert.ok(runtime.runtimeOfferId);
        const binding = runtime.modelBindingDescriptors.find(
          (candidate) => candidate.modelId === approved.modelId,
        );
        assert.ok(
          binding,
          `${approved.executable} catalog did not publish ${approved.modelId}`,
        );
        if (approved.reasoning !== "default") {
          // The authorized matrix is exact: a gate must never quietly spend on a
          // different reasoning level than the one the user approved.
          assert.ok(
            binding.supportedReasoning.includes(approved.reasoning),
            `${approved.executable} ${approved.modelId} does not publish authorized reasoning ${approved.reasoning} (published: ${binding.supportedReasoning.join(", ")})`,
          );
        }
        const agent = catalog.agents.find(
          (candidate) => candidate.handle === spec.agentHandle,
        );
        assert.ok(agent, `Agent missing for ${approved.executable}`);

        const controlDelivery = await syncRoom(
          origin,
          prepared.humanAccessToken,
          prepared.metadata.controlRoomId,
          "real-multi-cli-control",
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
            handle: spec.agentHandle,
            idempotencyKey: `real-multi-cli-config-${approved.executable}`,
            instructions: spec.instructions,
            modelIntent: {
              exactBindingIds: [binding.modelBindingId],
              fallback: "disabled",
              reasoning: approved.reasoning,
              serviceTier: "default",
            },
            role: spec.role,
            runtimeOfferId: runtime.runtimeOfferId,
            toolAccessMode: "full_access",
          },
        );
        expectedByParticipant.set(agent.definition.participantId, {
          modelId: approved.modelId,
          reasoning: approved.reasoning,
          runtimeOfferId: runtime.runtimeOfferId,
        });
      }

      const membership = await postJson<{
        memberships: { principalId: string }[];
      }>(origin, prepared.humanAccessToken, "/v3/client/rooms/members/list", {
        roomId: prepared.metadata.defaultRoomId,
      });
      for (const agent of catalog.agents) {
        assert.ok(
          membership.memberships.some(
            (member) => member.principalId === agent.definition.participantId,
          ),
          "#all automatically includes every bootstrapped Agent",
        );
      }

      const beforeMessage = await syncRoom(
        origin,
        prepared.humanAccessToken,
        prepared.metadata.defaultRoomId,
        "real-multi-cli-human",
      );
      const posted = await postJson<{
        activationIds: string[];
        event: { aggregateId: string; roomSeq: number };
      }>(origin, prepared.humanAccessToken, "/v3/client/messages/post", {
        basedOnRoomSeq: beforeMessage.latestRoomSeq,
        body: [
          "What is today's date in UTC? Answer in one concise sentence.",
          "Do not inspect or change workspace files.",
          "Reply exactly once through the canonical RAH Worker message-post command, then acknowledge the delivered cursor.",
        ].join(" "),
        idempotencyKey: "real-multi-cli-room-message",
        recipients: [],
        roomId: prepared.metadata.defaultRoomId,
      });
      assert.equal(posted.activationIds.length, APPROVED_CLIS.length);

      const participantIds = new Set(expectedByParticipant.keys());
      await waitUntil(() => {
        const replies = observer!
          .listMessages(humanActor, {
            roomId: prepared.metadata.defaultRoomId,
          })
          .messages.filter((message) => participantIds.has(message.actorId));
        const activations = observer!.listActivations({
          roomId: prepared.metadata.defaultRoomId,
        });
        assert.ok(
          activations.every((activation) => activation.state !== "quarantined"),
          "a quarantined real Provider cannot pass ordinary-message acceptance",
        );
        return (
          replies.length === APPROVED_CLIS.length &&
          activations.length >= APPROVED_CLIS.length &&
          activations.every((activation) => activation.state === "completed")
        );
      });

      const replies = observer
        .listMessages(humanActor, {
          roomId: prepared.metadata.defaultRoomId,
        })
        .messages.filter((message) => participantIds.has(message.actorId));
      assert.equal(replies.length, APPROVED_CLIS.length);
      assert.deepEqual(
        observer.listTasks(humanActor, {
          roomId: prepared.metadata.defaultRoomId,
        }),
        [],
        "a bounded date query must remain ordinary conversation",
      );
      for (const participantId of participantIds) {
        assert.equal(
          replies.filter((message) => message.actorId === participantId).length,
          1,
          `Agent ${participantId} must emit exactly one canonical reply`,
        );
      }

      const placements = observer.listPlacements({
        roomId: prepared.metadata.defaultRoomId,
      });
      const attempts = observer.listRunAttempts({
        roomId: prepared.metadata.defaultRoomId,
      });
      // Room-policy replies are also durable context deliveries. They may need
      // acknowledge-only Runs; exact Run count is not the business invariant.
      assert.ok(placements.length >= APPROVED_CLIS.length);
      assert.ok(
        attempts.length <= APPROVED_CLIS.length ** 2,
        "ordinary replies must converge to bounded quiescence",
      );
      assert.ok(
        attempts.every(
          (attempt) => attempt.state === "exited" && attempt.exitCode === 0,
        ),
      );
      for (const participantId of participantIds) {
        const expected = expectedByParticipant.get(participantId)!;
        const placement = placements.find(
          (candidate) => candidate.participantId === participantId,
        );
        assert.ok(placement, `Placement missing for Agent ${participantId}`);
        assert.equal(placement.runtimeOfferId, expected.runtimeOfferId);
        assert.equal(placement.toolAccessMode, "full_access");
        assert.equal(placement.resolvedModel.source, "explicit_binding");
        if (placement.resolvedModel.source === "explicit_binding") {
          assert.equal(placement.resolvedModel.modelId, expected.modelId);
          assert.equal(
            placement.resolvedModel.reasoning ?? "default",
            expected.reasoning,
          );
        }
        const attempt = attempts.find(
          (candidate) => candidate.participantId === participantId,
        );
        assert.ok(attempt, `RunAttempt missing for Agent ${participantId}`);
        assert.equal(attempt.state, "exited");
        assert.equal(attempt.exitCode, 0);
      }

      const beforeDurableMessage = await syncRoom(
        origin,
        prepared.humanAccessToken,
        prepared.metadata.defaultRoomId,
        "real-multi-cli-human",
      );
      const durablePosted = await postJson<{
        activationIds: string[];
        event: { aggregateId: string; roomSeq: number };
      }>(origin, prepared.humanAccessToken, "/v3/client/messages/post", {
        basedOnRoomSeq: beforeDurableMessage.latestRoomSeq,
        body: [
          "Implement and verify a persistent workspace change that requires durable progress and human acceptance.",
          'Create RAH_TASK_INTENT_PROOF.txt with the exact single line "RAH OS real Task intent gate".',
          "Verify the saved file, report canonical progress, and submit the result for review.",
          "This is execution work, not a discussion; do not merely propose steps.",
        ].join(" "),
        idempotencyKey: "real-multi-cli-durable-message",
        recipients: [],
        roomId: prepared.metadata.defaultRoomId,
      });
      assert.equal(durablePosted.activationIds.length, APPROVED_CLIS.length);

      await waitUntil(() => {
        const tasks = observer!.listTasks(humanActor, {
          roomId: prepared.metadata.defaultRoomId,
        });
        const activations = observer!
          .listActivations({ roomId: prepared.metadata.defaultRoomId })
          .filter((activation) =>
            durablePosted.activationIds.includes(activation.activationId),
          );
        const succeeded =
          tasks.length === 1 &&
          tasks[0]?.state === "submitted" &&
          activations.length === APPROVED_CLIS.length &&
          activations.every((activation) => activation.state === "completed");
        if (
          !succeeded &&
          activations.length === APPROVED_CLIS.length &&
          activations.every((activation) =>
            ["completed", "quarantined"].includes(activation.state),
          )
        ) {
          throw new Error(
            `real Agents reached a terminal state without one submitted Task: ${JSON.stringify({ activations, tasks })}`,
          );
        }
        return succeeded;
      });

      const [automaticTask] = observer.listTasks(humanActor, {
        roomId: prepared.metadata.defaultRoomId,
      });
      assert.ok(automaticTask);
      assert.equal(
        automaticTask.sourceMessageId,
        durablePosted.event.aggregateId,
      );
      assert.equal(automaticTask.state, "submitted");
      assert.ok(automaticTask.assigneeId);
      assert.ok(participantIds.has(automaticTask.assigneeId));
      const durableProofPath = join(
        agentExecutionWorkspacePath(
          join(stateDirectory, "agent-workspaces"),
          automaticTask.assigneeId,
        ),
        "RAH_TASK_INTENT_PROOF.txt",
      );
      assert.equal(
        readFileSync(durableProofPath, "utf8").trim(),
        "RAH OS real Task intent gate",
      );

      const messagesAfterTask = observer.listMessages(humanActor, {
        roomId: prepared.metadata.defaultRoomId,
      }).messages;
      const topLevelAgentReplies = messagesAfterTask.filter(
        (message) =>
          participantIds.has(message.actorId) && message.threadId === undefined,
      );
      assert.equal(
        topLevelAgentReplies.length,
        APPROVED_CLIS.length,
        "the automatic Task must not produce a competing top-level answer",
      );
      const taskReplies = messagesAfterTask.filter(
        (message) => message.threadId === automaticTask.threadId,
      );
      assert.equal(taskReplies.length, 2);
      assert.ok(
        taskReplies.every(
          (message) => message.actorId === automaticTask.assigneeId,
        ),
      );
    } finally {
      shutdown.abort("real-multi-cli-gate-finished");
      await running?.catch(() => undefined);
      observer?.close();
      if (process.env.RAH_REAL_GATE_KEEP !== "1")
        rmSync(directory, { force: true, recursive: true });
    }
  },
);

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
    if (Date.now() >= deadline) {
      throw new Error("real multi-CLI gate timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
