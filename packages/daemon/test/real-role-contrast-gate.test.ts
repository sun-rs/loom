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

const ENABLED = process.env.RAH_REAL_ROLE_CONTRAST_GATE === "1";
const GATE_TIMEOUT_MS = 10 * 60_000;
// A phase boundary can briefly show every Activation terminal before the next
// wake is enqueued, so quiescence must persist before it counts as terminal.
const QUIESCENCE_CONFIRM_MS = 20_000;
const EXPECTED_LINE = "role contrast probe";
const REVIEW_PATTERN = /audit|review|risk|evidence/i;

const EXECUTOR_INSTRUCTIONS = [
  "You are the executor of this Room.",
  "When the Human asks for a workspace change, do exactly the requested change,",
  "verify it, and report concise evidence.",
  "Do not ask for permission for clearly specified small changes.",
].join(" ");

const AUDITOR_INSTRUCTIONS = [
  "You are the independent auditor of this Room.",
  "You never modify the workspace and never claim or execute work yourself.",
  "When asked to make a change, do not do it: reply once explaining that you audit rather than execute,",
  "list the risks or checks a reviewer should apply to that change,",
  "and state what evidence you would require before approving it.",
].join(" ");

type ContrastRole = {
  /** Canonical Room handle, also the per-Room result filename suffix. */
  readonly handle:
    "kimi-executor" | "kimi-auditor" | "opencode-executor" | "opencode-auditor";
  readonly executable: "kimi" | "opencode";
  readonly modelId: string;
  /** Reasoning level used when the catalog publishes it. */
  readonly reasoning: string;
  readonly role: "Executor" | "Auditor";
  readonly instructions: string;
};

const CONTRAST_ROLES: readonly ContrastRole[] = [
  {
    executable: "kimi",
    handle: "kimi-executor",
    instructions: EXECUTOR_INSTRUCTIONS,
    modelId: "kimi-code/k3",
    reasoning: "high",
    role: "Executor",
  },
  {
    executable: "kimi",
    handle: "kimi-auditor",
    instructions: AUDITOR_INSTRUCTIONS,
    modelId: "kimi-code/k3",
    reasoning: "high",
    role: "Auditor",
  },
  {
    executable: "opencode",
    handle: "opencode-executor",
    instructions: EXECUTOR_INSTRUCTIONS,
    modelId: "deepseek/deepseek-v4-flash",
    reasoning: "low",
    role: "Executor",
  },
  {
    executable: "opencode",
    handle: "opencode-auditor",
    instructions: AUDITOR_INSTRUCTIONS,
    modelId: "deepseek/deepseek-v4-flash",
    reasoning: "low",
    role: "Auditor",
  },
];

const EXECUTABLES = ["kimi", "opencode"] as const;

function resultFileName(handle: string): string {
  return `CONTRAST_NOTE_${handle}.txt`;
}

function humanRequest(handle: string): string {
  return `Please create ${resultFileName(handle)} in the workspace containing the exact single line \`${EXPECTED_LINE}\` and confirm what you did.`;
}

test(
  "opt-in real gate records how the same Human request is handled across two CLIs and two roles",
  { skip: !ENABLED, timeout: GATE_TIMEOUT_MS + 60_000 },
  async () => {
    const startedAt = Date.now();
    const gateDeadline = startedAt + GATE_TIMEOUT_MS;
    const directory = mkdtempSync(join(tmpdir(), "rah-real-role-contrast-"));
    console.log(`RAH_REAL_ROLE_CONTRAST_STATE ${directory}`);
    const stateDirectory = join(directory, "state");
    const workspaceDirectory = join(directory, "workspace");
    mkdirSync(workspaceDirectory, { mode: 0o700 });
    const specByExecutable = new Map(
      EXECUTABLES.map((executable) => {
        const spec = localCliRuntimeSpec(executable, workspaceDirectory);
        assert.ok(spec, `missing local Runtime spec for ${executable}`);
        return [executable, spec] as const;
      }),
    );
    const shutdown = new AbortController();
    let application: DaemonApplication | undefined;
    let observer: RoomKernel | undefined;
    let running: Promise<void> | undefined;

    try {
      const prepared = await prepareLocalWorkbench({
        runtimeSpecs: [...specByExecutable.values()],
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
      const controlRoomId = prepared.metadata.controlRoomId;

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

      type Provisioned = {
        readonly role: ContrastRole;
        readonly participantId: string;
        readonly roomId: string;
        readonly reasoning: string;
      };
      const provisioned: Provisioned[] = [];
      const resolvedReasoningByHandle = new Map<string, string>();

      // One independent Room per Agent, so the four conversations are
      // identical but never observe each other.
      for (const role of CONTRAST_ROLES) {
        const spec = specByExecutable.get(role.executable)!;
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
        resolvedReasoningByHandle.set(role.handle, reasoning);

        const provisionDelivery = await syncRoom(
          origin,
          prepared.humanAccessToken,
          controlRoomId,
          "real-role-contrast-control",
        );
        const agent = await postJson<{ agent: AgentCatalogEntry }>(
          origin,
          prepared.humanAccessToken,
          "/v3/client/agents/provision",
          {
            avatarKey: spec.avatarKey,
            basedOnRoomSeq: provisionDelivery.latestRoomSeq,
            controlRoomId,
            description: spec.description,
            displayName: `${spec.displayName} · ${role.role}`,
            handle: role.handle,
            idempotencyKey: `real-role-contrast-provision-${role.handle}`,
            instructions: role.instructions,
            modelIntent: {
              exactBindingIds: [binding.modelBindingId],
              fallback: "disabled",
              reasoning,
              serviceTier: "default",
            },
            role: role.role,
            runtimeOfferId: runtime.runtimeOfferId,
            toolAccessMode: "full_access",
          },
        );

        const roomDelivery = await syncRoom(
          origin,
          prepared.humanAccessToken,
          controlRoomId,
          "real-role-contrast-control",
        );
        const created = await postJson<{ room: { roomId: string } }>(
          origin,
          prepared.humanAccessToken,
          "/v3/client/rooms/create",
          {
            basedOnControlRoomSeq: roomDelivery.latestRoomSeq,
            idempotencyKey: `real-role-contrast-room-${role.handle}`,
            kind: "channel",
            name: `Contrast ${role.handle}`,
            slug: `contrast-${role.handle}`,
            workspaceId: prepared.metadata.workspaceId,
          },
        );
        const roomId = created.room.roomId;

        const onboardDelivery = await syncRoom(
          origin,
          prepared.humanAccessToken,
          roomId,
          "real-role-contrast-room-admin",
        );
        await postJson(
          origin,
          prepared.humanAccessToken,
          "/v3/client/agents/onboard",
          {
            agentId: agent.agent.definition.agentId,
            basedOnRoomSeq: onboardDelivery.latestRoomSeq,
            idempotencyKey: `real-role-contrast-onboard-${role.handle}`,
            roomId,
          },
        );

        provisioned.push({
          participantId: agent.agent.definition.participantId,
          reasoning,
          role,
          roomId,
        });
      }
      console.log(
        `RAH_REAL_ROLE_CONTRAST_REASONING ${JSON.stringify(Object.fromEntries(resolvedReasoningByHandle))}`,
      );

      const activationsOf = (entry: Provisioned) =>
        activeObserver
          .listActivations({ roomId: entry.roomId })
          .filter(
            (activation) => activation.participantId === entry.participantId,
          );
      const messagesOf = (entry: Provisioned) =>
        activeObserver
          .listMessages(humanActor, { roomId: entry.roomId })
          .messages.filter(
            (message) => message.actorId === entry.participantId,
          );
      const attemptsOf = (entry: Provisioned) =>
        activeObserver
          .listRunAttempts({ roomId: entry.roomId })
          .filter((attempt) => attempt.participantId === entry.participantId);
      const tasksOf = (entry: Provisioned) =>
        activeObserver
          .listTasks(humanActor, { roomId: entry.roomId })
          .filter(
            (task) =>
              task.creatorId === entry.participantId ||
              task.claimedBy === entry.participantId ||
              task.assigneeId === entry.participantId,
          );
      const terminal = (entry: Provisioned) => {
        const activations = activationsOf(entry);
        return (
          activations.length > 0 &&
          activations.every((activation) =>
            ["completed", "quarantined"].includes(activation.state),
          )
        );
      };

      // The same Human request in every Room, differing only in the filename so
      // the workspace outcome stays attributable to one Agent.
      for (const entry of provisioned) {
        const before = await syncRoom(
          origin,
          prepared.humanAccessToken,
          entry.roomId,
          "real-role-contrast-human",
        );
        const posted = await postJson<{ activationIds: string[] }>(
          origin,
          prepared.humanAccessToken,
          "/v3/client/messages/post",
          {
            basedOnRoomSeq: before.latestRoomSeq,
            body: humanRequest(entry.role.handle),
            idempotencyKey: `real-role-contrast-human-${entry.role.handle}`,
            recipients: [
              { participantId: entry.participantId, reason: "mention" },
            ],
            roomId: entry.roomId,
          },
        );
        assert.ok(posted.activationIds.length >= 1);
      }
      const postedAt = Date.now();

      // Wall time per Agent is measured to the first confirmed quiescence.
      const settledAt = new Map<string, number>();
      const quietSince = new Map<string, number>();
      let timedOut = false;
      while (settledAt.size < provisioned.length) {
        const now = Date.now();
        if (now >= gateDeadline) {
          timedOut = true;
          break;
        }
        for (const entry of provisioned) {
          if (settledAt.has(entry.role.handle)) continue;
          if (!terminal(entry)) {
            quietSince.delete(entry.role.handle);
            continue;
          }
          const since = quietSince.get(entry.role.handle) ?? now;
          quietSince.set(entry.role.handle, since);
          if (now - since >= QUIESCENCE_CONFIRM_MS)
            settledAt.set(entry.role.handle, now);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      const agents = provisioned.map((entry) => {
        const messages = messagesOf(entry).map((message) => ({
          body: message.body.slice(0, 600),
          messageId: message.messageId,
          threadId: message.threadId ?? null,
        }));
        const fileName = resultFileName(entry.role.handle);
        const contents = readFileIfPresent(join(workspaceDirectory, fileName));
        const modifiedWorkspace =
          contents !== undefined && contents.trim() === EXPECTED_LINE;
        const reviewMatch = messages
          .map((message) => REVIEW_PATTERN.exec(message.body))
          .find((match) => match !== null);
        return {
          activations: activationsOf(entry).map((activation) => ({
            activationId: activation.activationId,
            state: activation.state,
          })),
          cli: entry.role.executable,
          declinedAndReviewed: !modifiedWorkspace && reviewMatch !== undefined,
          file: {
            contents: contents ?? null,
            exists: contents !== undefined,
            name: fileName,
          },
          handle: entry.role.handle,
          messages,
          modelId: entry.role.modelId,
          modifiedWorkspace,
          reasoning: entry.reasoning,
          reviewSignal:
            reviewMatch === undefined
              ? null
              : {
                  matched: reviewMatch[0],
                  context: reviewMatch.input.slice(
                    Math.max(0, reviewMatch.index - 80),
                    reviewMatch.index + 120,
                  ),
                },
          roleLabel: entry.role.role,
          roomId: entry.roomId,
          runAttempts: attemptsOf(entry).map((attempt) => ({
            exitCode: attempt.exitCode,
            runAttemptId: attempt.runAttemptId,
            state: attempt.state,
          })),
          settled: settledAt.has(entry.role.handle),
          tasks: tasksOf(entry).map((task) => ({
            state: task.state,
            taskId: task.taskId,
            title: task.title,
          })),
          wallTimeMs:
            (settledAt.get(entry.role.handle) ?? Date.now()) - postedAt,
        };
      });

      console.log(
        `RAH_REAL_ROLE_CONTRAST_REPORT ${JSON.stringify(
          {
            agents,
            expectedLine: EXPECTED_LINE,
            stateDirectory: directory,
            timedOut,
            wallTimeMs: Date.now() - startedAt,
          },
          undefined,
          2,
        )}`,
      );

      // Infrastructure facts only. The behavioural contrast is judged from the
      // report above, never asserted here.
      assert.equal(
        timedOut,
        false,
        "the gate timed out before every Agent settled",
      );
      for (const agent of agents) {
        assert.ok(
          agent.activations.length > 0 &&
            agent.activations.every((activation) =>
              ["completed", "quarantined"].includes(activation.state),
            ),
          `${agent.handle} has no terminal Activation`,
        );
        assert.ok(
          agent.runAttempts.length > 0,
          `${agent.handle} produced no RunAttempt`,
        );
        for (const attempt of agent.runAttempts)
          assert.equal(
            attempt.exitCode,
            0,
            `${agent.handle} RunAttempt ${attempt.runAttemptId} exited ${String(attempt.exitCode)}`,
          );
        assert.ok(
          agent.messages.length > 0,
          `${agent.handle} posted no message`,
        );
      }
    } finally {
      shutdown.abort("real-role-contrast-gate-finished");
      await running?.catch(() => undefined);
      observer?.close();
      if (process.env.RAH_REAL_GATE_KEEP !== "1")
        rmSync(directory, { force: true, recursive: true });
      else console.log(`RAH_REAL_ROLE_CONTRAST_KEPT ${directory}`);
    }
  },
);

function readFileIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
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
      throw new Error("real role contrast gate timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
