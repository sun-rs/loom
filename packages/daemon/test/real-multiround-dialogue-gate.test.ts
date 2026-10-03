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
} from "@rah-os/protocol";

import {
  DaemonApplication,
  localCliRuntimeSpec,
  prepareLocalWorkbench,
} from "../src/index.ts";

const ENABLED = process.env.RAH_REAL_DIALOGUE_GATE === "1";
const OBSERVED_WRONG_VALUE = /OBSERVED\s*=\s*(?:SUM\s*=\s*)?5(?![0-9])/;
const SCENARIO = process.env.RAH_REAL_DIALOGUE_SCENARIO ?? "rounds";
assert.ok(["rounds", "rework", "rework-busy"].includes(SCENARIO));
const REWORK_REQUEST =
  "@reviewer 本轮临时分工：你独立审计，@lead 负责修复。工作区 repair-result.txt 是已有的待审交付，要求它只包含1到3的整数和，格式 SUM=结果。无需创建Task。请先读实际文件并独立核算；若错误，在当前频道发一条 [AUDIT:REWORK] OBSERVED=实际值 并说明正确结果，真实提及 lead 修复。lead 收到后先执行 touch .repair-active; sleep 20，再修复文件，读取核验后发 [REPAIR:DONE] 并提及 reviewer。reviewer 再次读取实际文件，正确后发 [AUDIT:PASS] 并提及 lead。lead 收到PASS后发 [GOAL:DONE] 且不再提及任何人。全过程不需要Human催促；不使用Thread，消息全部发在当前频道。";
const GATE_TIMEOUT_MS = 12 * 60_000;
// A phase boundary can briefly show every Activation terminal before the next
// wake is enqueued, so a stall must persist before it is reported as a gap.
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
const HUMAN_REQUEST =
  "@lead 本轮临时分工：你执行，@reviewer 独立审计。无需创建Task。共同计算1到n的和，n依次为1、2、3，共三轮。执行者每轮只发送一条带唯一标记 [PROPOSE:n] 和 SUM=计算结果 的频道消息，并通过真实提及通知 reviewer。审计者独立核算，每轮只发送一条 [REVIEW:n]，正确写 PASS 并提及 lead 继续下一轮；错误写 REWORK 并要求本轮纠正。lead 必须等本轮 PASS 后再提下一轮，不可一次发完。第三轮 PASS 后 lead 只发送 [GOAL:DONE]，不提及任何人；reviewer 不再回复终态。整个过程中无需Human继续催促。不使用线程，全部发在当前频道。";
test(
  `opt-in dialogue ${SCENARIO} reaches goal without Human nudges`,
  { skip: !ENABLED, timeout: GATE_TIMEOUT_MS + 60_000 },
  async () => {
    const startedAt = Date.now();
    const gateDeadline = startedAt + GATE_TIMEOUT_MS;
    const directory = mkdtempSync(join(tmpdir(), "rah-real-split-chain-"));
    console.log(`RAH_REAL_DIALOGUE_STATE ${directory} scenario=${SCENARIO}`);
    const stateDirectory = join(directory, "state");
    const workspaceDirectory = join(directory, "workspace");
    mkdirSync(workspaceDirectory, { mode: 0o700 });
    if (SCENARIO !== "rounds")
      writeFileSync(join(workspaceDirectory, "repair-result.txt"), "SUM=5\n");
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
      const reviewer = participantIdByHandle.get("reviewer")!;
      const before = await syncRoom(
        origin,
        prepared.humanAccessToken,
        roomId,
        "dialogue-human",
      );
      await postJson(
        origin,
        prepared.humanAccessToken,
        "/v3/client/messages/post",
        {
          basedOnRoomSeq: before.latestRoomSeq,
          body: SCENARIO === "rounds" ? HUMAN_REQUEST : REWORK_REQUEST,
          idempotencyKey: "dialogue-start",
          // The same Human text names both Agents. Match the official Web
          // composer instead of suppressing the second initial activation.
          recipients: [lead, reviewer].map((participantId) => ({
            participantId,
            reason: "mention",
          })),
          roomId,
        },
      );
      const messages = () =>
        activeObserver.listMessages(humanActor, { roomId }).messages;
      let busyEvidence: unknown;
      if (SCENARIO === "rework-busy") {
        await waitUntil(
          () => existsSync(join(workspaceDirectory, ".repair-active")),
          GATE_TIMEOUT_MS,
        );
        const active = activeObserver
          .listActivations({ roomId })
          .filter((a) => a.participantId === lead && a.state === "leased");
        assert.ok(
          active.length,
          "append lands while repair execution is leased",
        );
        const delivery = await syncRoom(
          origin,
          prepared.humanAccessToken,
          roomId,
          "busy-human",
        );
        const receipt = await postJson(
          origin,
          prepared.humanAccessToken,
          "/v3/client/messages/post",
          {
            basedOnRoomSeq: delivery.latestRoomSeq,
            body: "@lead 忙时追加：另请确认你已收到验收备注，独立发一条 [NOTE:ACK]。这不取消正在进行的修复和再审，原流程仍要完成。",
            idempotencyKey: "dialogue-busy",
            recipients: [{ participantId: lead, reason: "mention" }],
            roomId,
          },
        );
        busyEvidence = { active: active.map((a) => a.activationId), receipt };
      }
      const done = () =>
        messages().some(
          (m) => m.actorId === lead && m.body.includes("[GOAL:DONE]"),
        );
      const idle = () =>
        activeObserver
          .listActivations({ roomId })
          .every((a) => !["queued", "leased"].includes(a.state));
      await waitForOutcome({
        deadline: gateDeadline,
        label: "three rounds and goal",
        succeeded: done,
        stalled: idle,
        diagnose: () =>
          JSON.stringify({
            messages: messages(),
            activations: activeObserver.listActivations({ roomId }),
          }),
      });
      await waitUntil(idle, 60_000);
      const rows = messages();
      if (SCENARIO === "rounds")
        for (let n = 1; n <= 3; n++) {
          const proposals = rows.filter(
            (m) => m.actorId === lead && m.body.includes(`[PROPOSE:${n}]`),
          );
          const reviews = rows.filter(
            (m) => m.actorId === reviewer && m.body.includes(`[REVIEW:${n}]`),
          );
          assert.equal(proposals.length, 1, `proposal ${n} exactly once`);
          assert.equal(reviews.length, 1, `review ${n} exactly once`);
          assert.match(reviews[0]!.body, /PASS/);
          assert.match(
            proposals[0]!.body,
            new RegExp(`SUM\\s*=\\s*${(n * (n + 1)) / 2}(?![0-9])`),
          );
          assert.equal(proposals[0]!.threadId, undefined);
        }
      const events = roomEvents(activeObserver, humanActor, roomId).filter(
        (e) => e.type === "message.posted",
      );
      const seq = (marker: string, actor: string) =>
        events.find(
          (e) => e.actorId === actor && String(e.payload.body).includes(marker),
        )?.roomSeq;
      let previous = 0;
      const expected: [string, string][] =
        SCENARIO === "rounds"
          ? [1, 2, 3].flatMap(
              (n) =>
                [
                  [`[PROPOSE:${n}]`, lead],
                  [`[REVIEW:${n}]`, reviewer],
                ] as [string, string][],
            )
          : [
              ["[AUDIT:REWORK]", reviewer],
              ["[REPAIR:DONE]", lead],
              ["[AUDIT:PASS]", reviewer],
            ];
      for (const [marker, actor] of expected) {
        const matching = rows.filter(
          (m) => m.actorId === actor && m.body.includes(marker),
        );
        assert.equal(matching.length, 1, `${marker} exactly once`);
        const current = seq(marker, actor);
        assert.ok(current && current > previous, `causal order ${marker}`);
        previous = current;
      }
      if (SCENARIO !== "rounds") {
        assert.match(
          rows.find(
            (m) => m.actorId === reviewer && m.body.includes("[AUDIT:REWORK]"),
          )!.body,
          OBSERVED_WRONG_VALUE,
        );
        assert.equal(
          readFileSync(
            join(workspaceDirectory, "repair-result.txt"),
            "utf8",
          ).trim(),
          "SUM=6",
        );
      }
      if (SCENARIO === "rework-busy")
        assert.equal(
          rows.filter(
            (m) => m.actorId === lead && m.body.includes("[NOTE:ACK]"),
          ).length,
          1,
          "append acknowledged independently exactly once",
        );
      const terminal = seq("[GOAL:DONE]", lead);
      assert.ok(terminal && terminal > previous);
      const count = rows.length;
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      assert.equal(
        messages().length,
        count,
        "no continuing conversation after goal",
      );
      assert.ok(idle(), "no active delivery after goal");
      console.log(
        "RAH_DIALOGUE_RESULT " +
          JSON.stringify({
            roomId,
            messages: messages(),
            scenario: SCENARIO,
            busyEvidence,
            rounds: SCENARIO === "rounds" ? 3 : undefined,
            humanNudges: 0,
          }),
      );
    } finally {
      shutdown.abort("dialogue-finished");
      await running?.catch(() => undefined);
      observer?.close();
      console.log(`RAH_DIALOGUE_KEPT ${directory}`);
    }
  },
);
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

test("review observation accepts raw file value but rejects a wrong numeric value", () => {
  for (const body of ["OBSERVED=5", "OBSERVED=SUM=5"])
    assert.match(body, OBSERVED_WRONG_VALUE);
  for (const body of [
    "OBSERVED=6",
    "OBSERVED=SUM=6",
    "OBSERVED=50",
    "expected SUM=5",
  ])
    assert.doesNotMatch(body, OBSERVED_WRONG_VALUE);
});
