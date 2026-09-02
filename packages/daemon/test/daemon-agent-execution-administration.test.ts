import assert from "node:assert/strict";
import test from "node:test";

import {
  StaleContextError,
  type AuthenticatedActorContext,
  type HumanApplicationPort,
} from "@rah-os/kernel";
import type {
  ClientAgentExecutionResetResponse,
  ClientAgentManageResponse,
} from "@rah-os/protocol";

import { createDaemonAgentExecutionAdministration } from "../src/daemon-application-support.ts";

const actor = {} as AuthenticatedActorContext;

test("daemon reset disables, waits for Host effect, enables inside the fence, and returns terminal evidence", async () => {
  const calls: string[] = [];
  const human = fakeHuman(calls);
  const administration = createDaemonAgentExecutionAdministration({
    coordinator: {
      receipt: async () => null,
      reset: async (input, hooks) => {
        calls.push(`host:${input.mode}:${input.ownerParticipantId}`);
        await hooks?.afterContinuity?.();
        calls.push("host:receipt");
        return receipt({
          agentDefinitionId: input.agentDefinitionId,
          mode: input.mode,
          operationId: input.operationId,
          ownerParticipantId: input.ownerParticipantId,
        });
      },
    },
    human,
  });

  const result = await administration.reset(actor, {
    agentDefinitionId: "definition-1",
    basedOnRoomSeq: 11,
    idempotencyKey: "reset-1",
    mode: "session",
  });

  assert.deepEqual(calls, [
    "manage:disabled:11:reset-1:execution-reset:disable",
    "host:session:participant-1",
    "manage:enabled:12:reset-1:execution-reset:enable",
    "host:receipt",
  ]);
  assert.equal(result.mode, "session");
  assert.match(result.operationId, /^agent_execution_reset_[a-f0-9]{64}$/u);
});

test("daemon reset restores scheduling if the Host effect fails", async () => {
  const calls: string[] = [];
  const administration = createDaemonAgentExecutionAdministration({
    coordinator: {
      receipt: async () => null,
      reset: async () => {
        calls.push("host:failed");
        throw new Error("terminal proof failed");
      },
    },
    human: fakeHuman(calls),
  });

  await assert.rejects(
    async () =>
      await administration.reset(actor, {
        agentDefinitionId: "definition-1",
        basedOnRoomSeq: 20,
        idempotencyKey: "reset-2",
        mode: "restart",
      }),
    /terminal proof failed/u,
  );
  assert.deepEqual(calls, [
    "manage:disabled:20:reset-2:execution-reset:disable",
    "host:failed",
    "manage:enabled:12:reset-2:execution-reset:restore",
  ]);
});

test("daemon reset retries stale Room sequence and replays a receipt without a second state mutation", async () => {
  const calls: string[] = [];
  let stale = true;
  const human = fakeHuman(calls, () => {
    if (!stale) return;
    stale = false;
    throw new StaleContextError(3, 8);
  });
  let replay: ClientAgentExecutionResetResponse | null = null;
  const administration = createDaemonAgentExecutionAdministration({
    coordinator: {
      receipt: async () => replay,
      reset: async (input, hooks) => {
        if (replay !== null) return { ...replay, deduplicated: true };
        await hooks?.afterContinuity?.();
        replay = receipt(input);
        return replay;
      },
    },
    human,
  });
  const request = {
    agentDefinitionId: "definition-1",
    basedOnRoomSeq: 3,
    idempotencyKey: "reset-3",
    mode: "restart" as const,
  };

  await administration.reset(actor, request);
  const stateCallCount = calls.length;
  const second = await administration.reset(actor, request);

  assert.equal(calls[0], "manage:disabled:3:reset-3:execution-reset:disable");
  assert.equal(calls[1], "manage:disabled:8:reset-3:execution-reset:disable");
  assert.equal(calls.length, stateCallCount);
  assert.equal(second.deduplicated, true);
});

function fakeHuman(
  calls: string[],
  beforeManage: () => void = () => undefined,
): HumanApplicationPort {
  const manageWorkspaceAgent: HumanApplicationPort["manageWorkspaceAgent"] = (
    _actor,
    input,
  ) => {
    assert.equal(input.action, "set_state");
    if (input.action !== "set_state") throw new Error("unexpected action");
    calls.push(
      `manage:${input.state}:${input.basedOnRoomSeq}:${input.idempotencyKey}`,
    );
    beforeManage();
    return {
      event: { roomSeq: input.state === "disabled" ? 12 : 13 },
    } as ClientAgentManageResponse;
  };
  return {
    getWorkspaceAgentManagementView: () =>
      ({
        agent: {
          definition: { participantId: "participant-1" },
        },
      }) as never,
    manageWorkspaceAgent,
  } as unknown as HumanApplicationPort;
}

function receipt(
  input: Readonly<{
    agentDefinitionId: string;
    mode: "restart" | "session";
    operationId: string;
    ownerParticipantId: string;
  }>,
): ClientAgentExecutionResetResponse {
  return {
    agentDefinitionId: input.agentDefinitionId,
    completedAt: "2026-09-01T02:00:00.000Z",
    computerHostId: "host-local",
    deduplicated: false,
    mode: input.mode,
    operationId: input.operationId,
    ownerParticipantId: input.ownerParticipantId,
    providerContinuityRecords: input.mode === "session" ? 1 : 0,
  };
}
