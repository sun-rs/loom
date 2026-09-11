import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RoomKernel } from "@rah-os/kernel";
import { AgentHost, FakeRuntimeAdapter } from "../src/index.ts";
import type { RuntimeBusyNotice, RunHandle } from "../src/runtime.ts";

for (const guideEnabled of [false, true])
  test(`Host preserves follow-up with Guide ${guideEnabled ? "enabled" : "disabled"}`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-host-busy-"));
    const kernel = new RoomKernel({ databasePath: join(directory, "db") });
    kernel.initialize();
    const human = kernel.provisionPrincipal({ kind: "human", handle: "human" });
    const agent = kernel.provisionPrincipal({ kind: "agent", handle: "agent" });
    const actor = kernel.authenticateAccessToken(human.accessToken);
    const reader = kernel.authenticateAccessToken(agent.accessToken);
    const room = kernel.createRoom(actor, { name: "Busy test", slug: "busy" });
    kernel.addMember(actor, {
      roomId: room.roomId,
      principalId: agent.principal.principalId,
    });
    const post = (key: string) =>
      kernel.postMessage(actor, {
        roomId: room.roomId,
        body: key,
        idempotencyKey: key,
        recipients: [
          { participantId: agent.principal.principalId, reason: "mention" },
        ],
      });
    post("original");
    const credential = kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [agent.principal.principalId],
    });
    const identity = kernel.authenticateHostAccessToken(credential.accessToken);
    kernel.heartbeatHost(identity);
    let finish!: (exit: { code: number }) => void;
    const end = new Promise<{ code: number }>((resolve) => {
      finish = resolve;
    });
    let notices = 0;
    let starts = 0;
    class BusyFake extends FakeRuntimeAdapter {
      readonly busyInputSupported = true;
      readonly busyInputMode = "direct" as const;
      async notifyBusy(_run: RunHandle, notice: RuntimeBusyNotice) {
        notices++;
        assert.match(notice.text, /#busy/u);
        assert.equal(kernel.listRunAttempts({ roomId: room.roomId }).length, 1);
        assert.ok(
          kernel
            .listActivations({ roomId: room.roomId })
            .some((a) => a.state === "queued"),
        );
        finish({ code: 0 });
        return true;
      }
    }
    const runtime = new BusyFake({
      onStart(input) {
        starts++;
        const delivered = kernel.sync(reader, {
          roomId: room.roomId,
          consumerId: input.consumerId,
        });
        kernel.acknowledgeCursor(reader, {
          roomId: room.roomId,
          consumerId: input.consumerId,
          throughSeq: delivered.cursorAfter,
        });
        if (starts === 1) {
          post("append");
          post("append two");
          post("append three");
        }
        if (!guideEnabled) finish({ code: 0 });
      },
      onReap: () => end,
    });
    const host = new AgentHost({
      guideEnabled: () => guideEnabled,
      kernel,
      host: identity,
      leaseMs: 30000,
      runtime,
      runTimeoutMs: 2500,
    });
    try {
      const result = await host.reconcileOnce();
      assert.equal(
        notices,
        guideEnabled ? 1 : 0,
        "only opted-in Guide may inject into the current run",
      );
      assert.equal(result.state, "completed");
      assert.ok(
        kernel
          .listActivations({ roomId: room.roomId })
          .some((a) => a.state === "queued"),
        "transport acceptance must not consume durable follow-up",
      );
      const next = await host.reconcileOnce();
      assert.equal(
        next.state,
        "completed",
        "queued messages run after the first execution exits",
      );
      assert.equal(starts, 2);
      assert.equal(
        kernel
          .listActivations({ roomId: room.roomId })
          .filter((a) => a.state === "queued").length,
        0,
      );
    } finally {
      finish({ code: 0 });
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
