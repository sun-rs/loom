import assert from "node:assert/strict";
import test from "node:test";
import { WorkerApplicationService } from "../../application-service/src/index.ts";
import {
  roleInstanceFixture,
  startInstanceRunFromQueue,
} from "../../kernel/test/role-instance-fixture.ts";
import { WorkerMcpExecution } from "../src/worker-mcp-execution.ts";

for (const scenario of [
  "room",
  "thread",
  "private-box",
  "multiple-threads",
] as const) {
  test(`MCP target omission preserves Kernel ${scenario} routing`, async () => {
    const f = roleInstanceFixture();
    const service = new WorkerApplicationService({ kernel: f.kernel });
    let execution: WorkerMcpExecution | undefined;
    try {
      const roomId =
        scenario === "private-box" ? f.privateBox.roomId : f.home.roomId;
      let expectedThread: string | null = null;
      if (scenario === "thread" || scenario === "multiple-threads") {
        for (let i = 0; i < (scenario === "thread" ? 1 : 2); i++) {
          const root = f.kernel.postMessage(f.actor, {
            roomId,
            body: `root ${i}`,
            recipients: [],
            idempotencyKey: `root-${i}`,
          });
          const created = f.kernel.createThread(f.actor, {
            roomId,
            rootMessageId: root.event.aggregateId,
            recipientIds: [f.instance.instanceId],
            basedOnRoomSeq: f.head(roomId),
            idempotencyKey: `thread-${i}`,
          });
          expectedThread = created.thread.threadId;
        }
      } else {
        f.kernel.postMessage(f.actor, {
          roomId,
          body: "please reply",
          recipients: [
            { participantId: f.instance.instanceId, reason: "mention" },
          ],
          idempotencyKey: "wake",
        });
      }
      const work = startInstanceRunFromQueue(f);
      f.kernel.presentWorkerMessages(work.execution);
      f.kernel.markPresentedDeliverySent(f.host, {
        activationId: work.activation.activationId,
        consumerId: "worker",
        runAttemptId: work.run.runAttemptId,
      });
      await service.start();
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
      execution = new WorkerMcpExecution(service.origin, fetch, {
        runAttemptId: work.run.runAttemptId,
        accessToken: credential.accessToken,
        isActive: () => true,
      });
      const head = f.head(roomId);
      const result = await execution.call("target-call", {
        body: "MCP target reply",
        final: true,
        basedOnRoomSeq: work.scope.toSeq,
      });
      const receipt = JSON.parse(result.content[0]!.text);
      if (scenario === "multiple-threads") {
        assert.equal(result.isError, true);
        assert.match(JSON.stringify(receipt), /explicit reply target/);
        assert.equal(f.head(roomId), head, "ambiguous target commits no event");
        assert.equal(
          f.db
            .prepare("SELECT count(*) AS n FROM messages WHERE body=?")
            .get("MCP target reply")?.n,
          0,
        );
      } else {
        assert.equal(result.isError, false, JSON.stringify(receipt));
        assert.equal(receipt.state, "published");
        assert.equal(receipt.roomId, roomId);
        assert.equal(receipt.threadId, expectedThread);
        assert.equal(receipt.actorId, f.instance.instanceId);
        assert.deepEqual(
          await execution.call("target-call", {
            body: "MCP target reply",
            final: true,
            basedOnRoomSeq: work.scope.toSeq,
          }),
          result,
        );
        assert.equal(
          f.db
            .prepare("SELECT count(*) AS n FROM messages WHERE body=?")
            .get("MCP target reply")?.n,
          1,
        );
      }
    } finally {
      execution?.close();
      await service.close();
      f.close();
    }
  });
}
