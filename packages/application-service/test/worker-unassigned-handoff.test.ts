import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { RoomKernel } from "@rah-os/kernel";
import { WorkerTaskMutationResponseSchema } from "@rah-os/protocol";
import { WorkerApplicationService } from "../src/index.ts";

for (const transport of ["http", "fake-child"] as const) {
  test(`unassigned delivery lets another Agent submit through ${transport}, without widening its scope`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-unassigned-handoff-"));
    const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
    kernel.initialize();
    const service = new WorkerApplicationService({ kernel });
    await service.start();
    try {
      const human = kernel.provisionPrincipal({
        kind: "human",
        handle: "human",
      });
      const original = kernel.provisionPrincipal({
        kind: "agent",
        handle: "original",
      });
      const successor = kernel.provisionPrincipal({
        kind: "agent",
        handle: "successor",
      });
      const actor = kernel.authenticateAccessToken(human.accessToken);
      const room = kernel.createRoom(actor, {
        name: "Handoff",
        slug: "handoff",
      });
      for (const principal of [original, successor]) {
        kernel.addMember(actor, {
          roomId: room.roomId,
          principalId: principal.principal.principalId,
        });
      }
      const latest = () =>
        kernel.sync(actor, {
          roomId: room.roomId,
          consumerId: "observer",
          limit: 500,
        }).latestRoomSeq;
      async function lease(participantId: string) {
        const host = kernel.authenticateHostAccessToken(
          kernel.provisionHostCredential({
            hostId: `host-${participantId}`,
            participantIds: [participantId],
          }).accessToken,
        );
        kernel.heartbeatHost(host);
        const activation = kernel.leaseNextActivation(host, {
          leaseMs: 60_000,
        });
        assert.ok(activation);
        const run = kernel.createRunAttempt(host, {
          activationId: activation.activationId,
        });
        const runtime = {
          runAttemptId: run.runAttemptId,
          runtimeRunId: run.runAttemptId,
          recoveryDescriptor: {
            driver: "fake",
            recoveryKey: run.runAttemptId,
            metadata: {},
          },
        };
        kernel.prepareRunAttemptRuntime(host, runtime);
        kernel.markRunAttemptRunning(host, runtime);
        const credential = service.issueActivationCredential(host, {
          activationId: activation.activationId,
          consumerId: run.runAttemptId,
          hostId: host.hostId,
          participantId,
          roomId: room.roomId,
          runAttemptId: run.runAttemptId,
          toSeq: activation.toSeq,
        });
        const call = async (path: string, body: unknown = {}) => {
          const response = await fetch(`${service.origin}/v1/worker/${path}`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${credential.accessToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          });
          return { status: response.status, body: await response.json() };
        };
        const sync = await call("sync");
        assert.equal(sync.status, 200);
        return {
          credential,
          activation,
          run,
          call,
          sync,
          async finish() {
            assert.equal(
              (await call("acknowledge", { throughSeq: activation.toSeq }))
                .status,
              200,
            );
            kernel.recordRuntimeTermination(host, {
              exit: { code: 0 },
              runAttemptId: run.runAttemptId,
              runtimeRunId: run.runAttemptId,
            });
            kernel.finishRunAttempt(host, {
              exitCode: 0,
              runAttemptId: run.runAttemptId,
              state: "exited",
            });
            kernel.completeActivation(host, {
              activationId: activation.activationId,
              consumerId: run.runAttemptId,
            });
            credential.revoke();
          },
        };
      }
      const created = kernel.createTask(actor, {
        roomId: room.roomId,
        title: "Work remains available after unassignment",
        assigneeId: original.principal.principalId,
        collaboratorIds: [],
        reviewerIds: [],
        dependencyTaskIds: [],
        idempotencyKey: "create",
      });
      const first = await lease(original.principal.principalId);
      const cleared = kernel.unassignTask(actor, {
        taskId: created.task.taskId,
        basedOnRoomSeq: latest(),
        idempotencyKey: "unassign",
      });
      assert.equal(cleared.task.state, "todo");
      assert.equal(cleared.task.assigneeId, undefined);
      await first.finish();

      const next = await lease(successor.principal.principalId);
      assert.notEqual(next.run.runAttemptId, first.run.runAttemptId);
      assert.ok(next.activation.fromSeq > created.event.roomSeq);
      const delivered = next.sync.body as {
        events: Array<{ type: string; roomSeq: number }>;
      };
      assert.deepEqual(
        delivered.events
          .filter((event) => event.roomSeq >= next.activation.fromSeq)
          .map((event) => event.type),
        ["task.unassigned"],
      );
      const input = {
        taskId: created.task.taskId,
        basedOnRoomSeq: next.activation.toSeq,
        idempotencyKey: "successor-claim",
      };
      const submitted = await (async () => {
        if (transport === "fake-child") {
          const tokenPath = join(directory, "worker-token");
          writeFileSync(tokenPath, next.credential.accessToken, {
            mode: 0o600,
          });
          await promisify(execFile)(
            process.execPath,
            [
              fileURLToPath(
                new URL(
                  "../../agent-host/test/fixtures/fake-cli.mjs",
                  import.meta.url,
                ),
              ),
            ],
            {
              env: {
                ...process.env,
                RAH_FAKE_MODE: "worker-task",
                RAH_WORKER_API_URL: service.origin!,
                RAH_WORKER_SESSION_FILE: tokenPath,
                RAH_PARTICIPANT_ID: successor.principal.principalId,
                RAH_ACTIVATION_ID: next.activation.activationId,
                RAH_RUN_ATTEMPT_ID: next.run.runAttemptId,
                RAH_FROM_SEQ: String(next.activation.fromSeq),
                RAH_TO_SEQ: String(next.activation.toSeq),
              },
              timeout: 20_000,
            },
          );
          const task = kernel.getTask(actor, {
            roomId: room.roomId,
            taskId: created.task.taskId,
          });
          assert.equal(
            task.state,
            "submitted",
            "the actual child must handle the unassigned event, not merely ACK it",
          );
          const events = kernel.sync(actor, {
            roomId: room.roomId,
            consumerId: "child-observer",
            limit: 500,
          }).events;
          const event = events.find(
            (event) =>
              event.type === "task.submitted" &&
              event.aggregateId === task.taskId,
          );
          assert.ok(event);
          return { task, event };
        }
        const claim = await next.call("tasks/claim", input);
        assert.equal(claim.status, 200, JSON.stringify(claim.body));
        const claimed = WorkerTaskMutationResponseSchema.parse(claim.body);
        assert.equal(claimed.task.claimedBy, successor.principal.principalId);
        assert.equal(claimed.event.actorId, successor.principal.principalId);
        const replay = await next.call("tasks/claim", input);
        assert.equal(replay.status, 200);
        assert.equal(
          WorkerTaskMutationResponseSchema.parse(replay.body).event.eventId,
          claimed.event.eventId,
        );

        const startedResponse = await next.call("tasks/start", {
          taskId: created.task.taskId,
          basedOnRoomSeq: claimed.event.roomSeq,
          idempotencyKey: "successor-start",
        });
        assert.equal(
          startedResponse.status,
          200,
          JSON.stringify(startedResponse.body),
        );
        const started = WorkerTaskMutationResponseSchema.parse(
          startedResponse.body,
        );
        const submittedResponse = await next.call("tasks/submit", {
          taskId: created.task.taskId,
          basedOnRoomSeq: started.event.roomSeq,
          idempotencyKey: "successor-submit",
          summary: "Deterministic handoff completed",
        });
        assert.equal(
          submittedResponse.status,
          200,
          JSON.stringify(submittedResponse.body),
        );
        return WorkerTaskMutationResponseSchema.parse(submittedResponse.body);
      })();
      assert.equal(submitted.task.state, "submitted");
      assert.equal(submitted.event.actorId, successor.principal.principalId);

      // A newer unassignment is for follow-up work; knowing its Task ID must not
      // grant this already-frozen execution permission to claim it.
      const future = kernel.createTask(actor, {
        roomId: room.roomId,
        title: "Not delivered to this Run",
        assigneeId: original.principal.principalId,
        collaboratorIds: [],
        reviewerIds: [],
        dependencyTaskIds: [],
        idempotencyKey: "future",
      });
      kernel.unassignTask(actor, {
        taskId: future.task.taskId,
        basedOnRoomSeq: latest(),
        idempotencyKey: "future-clear",
      });
      assert.equal(
        (
          await next.call("tasks/claim", {
            taskId: future.task.taskId,
            basedOnRoomSeq: submitted.event.roomSeq,
            idempotencyKey: "future-claim",
          })
        ).status,
        403,
      );
      const otherRoom = kernel.createRoom(actor, {
        name: "Elsewhere",
        slug: "elsewhere",
      });
      const foreign = kernel.createTask(actor, {
        roomId: otherRoom.roomId,
        title: "Outside scope",
        collaboratorIds: [],
        reviewerIds: [],
        dependencyTaskIds: [],
        idempotencyKey: "foreign",
      });
      assert.equal(
        (
          await next.call("tasks/claim", {
            taskId: foreign.task.taskId,
            basedOnRoomSeq: submitted.event.roomSeq,
            idempotencyKey: "foreign-claim",
          })
        ).status,
        403,
      );
      await next.finish();
      assert.equal((await next.call("tasks/claim", input)).status, 401);
      assert.equal(
        kernel.getTask(actor, {
          roomId: room.roomId,
          taskId: created.task.taskId,
        }).state,
        "submitted",
      );
    } finally {
      await service.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
