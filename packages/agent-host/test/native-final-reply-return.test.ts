import assert from "node:assert/strict";
import test from "node:test";
import { WorkerApplicationService } from "@rah-os/application-service";
import { WorkerMessagePresentResponseSchema } from "@rah-os/protocol";
import { roleInstanceFixture } from "../../kernel/test/role-instance-fixture.ts";
import { FakeRuntimeAdapter, MultiLaneAgentHost } from "../src/index.ts";
import { WorkerFinalOutput } from "../src/worker-final-output.ts";
import {
  nativeFinalEnvelope,
  nativeFinalSequence,
} from "../src/native-final-transport.ts";

test("Host publishes a plain peer final and automatically resumes its requester exactly once", async () => {
  const f = roleInstanceFixture();
  const peer = f.kernel.roles.instantiate(f.actor, {
    roleId: f.role.roleId,
    channelId: f.home.roomId,
    basedOnRoomSeq: f.head(f.home.roomId),
    idempotencyKey: "peer",
  }).instance;
  const handle = (id: string) =>
    String(
      f.db
        .prepare("SELECT handle FROM principals WHERE principal_id=?")
        .get(id)!.handle,
    );
  const worker = new WorkerApplicationService({ kernel: f.kernel });
  await worker.start();
  const replies = new Map<
    string,
    () => Promise<Awaited<ReturnType<WorkerFinalOutput["submit"]>>>
  >();
  const revoke: (() => void)[] = [];
  const seen: string[] = [];
  const runtime: FakeRuntimeAdapter = new FakeRuntimeAdapter({
    async onStart(input) {
      assert.ok(
        seen.length < 3,
        "automatic return must not create a reply loop",
      );
      seen.push(input.participantId);
      const credential = worker.issueActivationCredential(f.host, input);
      revoke.push(credential.revoke);
      const response = await fetch(
        `${worker.origin}/v1/worker/message-present`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${credential.accessToken}`,
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      assert.ok(response.ok);
      const delivery = WorkerMessagePresentResponseSchema.parse(
        await response.json(),
      );
      f.kernel.markPresentedDeliverySent(f.host, {
        activationId: input.activationId,
        consumerId: input.consumerId,
        runAttemptId: input.runAttemptId,
      });
      if (seen.length === 3)
        assert.match(JSON.stringify(delivery.events), /FAKE design approved/);
      const body =
        seen.length === 1
          ? `@${handle(peer.instanceId)} FAKE review request`
          : seen.length === 2
            ? "FAKE design approved, continue."
            : "FAKE implementation complete.";
      const output = new WorkerFinalOutput({
        origin: worker.origin,
        accessToken: credential.accessToken,
        isActive: () => true,
      });
      const envelope = nativeFinalEnvelope(body, nativeFinalSequence(delivery));
      replies.set(input.runAttemptId, () => output.submit(envelope));
    },
    async onReap(run) {
      const input =
        runtime.starts[Number(run.runId.replace("fake-run-", "")) - 1]!;
      return { code: 0, finalOutput: await replies.get(input.runAttemptId)!() };
    },
  });
  const host = new MultiLaneAgentHost({
    host: f.host,
    kernel: f.kernel,
    runtime,
    placementRuntimeResolver: () => runtime,
    capacity: 2,
    leaseMs: 30000,
    leaseRenewIntervalMs: 20,
    pollIntervalMs: 5,
    runtimeStartScheduler: { maxConcurrentStarts: 2, minStartIntervalMs: 0 },
  });
  const abort = new AbortController();
  let running: Promise<void> | undefined, error: unknown;
  try {
    f.kernel.postRoomMessage(f.actor, {
      roomId: f.home.roomId,
      body: `@${handle(f.instance.instanceId)} FAKE start`,
      idempotencyKey: "start",
    });
    running = host.run({ signal: abort.signal });
    void running.catch((e) => {
      error = e;
    });
    const until = Date.now() + 5000;
    while (
      f.kernel
        .listActivations({ roomId: f.home.roomId })
        .filter((a) => a.state === "completed").length < 3
    ) {
      if (error) throw error;
      assert.ok(
        Date.now() < until,
        "three-turn automatic return did not complete",
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.deepEqual(seen, [
      f.instance.instanceId,
      peer.instanceId,
      f.instance.instanceId,
    ]);
    assert.deepEqual(
      f.kernel.listActivations({ roomId: f.home.roomId }).map((a) => a.state),
      ["completed", "completed", "completed"],
    );
  } finally {
    abort.abort();
    await running;
    for (const fn of revoke) fn();
    await worker.close();
    f.close();
  }
});
