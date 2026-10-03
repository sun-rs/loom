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
  type LocalWorkbenchRuntimeSpec,
} from "../src/index.ts";

const ENABLED = process.env.RAH_REAL_REVIEW_GATE === "1";
const GATE_TIMEOUT_MS = 10 * 60_000;

type ApprovedCli = {
  executable: "codex" | "kimi" | "opencode";
  modelId: string;
  reasoning: "default" | "low" | "max";
};

const APPROVED_CLIS: readonly ApprovedCli[] = [
  { executable: "kimi", modelId: "kimi-code/k3", reasoning: "low" },
  {
    executable: "opencode",
    modelId: "deepseek/deepseek-v4-flash",
    reasoning: "low",
  },
];

test(
  "opt-in native DeepSeek and Kimi reject a frozen submission, rework, approve and retain Human acceptance",
  { skip: !ENABLED, timeout: GATE_TIMEOUT_MS + 30_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-real-review-"));
    console.log(`RAH_REAL_REVIEW_STATE ${directory}`);
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
          assert.ok(
            binding.supportedReasoning.includes(approved.reasoning),
            `${approved.executable} ${approved.modelId} does not support ${approved.reasoning}`,
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

      for (const [index, agent] of catalog.agents.entries()) {
        const roomDelivery = await syncRoom(
          origin,
          prepared.humanAccessToken,
          prepared.metadata.defaultRoomId,
          "real-multi-cli-room-admin",
        );
        await postJson(
          origin,
          prepared.humanAccessToken,
          "/v3/client/rooms/members/add",
          {
            principalId: agent.definition.participantId,
            role: "member",
            basedOnRoomSeq: roomDelivery.latestRoomSeq,
            idempotencyKey: `real-multi-cli-onboard-${String(index)}`,
            roomId: prepared.metadata.defaultRoomId,
          },
        );
      }

      const roomId = prepared.metadata.defaultRoomId;
      const owner = catalog.agents.find(
        (agent) => agent.handle === "OpenCode",
      )!;
      const reviewer = catalog.agents.find((agent) => agent.handle === "Kimi")!;
      const delivery = await syncRoom(
        origin,
        prepared.humanAccessToken,
        roomId,
        "review-gate-human",
      );
      const created = await postJson<{ task: { taskId: string } }>(
        origin,
        prepared.humanAccessToken,
        "/v3/client/tasks/create",
        {
          roomId,
          basedOnRoomSeq: delivery.latestRoomSeq,
          idempotencyKey: "real-review-create",
          assigneeId: owner.definition.participantId,
          reviewerIds: [reviewer.definition.participantId],
          title: "Isolated two-version frozen artifact review gate",
          description: [
            "This is an explicitly authorized isolated protocol test. Only edit files in your assigned temporary cwd.",
            "Owner: first submission intentionally writes REVIEW_PROOF.txt containing exactly VERSION_ONE then newline; publish it with worker artifact-publish, and submit.",
            "After a changes_requested Review, change the file to exactly VERSION_TWO then newline; publish a NEW artifact with a different idempotency key and resubmit.",
            "Reviewer: use worker task-submission to obtain the frozen submission, download its attachment using worker artifact-download into a new local inspection file, and inspect those bytes, not the mutable owner file.",
            "If the frozen bytes contain VERSION_ONE, record task-review changes_requested and ask for VERSION_TWO. If the frozen bytes contain VERSION_TWO, record task-review approved.",
            "Follow task-claim/start/progress/submit and causal cursor rules. Do not post a competing top-level reply. Acknowledge your original delivered cursor and exit after your own action.",
          ].join(" "),
        },
      );
      const input = { roomId, taskId: created.task.taskId };
      await waitUntil(() => {
        const reviews = observer!.taskReviews.listTaskReviews(
          humanActor,
          input,
        );
        return (
          reviews.length === 2 &&
          reviews[1]?.disposition === "approved" &&
          observer!
            .listActivations({ roomId })
            .every((a) => a.state === "completed")
        );
      });
      const reviews = observer.taskReviews.listTaskReviews(humanActor, input);
      const submissions = observer.taskReviews.listTaskSubmissions(
        humanActor,
        input,
      );
      assert.deepEqual(
        reviews.map((r) => r.disposition),
        ["changes_requested", "approved"],
      );
      assert.equal(submissions.length, 2);
      assert.notEqual(reviews[0]!.submissionId, reviews[1]!.submissionId);
      assert.equal(
        readFileSync(join(workspaceDirectory, "REVIEW_PROOF.txt"), "utf8"),
        "VERSION_TWO\n",
      );
      assert.equal(
        observer
          .listTasks(humanActor, { roomId })
          .find((t) => t.taskId === input.taskId)?.state,
        "submitted",
      );
      const beforeAccept = await syncRoom(
        origin,
        prepared.humanAccessToken,
        roomId,
        "review-gate-human",
      );
      await postJson(
        origin,
        prepared.humanAccessToken,
        "/v3/client/tasks/complete",
        {
          taskId: input.taskId,
          basedOnRoomSeq: beforeAccept.latestRoomSeq,
          idempotencyKey: "review-gate-accept",
        },
      );
      assert.equal(
        observer.listTasks(humanActor, { roomId })[0]?.state,
        "completed",
      );
      console.log(
        "RAH_REAL_REVIEW_RESULT",
        JSON.stringify({ reviews, submissions, models: APPROVED_CLIS }),
      );
      shutdown.abort("review-gate-reopen");
      await running;
      observer.close();
      observer = new RoomKernel({
        databasePath: join(stateDirectory, "room.db"),
      });
      observer.initialize();
      assert.deepEqual(
        observer.taskReviews.listTaskReviews(humanActor, input),
        reviews,
      );
      assert.deepEqual(
        observer.taskReviews.listTaskSubmissions(humanActor, input),
        submissions,
      );
      assert.equal(
        observer.listTasks(humanActor, { roomId })[0]?.state,
        "completed",
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
