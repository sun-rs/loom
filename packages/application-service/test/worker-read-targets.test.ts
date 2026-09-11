import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { RoomKernel } from "@rah-os/kernel";
import * as P from "@rah-os/protocol";
import { WorkerApplicationService } from "../src/index.ts";

test("joined Room reads and directory resolve through HTTP and a real Worker CLI without mutation authority", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-read-api-"));
  const now = new Date("2026-09-08T12:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath: join(dir, "room.db"),
    now: () => now,
  });
  const service = new WorkerApplicationService({ kernel });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
    const agent = kernel.provisionPrincipal({
      handle: "reader",
      kind: "agent",
    });
    const actor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(actor, {
      name: "Read API",
      slug: "read-api",
    });
    kernel.addMember(actor, {
      roomId: room.roomId,
      principalId: agent.principal.principalId,
    });
    const task = kernel.createTask(actor, {
      roomId: room.roomId,
      title: "Earlier task",
      collaboratorIds: [],
      reviewerIds: [],
      dependencyTaskIds: [],
      idempotencyKey: "task",
    });
    kernel.postMessage(actor, {
      roomId: room.roomId,
      body: "Read old tasks",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      idempotencyKey: "wake",
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    const activation = kernel.leaseNextActivation(host, { leaseMs: 60000 });
    assert.ok(activation);
    const run = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    const runtime = {
      runAttemptId: run.runAttemptId,
      runtimeRunId: "runtime",
      recoveryDescriptor: {
        driver: "fake",
        metadata: {},
        recoveryKey: "runtime",
      },
    };
    kernel.prepareRunAttemptRuntime(host, runtime);
    kernel.markRunAttemptRunning(host, runtime);
    await service.start();
    const credential = service.issueActivationCredential(host, {
      activationId: activation.activationId,
      consumerId: "reader",
      hostId: host.hostId,
      participantId: agent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    });
    const call = (path: string, body: unknown = {}) =>
      fetch(`${service.origin}/v1/worker/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const other = kernel.createRoom(actor, { name: "Other", slug: "other" });
    const hidden = kernel.createRoom(actor, { name: "Hidden", slug: "hidden" });
    kernel.addMember(actor, {
      roomId: other.roomId,
      principalId: agent.principal.principalId,
    });
    const message = kernel.postMessage(actor, {
      roomId: other.roomId,
      body: "Joined fact",
      recipients: [],
      idempotencyKey: "other-message",
    });
    const targetTask = kernel.createTask(actor, {
      roomId: other.roomId,
      title: "Joined Task",
      collaboratorIds: [],
      reviewerIds: [],
      dependencyTaskIds: [],
      idempotencyKey: "other-task",
    }).task;
    const result = await call("rooms/list");
    assert.equal(result.status, 200, await result.clone().text());
    const directory = P.WorkerRoomListResponseSchema.parse(await result.json());
    assert.ok(directory.rooms.some(({ room }) => room.roomId === other.roomId));
    assert.equal(
      directory.rooms.some(({ room }) => room.roomId === hidden.roomId),
      false,
    );
    const session = join(dir, "worker-session");
    writeFileSync(session, credential.accessToken, { mode: 0o600 });
    const module = new URL(
      "../../agent-host/src/worker-cli.ts",
      import.meta.url,
    ).href;
    const cli = async (args: string[]) => {
      const result = await promisify(execFile)(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `import {runWorkerCliCommand} from ${JSON.stringify(module)};process.exitCode=await runWorkerCliCommand(process.argv.slice(1));`,
          "worker",
          ...args,
        ],
        {
          cwd: fileURLToPath(new URL("../../..", import.meta.url)),
          env: {
            ...process.env,
            RAH_ACTIVATION_ID: activation.activationId,
            RAH_WORKER_API_URL: service.origin,
            RAH_WORKER_SESSION_FILE: session,
          },
          timeout: 15000,
        },
      );
      return result.stdout;
    };
    // The read family renders Raft's text; only the commands that still answer
    // in JSON are parsed.
    const cliJson = async (args: string[]) => JSON.parse(await cli(args));
    assert.equal(
      P.WorkerRoomResolveResponseSchema.parse(
        await cliJson(["room-resolve", "--target", "#other"]),
      ).room.roomId,
      other.roomId,
    );
    assert.match(
      await cli(["message-read", "--target", "#other"]),
      new RegExp(
        `^\\[1/\\d+ target=#other seq=\\d+ msg=${message.event.aggregateId} `,
        "mu",
      ),
    );
    assert.match(
      await cli(["message-resolve", "--message-id", message.event.aggregateId]),
      new RegExp(`^\\[target=#other msg=${message.event.aggregateId} `, "mu"),
    );
    assert.match(
      await cli(["room-members", "--target", "#other"]),
      new RegExp(`^Channel: ${other.roomId}$`, "mu"),
    );
    const roster = await cli(["room-members", "--target", "#other"]);
    assert.match(roster, /@human \[room owner\]/);
    assert.match(roster, /@reader \[room member\]/);

    assert.match(
      await cli(["task-list", "--target", "#other"]),
      new RegExp(` id=${targetTask.taskId}$`, "mu"),
    );
    assert.match(
      await cli([
        "task-history",
        "--target",
        "#other",
        "--task-id",
        targetTask.taskId,
      ]),
      new RegExp(`^## Task ${targetTask.taskId} history$`, "mu"),
    );
    // Raft's `message search` prints text, so the CLI is read as a model reads
    // it; the freeze fields the text does not carry stay asserted on the HTTP
    // response the CLI itself calls.
    assert.match(
      await cli(["message-search", "--query", "Joined fact"]),
      new RegExp(
        `^Search results for: "Joined fact" \\(2 results\\)\\n\\n<result ref="msg:${message.event.aggregateId}">\\nSource: target=#other$`,
        "mu",
      ),
    );
    assert.match(
      await cli([
        "message-search",
        "--target",
        "#other",
        "--sender",
        "@human",
        "--sort",
        "recent",
        "--after",
        "2000-01-01T00:00:00.000Z",
      ]),
      new RegExp(
        `^Filtered message results \\(\\d+ results?\\)$[^]*^<result ref="msg:${message.event.aggregateId}">$`,
        "mu",
      ),
    );
    const globalSearch = P.WorkerMessageSearchResponseSchema.parse(
      await (await call("messages/search", { query: "Joined fact" })).json(),
    );
    assert.equal(
      globalSearch.messages[0]?.messageId,
      message.event.aggregateId,
    );
    assert.equal(globalSearch.frozenRoomCount, 2);
    const search = P.WorkerMessageSearchResponseSchema.parse(
      await (
        await call("messages/search", {
          channel: "#other",
          sender: "@human",
          sort: "recent",
          after: "2000-01-01T00:00:00.000Z",
        })
      ).json(),
    );
    assert.ok(
      search.messages.some((m) => m.messageId === message.event.aggregateId),
    );
    assert.equal(
      search.frozenThroughRoomSeq,
      kernel.sync(actor, { roomId: other.roomId, consumerId: "query-head" })
        .latestRoomSeq,
    );
    assert.equal(
      (await call("messages/history", { channel: "#hidden" })).status,
      404,
    );
    assert.equal(
      (await call("acknowledge", { throughSeq: activation.toSeq })).status,
      409,
    );
    assert.equal(
      (
        await call("messages/post", {
          roomId: other.roomId,
          body: "No read-derived write",
          basedOnRoomSeq: message.event.roomSeq,
          idempotencyKey: "bad",
        })
      ).status,
      400,
    );
    const observer = new DatabaseSync(join(dir, "room.db"));
    try {
      assert.equal(
        observer
          .prepare("SELECT COUNT(*) AS n FROM subscription_cursors")
          .get()!.n,
        0,
      );
      // Inject authority revocation while the origin execution remains live.
      observer
        .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
        .run(other.roomId, agent.principal.principalId);
    } finally {
      observer.close();
    }
    assert.equal(
      (await call("messages/history", { channel: "#other" })).status,
      404,
    );
    credential.revoke();
    assert.equal((await call("rooms/list")).status, 401);
  } finally {
    await service.close();
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
