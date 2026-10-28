import { prepareLocalWorkbench } from "./workbench-channel-fixture.ts";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";
import type {
  AgentCatalogEntry,
  LocalRuntimeInventoryResponse,
  Message,
  Thread,
} from "@rah-os/protocol";

import {
  DaemonApplication,
  localCliRuntimeSpec,
} from "../src/index.ts";

const ENABLED = process.env.RAH_REAL_DUAL_THREAD_GATE === "1";
const GATE_TIMEOUT_MS = 12 * 60_000;
const STALL_CONFIRM_MS = 20_000;

type SplitRole = {
  /** Canonical Room handle that `@mention` resolves. */
  readonly handle: "lead" | "reviewer";
  readonly executable: "codex" | "kimi" | "opencode";
  readonly modelId: string;
  /** Reasoning level used when the catalog publishes it. */
  readonly reasoning: string;
  readonly instructions: string;
};

const SPLIT_ROLES: readonly SplitRole[] = [
  {
    executable: "kimi",
    handle: "lead",
    modelId: "kimi-code/k3",
    reasoning: "high",
    instructions:
      "Follow the Human's temporary assignment in the Room. Use the existing Room tools to communicate.",
  },
  {
    executable: "opencode",
    handle: "reviewer",
    modelId: "deepseek/deepseek-v4-flash",
    reasoning: "low",
    instructions:
      "Follow the Human's temporary assignment in the Room. Use the existing Room tools to communicate.",
  },
];
test(
  "opt-in two independent threads preserve targets during busy append",
  { skip: !ENABLED, timeout: GATE_TIMEOUT_MS + 60_000 },
  async () => {
    const startedAt = Date.now();
    const gateDeadline = startedAt + GATE_TIMEOUT_MS;
    const directory = mkdtempSync(join(tmpdir(), "rah-real-dual-thread-"));
    console.log(`RAH_REAL_DUAL_THREAD_STATE ${directory}`);
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
      const reviewer = participantIdByHandle.get("reviewer")!;
      const allMessages = () =>
        activeObserver.listMessages(humanActor, { roomId, limit: 500 })
          .messages;
      const idle = () =>
        activeObserver
          .listActivations({ roomId })
          .every((a) => !["queued", "leased"].includes(a.state));
      const mutate = async <T>(
        path: string,
        body: Record<string, unknown>,
      ): Promise<T> => {
        const before = await syncRoom(
          origin,
          prepared.humanAccessToken,
          roomId,
          "dual-thread-human",
        );
        return await postJson<T>(origin, prepared.humanAccessToken, path, {
          ...body,
          roomId,
          basedOnRoomSeq: before.latestRoomSeq,
        });
      };
      const threads: Record<
        string,
        { threadId: string; rootMessageId: string }
      > = {};
      for (const label of ["A", "B"]) {
        const root = await mutate<{ event: { aggregateId: string } }>(
          "/v3/client/messages/post",
          {
            body: `独立验收话题 ${label}。所有后续工作和回复留在该话题。`,
            recipients: [],
            idempotencyKey: `dual-root-${label}`,
          },
        );
        const created = await mutate<{ thread: Thread }>(
          "/v3/client/threads/create",
          {
            rootMessageId: root.event.aggregateId,
            recipientIds: [],
            idempotencyKey: `dual-thread-${label}`,
          },
        );
        threads[label] = created.thread;
      }
      const expectations: ExpectedReply[] = [];
      const initialReceipts: unknown[] = [];
      for (const [label, executor, auditor, sum] of [
        ["A", "lead", "reviewer", 3],
        ["B", "reviewer", "lead", 5],
      ] as const) {
        const body = `@${executor} 在本话题${label}你负责执行，@${auditor} 独立审计。无需创建Task。请先执行 touch .thread-${label.toLowerCase()}-active; sleep 20，再独立计算${label === "A" ? "1+2" : "2+3"}，在本话题发一条 [${label}:RESULT] SUM=结果 并真实提及 ${auditor}。审计者等到RESULT后独立核算，正确则在同一话题发 [${label}:PASS] 并提及 ${executor}，错误则要求返工。执行者收到本话题PASS后只发 [${label}:DONE] 且不提及任何人。不要替另一话题完成步骤，不要在Room顶层回复。两个话题独立继续，不需要Human催促。`;
        initialReceipts.push(
          await mutate("/v3/client/threads/reply", {
            body,
            threadId: threads[label]!.threadId,
            recipientIds: [lead, reviewer],
            idempotencyKey: `dual-request-${label}`,
          }),
        );
        for (const [suffix, handle] of [
          ["RESULT", executor],
          ["PASS", auditor],
          ["DONE", executor],
        ] as const) {
          expectations.push({
            marker: `[${label}:${suffix}]`,
            actorId: participantIdByHandle.get(handle)!,
            roomId,
            ...threads[label]!,
            ...(suffix === "RESULT" ? { sum } : {}),
          });
        }
      }
      await waitUntil(
        () => existsSync(join(workspaceDirectory, ".thread-a-active")),
        Math.max(1, gateDeadline - Date.now()),
      );
      const busy = activeObserver
        .listActivations({ roomId })
        .filter((a) => a.participantId === lead && a.state === "leased");
      assert.ok(busy.length, "append must land during a leased lead execution");
      const appended = await mutate("/v3/client/threads/reply", {
        body: "@lead 话题A忙时追加：请在话题A单独发 [A:NOTE] 确认收到。本条不取消A原来的计算、审计和DONE，也不取消话题B的工作。",
        threadId: threads.A!.threadId,
        recipientIds: [lead],
        idempotencyKey: "dual-append-A",
      });
      expectations.push({
        marker: "[A:NOTE]",
        actorId: lead,
        roomId,
        ...threads.A!,
      });
      const snapshot = () => ({
        messages: allMessages(),
        threads: activeObserver.listThreads(humanActor, { roomId }),
        activations: activeObserver.listActivations({ roomId }),
        initialReceipts,
        appended,
        busyActivationIds: busy.map((a) => a.activationId),
        expectations,
      });
      try {
        await waitForOutcome({
          deadline: gateDeadline,
          label: "two independent threads and append",
          stalled: idle,
          succeeded: () =>
            expectations.every((e) =>
              allMessages().some(
                (m) => m.actorId === e.actorId && m.body.includes(e.marker),
              ),
            ),
          diagnose: () => JSON.stringify(snapshot()),
        });
        await waitUntil(idle, Math.max(1, gateDeadline - Date.now()));
        const rows = allMessages();
        assertThreadReplies(
          rows,
          activeObserver.listThreads(humanActor, { roomId }),
          expectations,
        );
        assertThreadCausalOrder(rows, expectations);
        const count = rows.length;
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        assert.equal(
          allMessages().length,
          count,
          "no repeated conversation after both goals",
        );
        assert.ok(
          idle(),
          "no queued or leased execution after quiet observation",
        );
        console.log("RAH_DUAL_THREAD_RESULT " + JSON.stringify(snapshot()));
      } finally {
        writeFileSync(
          join(directory, "dual-thread-evidence.json"),
          JSON.stringify(snapshot(), null, 2),
        );
      }
    } finally {
      shutdown.abort("dual-thread-finished");
      await running?.catch(() => undefined);
      observer?.close();
      console.log(`RAH_DUAL_THREAD_KEPT ${directory}`);
    }
  },
);

type ExpectedReply = {
  marker: string;
  actorId: string;
  roomId: string;
  threadId: string;
  rootMessageId: string;
  sum?: number;
};
function assertThreadCausalOrder(
  rows: readonly Message[],
  expected: readonly ExpectedReply[],
) {
  for (const label of ["A", "B"]) {
    const steps = ["RESULT", "PASS", "DONE"].map(
      (suffix) =>
        rows.find(
          (m) =>
            expected.some(
              (e) =>
                e.marker === `[${label}:${suffix}]` && e.actorId === m.actorId,
            ) && m.body.includes(`[${label}:${suffix}]`),
        )?.roomSeq,
    );
    assert.ok(
      steps[0] &&
        steps[1] &&
        steps[2] &&
        steps[0] < steps[1] &&
        steps[1] < steps[2],
      `${label} causal order`,
    );
  }
}

function assertThreadReplies(
  rows: readonly Message[],
  threads: readonly Thread[],
  expected: readonly ExpectedReply[],
) {
  const claimedMessageIds = new Set<string>();
  for (const item of expected) {
    const matches = rows.filter(
      (m) => m.actorId === item.actorId && m.body.includes(item.marker),
    );
    assert.equal(matches.length, 1, `${item.marker} exactly once`);
    const message = matches[0]!;
    assert.equal(message.roomId, item.roomId, `${item.marker} Room`);
    assert.equal(message.threadId, item.threadId, `${item.marker} Thread`);
    const thread = threads.find((t) => t.threadId === message.threadId);
    assert.ok(thread, `${item.marker} Thread exists`);
    assert.equal(thread.roomId, item.roomId, `${item.marker} Thread Room`);
    assert.equal(
      thread.rootMessageId,
      item.rootMessageId,
      `${item.marker} root parent`,
    );
    assert.ok(
      !claimedMessageIds.has(message.messageId),
      `${item.marker} has an independent message`,
    );
    claimedMessageIds.add(message.messageId);
    if (item.sum !== undefined)
      assert.match(
        message.body,
        new RegExp(`SUM\\s*=\\s*${item.sum}(?![0-9])`),
      );
  }
}

test("dual-thread verifier rejects crosstalk, wrong root, missing, duplicate and merged replies", () => {
  const expected: ExpectedReply[] = [
    {
      marker: "[A:RESULT]",
      actorId: "a",
      roomId: "r",
      threadId: "ta",
      rootMessageId: "ra",
      sum: 3,
    },
    {
      marker: "[A:NOTE]",
      actorId: "a",
      roomId: "r",
      threadId: "ta",
      rootMessageId: "ra",
    },
  ];
  const rows = expected.map((e, i) => ({
    actorId: e.actorId,
    roomId: e.roomId,
    threadId: e.threadId,
    messageId: `m${i}`,
    body: e.marker + (i === 0 ? " SUM=3" : ""),
    createdAt: "2026-09-11T00:00:00Z",
    roomSeq: i + 1,
  }));
  const threads: Thread[] = [
    {
      threadId: "ta",
      rootMessageId: "ra",
      roomId: "r",
      createdAt: "2026-09-11T00:00:00Z",
      createdBy: "h",
      replyCount: 2,
    },
  ];
  assert.doesNotThrow(() => assertThreadReplies(rows, threads, expected));
  for (const patch of [
    { roomId: "other" },
    { threadId: "tb" },
    { threadId: undefined },
    { actorId: "b" },
    { body: "[A:RESULT] SUM=4" },
  ])
    assert.throws(() =>
      assertThreadReplies(
        [{ ...rows[0]!, ...patch }, rows[1]!],
        threads,
        expected,
      ),
    );
  assert.throws(() =>
    assertThreadReplies(
      rows,
      [{ ...threads[0]!, rootMessageId: "rb" }],
      expected,
    ),
  );
  assert.throws(() => assertThreadReplies(rows.slice(1), threads, expected));
  assert.throws(() =>
    assertThreadReplies([...rows, rows[0]!], threads, expected),
  );
  assert.throws(() =>
    assertThreadReplies(
      [{ ...rows[0]!, body: "[A:RESULT] SUM=3 [A:NOTE]" }],
      threads,
      expected,
    ),
  );
});
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

test("causal verifier does not treat another actor quoting DONE as completion", () => {
  const expected: ExpectedReply[] = [];
  const rows: Message[] = [];
  for (const label of ["A", "B"]) {
    for (const [index, suffix] of ["RESULT", "PASS", "DONE"].entries()) {
      const actorId = suffix === "PASS" ? "auditor" : "executor";
      const marker = `[${label}:${suffix}]`;
      expected.push({
        marker,
        actorId,
        roomId: "r",
        threadId: label,
        rootMessageId: label,
      });
      rows.push({
        actorId,
        body:
          marker + (suffix === "PASS" ? ` please send [${label}:DONE]` : ""),
        roomId: "r",
        threadId: label,
        messageId: `${label}${index}`,
        roomSeq: index + 1,
        createdAt: "2026-09-11T00:00:00Z",
      });
    }
  }
  assert.doesNotThrow(() => assertThreadCausalOrder(rows, expected));
  assert.throws(() =>
    assertThreadCausalOrder(
      rows.filter((m) => m.messageId !== "A2"),
      expected,
    ),
  );
});

const REPLAY_FILE = process.env.RAH_DUAL_THREAD_REPLAY_FILE;
test(
  "saved dual-thread ledger satisfies corrected target and causal verifier",
  { skip: !REPLAY_FILE },
  () => {
    const evidence = JSON.parse(readFileSync(REPLAY_FILE!, "utf8")) as {
      messages: Message[];
      threads: Thread[];
      expectations: ExpectedReply[];
    };
    assert.equal(evidence.expectations.length, 7);
    assertThreadReplies(
      evidence.messages,
      evidence.threads,
      evidence.expectations,
    );
    assertThreadCausalOrder(evidence.messages, evidence.expectations);
  },
);
