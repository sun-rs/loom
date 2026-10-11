import assert from "node:assert/strict";
import test from "node:test";
import {
  ClientApplicationService,
  WorkerApplicationService,
} from "@rah-os/application-service";
import { WorkerMessagePresentResponseSchema } from "@rah-os/protocol";
import { HttpRahClient } from "@rah-os/client-sdk";
import { RoomKernel, createHumanApplicationPort } from "@rah-os/kernel";
import { roleInstanceFixture } from "../../kernel/test/role-instance-fixture.ts";
import {
  FakeRuntimeAdapter,
  MultiLaneAgentHost,
  type ActivationEnvelope,
} from "../src/index.ts";
import {
  nativeFinalEnvelope,
  nativeFinalSequence,
} from "../src/native-final-transport.ts";
import { WorkerFinalOutput } from "../src/worker-final-output.ts";

// Synthetic native text only: real Role/Kernel/MultiLaneAgentHost/Worker HTTP.
// This does not exercise a provider parser, real CLI, or model cooperation.
test("native-final peers run independently, hold stale peer replies, and hand off exact text with delta after Human recovery", async () => {
  const f = roleInstanceFixture();
  const kernel = new RoomKernel({
    databasePath: String(f.db.prepare("PRAGMA database_list").get()!.file),
    placementCapacityPolicy: { defaultMaxConcurrent: 2 },
  });
  kernel.initialize();
  f.kernel = kernel;
  const b = kernel.roles.instantiate(f.actor, {
    roleId: f.role.roleId,
    channelId: f.home.roomId,
    basedOnRoomSeq: f.head(f.home.roomId),
    idempotencyKey: "peer-b",
  });
  const ids = [f.instance.instanceId, b.instance.instanceId];
  const handles = ids.map((id) =>
    String(
      f.db
        .prepare("SELECT handle FROM principals WHERE principal_id=?")
        .get(id)!.handle,
    ),
  );
  const worker = new WorkerApplicationService({ kernel });
  const human = new ClientApplicationService({
    human: createHumanApplicationPort(kernel),
    health: () => {
      throw Error("unused");
    },
  });
  await worker.start();
  await human.start();
  const client = new HttpRahClient({
    baseUrl: human.origin,
    accessToken: () => f.owner.accessToken,
  });
  const handoff = `@${handles[1]} FAKE exact native handoff: verify the shared finding`;
  const presentations = new Map<string, string[]>();
  const submissions = new Map<string, WorkerFinalOutput>();
  const envelopes = new Map<string, string>();
  const credentials: Array<{ revoke(): void }> = [];
  const texts = [
    "FAKE obsolete A answer",
    "FAKE B independent answer",
    handoff,
    "FAKE B verified handoff",
    "FAKE B next answer",
  ];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime: FakeRuntimeAdapter = new FakeRuntimeAdapter({
    async onStart(input: ActivationEnvelope) {
      const ordinal =
        runtime.starts.filter((x) => x.participantId === input.participantId)
          .length - 1;
      const text =
        input.participantId === ids[0]
          ? texts[ordinal === 0 ? 0 : 2]
          : texts[ordinal === 0 ? 1 : ordinal === 1 ? 3 : 4];
      const issued = worker.issueActivationCredential(f.host, input);
      credentials.push(issued);
      const response = await fetch(
        `${worker.origin}/v1/worker/message-present`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${issued.accessToken}`,
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      assert.ok(response.ok);
      const presented = WorkerMessagePresentResponseSchema.parse(
        await response.json(),
      );
      presentations.set(
        input.runAttemptId,
        presented.events
          .filter((e) => e.type === "message.posted")
          .map((e) => String(e.payload.body)),
      );
      kernel.markPresentedDeliverySent(f.host, {
        activationId: input.activationId,
        consumerId: input.consumerId,
        runAttemptId: input.runAttemptId,
      });
      submissions.set(
        input.runAttemptId,
        new WorkerFinalOutput({
          origin: worker.origin,
          accessToken: issued.accessToken,
          isActive: () => true,
        }),
      );
      envelopes.set(
        input.runAttemptId,
        nativeFinalEnvelope(text, nativeFinalSequence(presented)),
      );
    },
    async onReap(run) {
      const input =
        runtime.starts[Number(run.runId.replace("fake-run-", "")) - 1]!;
      if (
        input.participantId === ids[0] &&
        runtime.starts.filter((x) => x.participantId === ids[0])[0] === input
      )
        await blocked;
      const submission = submissions.get(input.runAttemptId)!;
      const envelope = envelopes.get(input.runAttemptId)!;
      const finalOutput = await submission.submit(envelope);
      assert.deepEqual(
        await submission.submit(envelope),
        finalOutput,
        "same transport submission never resends",
      );
      return { code: 0, finalOutput };
    },
  });
  const host = new MultiLaneAgentHost({
    capacity: 2,
    host: f.host,
    kernel,
    runtime,
    placementRuntimeResolver: () => runtime,
    leaseMs: 30_000,
    leaseRenewIntervalMs: 20,
    pollIntervalMs: 5,
    retryAfterMs: 0,
    runtimeStartScheduler: { maxConcurrentStarts: 2, minStartIntervalMs: 0 },
  });
  const control = new AbortController();
  let running: Promise<void> | undefined;
  let runError: unknown;
  const waitFor = async (predicate: () => boolean) => {
    const until = Date.now() + 5000;
    while (!predicate()) {
      if (runError) throw runError;
      assert.ok(
        Date.now() < until,
        JSON.stringify(kernel.listActivations({ roomId: f.home.roomId })),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const post = (index: number, body: string, key: string) =>
    kernel.postRoomMessage(f.actor, {
      roomId: f.home.roomId,
      body: `@${handles[index]} ${body}`,
      idempotencyKey: key,
    });
  const completed = () =>
    kernel
      .listActivations({ roomId: f.home.roomId })
      .filter((a) => a.state === "completed").length;
  try {
    kernel.postRoomMessage(f.actor, {
      roomId: f.home.roomId,
      body: "@all FAKE Human opening",
      idempotencyKey: "opening",
    });
    running = host.run({ signal: control.signal });
    void running.catch((error) => {
      runError = error;
    });
    await waitFor(() => completed() === 1);
    assert.equal(runtime.starts.length, 2);
    assert.equal(
      kernel
        .listActivations({ roomId: f.home.roomId })
        .find((a) => a.participantId === ids[0])!.state,
      "leased",
    );
    assert.equal(
      f.db
        .prepare("SELECT count(*) n FROM messages WHERE actor_id=?")
        .get(ids[1]!)!.n,
      1,
    );
    assert.equal(
      runtime.starts[0]!.toSeq,
      runtime.starts[1]!.toSeq,
      "both native candidates are bound to the same opening; only B publication is newer",
    );
    assert.equal(
      f.db
        .prepare("SELECT count(*) n FROM messages WHERE actor_id=?")
        .get(f.actor.principalId)!.n,
      1,
      "no later Human fact causes this peer-only hold",
    );
    const firstA = runtime.starts.find((x) => x.participantId === ids[0])!;
    assert.deepEqual(
      presentations.get(firstA.runAttemptId),
      ["@all FAKE Human opening"],
      "A has received only the original opening, never B's later reply",
    );
    release();
    await waitFor(
      () =>
        f.db
          .prepare(
            "SELECT count(*) n FROM activation_retry_fences WHERE retry_disposition='action_required'",
          )
          .get()!.n === 1,
    );
    assert.equal(
      runtime.starts.length,
      2,
      "held output must not automatically retry or self-wake",
    );
    assert.equal(
      f.db.prepare("SELECT body FROM held_message_drafts").get()!.body,
      texts[0],
    );
    const old = runtime.starts.find((x) => x.participantId === ids[0])!;
    const failed = f.db
      .prepare("SELECT * FROM run_attempts WHERE run_attempt_id=?")
      .get(old.runAttemptId);
    await client.request("instance.activation.abandon", {
      instanceId: ids[0]!,
      activationId: old.activationId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "abandon",
    });
    assert.deepEqual(
      f.db
        .prepare("SELECT * FROM run_attempts WHERE run_attempt_id=?")
        .get(old.runAttemptId),
      failed,
    );
    post(0, "FAKE explicitly review peer facts and hand off", "recover");
    await waitFor(() => completed() === 3);
    assert.equal(runtime.starts.length, 4);
    assert.ok(
      presentations.get(runtime.starts[2]!.runAttemptId)!.includes(texts[1]!),
    );
    assert.ok(
      presentations.get(runtime.starts[3]!.runAttemptId)!.includes(handoff),
    );
    assert.equal(
      f.db
        .prepare("SELECT count(*) n FROM messages WHERE actor_id=? AND body=?")
        .get(ids[0]!, handoff)!.n,
      1,
      "the exact fake-native @ body, not a test-added recipient, wakes B",
    );
    post(1, "FAKE next B request", "next-b");
    await waitFor(() => completed() === 4);
    const last = presentations.get(runtime.starts[4]!.runAttemptId)!;
    assert.deepEqual(
      last,
      [`@${handles[1]} FAKE next B request`],
      "acknowledged opening and handoff are not repeatedly delivered",
    );
    assert.deepEqual(
      new Set(runtime.starts.slice(0, 2).map((x) => x.participantId)),
      new Set(ids),
    );
    assert.deepEqual(
      runtime.starts.slice(2).map((x) => x.participantId),
      [ids[0], ids[1], ids[1]],
    );
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM run_attempt_final_replies").get()!.n,
      4,
    );
    assert.equal(kernel.listRunAttempts({ roomId: f.home.roomId }).length, 5);
    assert.equal(
      kernel
        .listActivations({ roomId: f.home.roomId })
        .filter((a) => a.state === "queued" || a.state === "leased").length,
      0,
    );
    assert.equal(runError, undefined);
  } finally {
    release();
    control.abort();
    if (running) await running;
    for (const submission of submissions.values()) submission.close();
    for (const credential of credentials) credential.revoke();
    await human.close();
    await worker.close();
    kernel.close();
    f.close();
  }
});
