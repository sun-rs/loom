import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkerApplicationService } from "../../application-service/src/index.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "../../kernel/test/role-instance-fixture.ts";
import { createWorkerMcpBridge } from "../src/worker-mcp-bridge.ts";

type McpResult = {
  content: { type: string; text: string }[];
  isError: boolean;
};
const params = (turn: string, callId: string, body: string, extra = {}) => ({
  name: "loom_reply",
  arguments: { body, final: true, ...extra },
  _meta: {
    "x-codex-turn-metadata": {
      turn_id: turn,
      thread_id: "native-thread",
      session_id: "native-thread",
    },
    threadId: "native-thread",
    sessionId: "native-thread",
    callId,
  },
});
const call = (socketPath: string, secret: string, body: unknown) =>
  new Promise<McpResult>((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path: "/call",
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
      },
      (res) => {
        let output = "";
        res.setEncoding("utf8");
        res.on("data", (part) => {
          output += part;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(output));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });

test("internal MCP publishes once as the credential actor and never rebinds a revoked native turn", async () => {
  const f = roleInstanceFixture();
  const service = new WorkerApplicationService({ kernel: f.kernel });
  const directory = mkdtempSync(join(tmpdir(), "loom-mcp-application-"));
  const socketPath = join(directory, "worker.sock");
  let bridge: Awaited<ReturnType<typeof createWorkerMcpBridge>> | undefined;
  try {
    await service.start();
    bridge = await createWorkerMcpBridge({
      socketPath,
      workerApiOrigin: service.origin,
    });
    const invoke = (value: unknown) =>
      call(socketPath, bridge!.env.LOOM_WORKER_MCP_SECRET!, value);
    const bind = async (turn: string) => {
      const work = startInstanceRun(f);
      f.kernel.presentWorkerMessages(work.execution);
      f.kernel.markPresentedDeliverySent(f.host, {
        activationId: work.activation.activationId,
        consumerId: "worker",
        runAttemptId: work.run.runAttemptId,
      });
      const credential = service.issueActivationCredential(f.host, work.scope);
      const presentation = await fetch(
        `${service.origin}/v1/worker/message-present`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${credential.accessToken}`,
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      assert.equal(presentation.status, 200);
      await presentation.json();

      let active = true;
      const unbind = bridge!.bind({
        runAttemptId: work.run.runAttemptId,
        threadId: "native-thread",
        admission: Promise.resolve({
          kind: "accepted" as const,
          nativeTurnId: turn,
        }),
        accessToken: credential.accessToken,
        isActive: () => active,
      });
      return {
        work,
        revoke: () => {
          active = false;
          unbind();
        },
      };
    };
    const first = await bind("native-turn-1");
    const original = params(
      "native-turn-1",
      "native-call-1",
      "FAKE MCP integration reply one",
      { basedOnRoomSeq: first.work.scope.toSeq },
    );
    const result = await invoke(original);
    assert.equal(result.isError, false, JSON.stringify(result));
    const receipt = JSON.parse(result.content[0]!.text);
    assert.equal(receipt.state, "published");
    assert.equal(receipt.actorId, f.instance.instanceId);
    assert.equal("body" in receipt, false);
    assert.equal("event" in receipt, false);
    assert.deepEqual(
      await invoke(original),
      result,
      "same native call receives original receipt",
    );
    assert.equal(
      f.db
        .prepare("SELECT count(*) AS count FROM messages WHERE body=?")
        .get(original.arguments.body)?.count,
      1,
    );
    const forged = await invoke(
      params("native-turn-1", "forged-actor", "must not publish", {
        participantId: f.owner.principal.principalId,
      }),
    );
    assert.equal(forged.isError, true);
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) AS count FROM messages WHERE body='must not publish'",
        )
        .get()?.count,
      0,
    );
    first.revoke();
    first.work.finish(0);
    const second = await bind("native-turn-2");
    const oldCall = await invoke(
      params(
        "native-turn-1",
        "late-old-call",
        "revoked old turn must not publish",
      ),
    );
    assert.equal(
      oldCall.isError,
      true,
      "an old native turn cannot borrow the new Run's credential",
    );
    const next = await invoke(
      params(
        "native-turn-2",
        "native-call-2",
        "FAKE MCP integration reply two",
        { basedOnRoomSeq: second.work.scope.toSeq },
      ),
    );
    assert.equal(next.isError, false, JSON.stringify(next));
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) AS count FROM messages WHERE body='revoked old turn must not publish'",
        )
        .get()?.count,
      0,
    );
    const rows = f.db
      .prepare(
        "SELECT actor_id, room_id FROM messages WHERE body LIKE 'FAKE MCP integration reply %'",
      )
      .all();
    assert.equal(rows.length, 2);
    assert.ok(
      rows.every(
        (row) =>
          row.actor_id === f.instance.instanceId &&
          row.room_id === f.home.roomId,
      ),
    );
    second.revoke();
    second.work.finish(0);
  } finally {
    await bridge?.close();
    await service.close();
    f.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("MCP final without explicit seq has no write or ACK; corrected new call commits once", async () => {
  const f = roleInstanceFixture();
  const service = new WorkerApplicationService({ kernel: f.kernel });
  const directory = mkdtempSync(join(tmpdir(), "loom-mcp-final-seq-"));
  const socketPath = join(directory, "worker.sock");
  const hints: string[] = [];
  const unsubscribe = f.kernel.finalReplies.subscribe((id) => hints.push(id));
  let bridge: Awaited<ReturnType<typeof createWorkerMcpBridge>> | undefined;
  try {
    await service.start();
    bridge = await createWorkerMcpBridge({
      socketPath,
      workerApiOrigin: service.origin,
    });
    const work = startInstanceRun(f);
    f.kernel.presentWorkerMessages(work.execution);
    f.kernel.markPresentedDeliverySent(f.host, {
      activationId: work.activation.activationId,
      consumerId: "worker",
      runAttemptId: work.run.runAttemptId,
    });
    const credential = service.issueActivationCredential(f.host, work.scope);
    const presentation = await fetch(
      `${service.origin}/v1/worker/message-present`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal(presentation.status, 200);
    await presentation.json();

    bridge.bind({
      runAttemptId: work.run.runAttemptId,
      threadId: "native-thread",
      admission: Promise.resolve({
        kind: "accepted",
        nativeTurnId: "seq-turn",
      }),
      accessToken: credential.accessToken,
      isActive: () => true,
    });
    const invoke = (value: unknown) =>
      call(socketPath, bridge!.env.LOOM_WORKER_MCP_SECRET!, value);
    const snapshot = () => ({
      head: f.head(f.home.roomId),
      markers: f.db
        .prepare("SELECT count(*) AS n FROM run_attempt_final_replies")
        .get()!.n,
      cursor: f.db
        .prepare(
          "SELECT last_seq FROM subscription_cursors WHERE room_id=? AND participant_id=? AND consumer_id='worker'",
        )
        .get(f.home.roomId, f.instance.instanceId)?.last_seq,
      replies: f.db
        .prepare("SELECT count(*) AS n FROM messages WHERE actor_id=?")
        .get(f.instance.instanceId)!.n,
    });
    const before = snapshot();
    assert.equal(
      before.cursor,
      undefined,
      "presented transport does not itself ACK delivery",
    );
    const missing = params(
      "seq-turn",
      "missing-seq",
      "FAKE final requiring explicit causal seq",
    );
    const denied = await invoke(missing);
    assert.equal(denied.isError, true, JSON.stringify(denied));
    assert.doesNotMatch(denied.content[0]!.text, /RESULT_UNKNOWN/);
    assert.equal(
      JSON.parse(denied.content[0]!.text).error.code,
      "final_delivery_unconfirmed",
    );
    assert.match(
      denied.content[0]!.text,
      /basedOnRoomSeq|based-on-room-seq|acknowledg|causal/i,
    );
    assert.deepEqual(
      snapshot(),
      before,
      "no Room event, message, final marker or ACK before confirmed context",
    );
    assert.deepEqual(hints, [], "no final hint may escape a refused write");
    const valid = params("seq-turn", "corrected-seq", missing.arguments.body, {
      basedOnRoomSeq: work.scope.toSeq,
    });
    const posted = await invoke(valid);
    assert.equal(posted.isError, false, JSON.stringify(posted));
    assert.equal(JSON.parse(posted.content[0]!.text).state, "published");
    const after = snapshot();
    assert.equal(after.replies, Number(before.replies) + 1);
    assert.equal(after.markers, Number(before.markers) + 1);
    assert.equal(after.cursor, work.scope.toSeq);
    assert.deepEqual(hints, [work.run.runAttemptId]);
    assert.deepEqual(
      await invoke(missing),
      denied,
      "failed native call retains its no-write error, not a new dispatch",
    );
    assert.deepEqual(
      await invoke(valid),
      posted,
      "successful native call returns its original receipt",
    );
    assert.deepEqual(
      snapshot(),
      after,
      "both cached retries produce no extra events or messages",
    );
    assert.deepEqual(hints, [work.run.runAttemptId]);
    // Do not use work.finish: that fixture would explicitly ACK and mask the bug.
    f.kernel.recordRuntimeTermination(f.host, {
      runAttemptId: work.run.runAttemptId,
      runtimeRunId: work.runtime.runtimeRunId,
      exit: { code: 0 },
    });
    f.kernel.finishRunAttempt(f.host, {
      runAttemptId: work.run.runAttemptId,
      state: "exited",
      exitCode: 0,
    });
    f.kernel.completeActivation(f.host, {
      activationId: work.activation.activationId,
      consumerId: "worker",
    });
    assert.equal(
      f.kernel
        .listActivations({ roomId: f.home.roomId })
        .find((a) => a.activationId === work.activation.activationId)?.state,
      "completed",
    );
  } finally {
    unsubscribe();
    await bridge?.close();
    await service.close();
    f.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
