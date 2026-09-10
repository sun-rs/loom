import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";

import {
  AgentHost,
  AgentStartGate,
  createKernelAgentHostControlPort,
  FakeRuntimeAdapter,
} from "../src/index.ts";

/**
 * The start gate makes a lane wait for a slot before `runtime.start`. That wait
 * sits before run supervision begins, so nothing renews the activation lease
 * while a lane is queued. This asserts the host takes a fresh renewal after the
 * slot is granted, so the un-renewed window stays the bounded start itself.
 */
test("the activation lease is renewed after the start gate grants a slot, not only before queuing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-start-gate-lease-"));
  try {
    const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "gate-lease-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "gate-lease-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(humanActor, {
      name: "Start gate lease window",
      slug: "start-gate-lease-window",
    });
    kernel.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "Wake the Agent behind an occupied start gate",
      idempotencyKey: "gate-lease-message",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      roomId: room.roomId,
    });

    const credential = kernel.provisionHostCredential({
      hostId: "gate-lease-host",
      participantIds: [agent.principal.principalId],
    });
    const hostContext = kernel.authenticateHostAccessToken(
      credential.accessToken,
    );
    kernel.heartbeatHost(hostContext);

    // Every event in one ordered log, so the assertion is about ordering rather
    // than about a count that a second renewal elsewhere could satisfy.
    const events: string[] = [];
    const kernelControl = createKernelAgentHostControlPort(kernel, hostContext);
    const control = {
      ...kernelControl,
      renewActivationLease: async (
        input: Parameters<typeof kernelControl.renewActivationLease>[0],
      ) => {
        events.push("renew");
        return kernelControl.renewActivationLease(input);
      },
    };

    // One start slot, already held, so the Agent's lane must queue.
    const gate = new AgentStartGate({
      maxConcurrentStarts: 1,
      minStartIntervalMs: 0,
    });
    let releaseOccupant = (): void => {};
    const occupantReleased = new Promise<void>((resolve) => {
      releaseOccupant = resolve;
    });
    const occupant = gate.runStart("occupying-agent", async () => {
      await occupantReleased;
    });

    const agentActor = kernel.authenticateAccessToken(agent.accessToken);
    const runtime = new FakeRuntimeAdapter({
      onStart: (input) => {
        events.push("runtime.start");
        const delivery = kernel.sync(agentActor, {
          consumerId: input.consumerId,
          roomId: input.roomId,
        });
        kernel.acknowledgeCursor(agentActor, {
          consumerId: input.consumerId,
          roomId: input.roomId,
          throughSeq: delivery.cursorAfter,
        });
      },
    });
    const host = new AgentHost({
      control,
      host: hostContext,
      leaseMs: 30_000,
      runtime,
      startGate: gate,
    });

    const cycle = host.reconcileOnce();
    // Let the lane reach the gate and block there before the slot is freed.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      events.includes("runtime.start"),
      false,
      `the lane must be parked in the start queue with no runtime started yet; saw ${JSON.stringify(events)}`,
    );
    events.push("slot-released");
    releaseOccupant();
    await occupant;

    const result = await cycle;
    assert.equal(result.state, "completed");

    const startIndex = events.indexOf("runtime.start");
    const releaseIndex = events.indexOf("slot-released");
    assert.ok(startIndex > releaseIndex, "the runtime started after the wait");
    const renewalsWhileHoldingSlot = events
      .slice(releaseIndex, startIndex)
      .filter((event) => event === "renew").length;
    assert.equal(
      renewalsWhileHoldingSlot,
      1,
      `the host must renew the lease after the gate grants the slot and before the runtime starts; saw ${JSON.stringify(events)}`,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
