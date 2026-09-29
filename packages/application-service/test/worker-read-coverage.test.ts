import { writeWorkerReadResult } from "../../agent-host/src/worker-read-output.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { WorkerApplicationService } from "../src/index.ts";
import { drainWorkerMessages } from "../../agent-host/src/worker-message-check.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "../../kernel/test/role-instance-fixture.ts";

test("HTTP check and CLI ACK bridge precise later reads without expanding the Activation cursor", async () => {
  const f = roleInstanceFixture();
  const service = new WorkerApplicationService({ kernel: f.kernel });
  try {
    await service.start();
    const work = startInstanceRun(f);
    const credential = service.issueActivationCredential(f.host, work.scope);
    const later = f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "later request",
      idempotencyKey: "later",
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
    });
    let output = "";
    const send = async (request: { path: string; body: unknown }) => {
      const response = await fetch(service.origin + request.path, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request.body),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const request = {
      path: "/v1/worker/messages/history",
      body: { channel: "#home", limit: 100 },
    };
    const result = await send(request);
    await writeWorkerReadResult({
      request,
      result,
      jsonOutput: false,
      stdout: {
        write: (value) => {
          output += value;
        },
      },
      send,
    });
    assert.equal(
      f.db
        .prepare(
          "SELECT delivered FROM worker_run_read_receipts WHERE room_seq=? AND room_id=?",
        )
        .get(later.event.roomSeq, f.home.roomId)?.delivered,
      1,
    );
    await drainWorkerMessages({
      replay: false,
      write: async (value) => {
        output += value;
      },
      send,
    });
    assert.ok(output.length > 0);
    assert.equal(
      f.db
        .prepare(
          "SELECT confirmed FROM worker_run_read_receipts WHERE room_seq=? AND room_id=?",
        )
        .get(later.event.roomSeq, f.home.roomId)?.confirmed,
      1,
    );
    assert.equal(
      f.db
        .prepare("SELECT to_seq FROM activations WHERE activation_id=?")
        .get(work.activation.activationId)?.to_seq,
      work.activation.toSeq,
    );
    work.finish(0);
    assert.equal(
      f.kernel.leaseNextActivation(f.host, { leaseMs: 10000 }),
      null,
    );
    assert.equal(
      f.db
        .prepare("SELECT state FROM inbox_items WHERE event_id=?")
        .get(later.event.eventId)?.state,
      "pending",
    );
  } finally {
    await service.close();
    f.close();
  }
});
