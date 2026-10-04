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
import { WorkerMessagePostResponseSchema } from "../../protocol/src/worker-message.ts";
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
    const bind = (turn: string) => {
      const work = startInstanceRun(f);
      f.kernel.presentWorkerMessages(work.execution);
      f.kernel.markPresentedDeliverySent(f.host, {
        activationId: work.activation.activationId,
        consumerId: "worker",
        runAttemptId: work.run.runAttemptId,
      });
      const credential = service.issueActivationCredential(f.host, work.scope);
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
    const first = bind("native-turn-1");
    const original = params(
      "native-turn-1",
      "native-call-1",
      "FAKE MCP integration reply one",
    );
    const result = await invoke(original);
    assert.equal(result.isError, false, JSON.stringify(result));
    const receipt = WorkerMessagePostResponseSchema.parse(
      JSON.parse(result.content[0]!.text),
    );
    assert.ok("event" in receipt);
    assert.equal(receipt.event.actorId, f.instance.instanceId);
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
    const second = bind("native-turn-2");
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
