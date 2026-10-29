import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  ClientApplicationService,
  WorkerApplicationService,
} from "../../application-service/src/index.ts";
import { HttpRahClient } from "../../client-sdk/src/index.ts";
import { RoomKernel, createHumanApplicationPort } from "../src/index.ts";

import { agentRuntimeContextFromPlacement } from "../src/run-agent-context.ts";

// The first vertical path deliberately uses the existing Room delivery owner.
// No provider is started by these tests.
test("Role is inert configuration; two channel instances receive independent conversations", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-role-mvp-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  const service = new ClientApplicationService({
    human: createHumanApplicationPort(kernel),
    health: () => {
      throw new Error("health not used by this gate");
    },
  });
  const workerService = new WorkerApplicationService({ kernel });
  try {
    kernel.initialize();
    await workerService.start();
    await service.start();
    const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const actor = kernel.authenticateAccessToken(owner.accessToken);
    const workspace = kernel.createWorkspace(actor, {
      name: "Roles",
      slug: "roles",
      idempotencyKey: "workspace",
    });
    const db = new DatabaseSync(databasePath);
    const head = (id: string) =>
      Number(
        db
          .prepare("SELECT next_seq - 1 AS seq FROM rooms WHERE room_id=?")
          .get(id)!.seq,
      );
    const create = {
      controlRoomId: workspace.controlRoom.roomId,
      basedOnRoomSeq: head(workspace.controlRoom.roomId),
      idempotencyKey: "role",
      configuration: {
        displayName: "Reviewer",
        handle: "reviewer",
        instructions: "Review only.",
        role: "Frontend review",
        runtimeOfferId: "offer",
        modelIntent: { fallback: "disabled" as const },
      },
    };
    const client = new HttpRahClient({
      baseUrl: service.origin,
      accessToken: () => owner.accessToken,
    });
    const role = (await client.request("role.create", create)).role;
    assert.equal(kernel.roles.create(actor, create).role.roleId, role.roleId);
    assert.equal(
      db.prepare("SELECT count(*) n FROM agent_definitions").get()!.n,
      0,
    );
    const channels = ["one", "two"].map((slug) =>
      kernel.createWorkspaceRoom(actor, {
        workspaceId: workspace.workspace.workspaceId,
        basedOnControlRoomSeq: head(workspace.controlRoom.roomId),
        kind: "channel",
        idempotencyKey: slug,
        name: slug,
        slug,
      }),
    );
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "host",
        participantIds: [
          kernel.provisionPrincipal({ handle: "bootstrap", kind: "agent" })
            .principal.principalId,
        ],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    const now = new Date(),
      digest = `sha256:${"a".repeat(64)}`;
    for (const offerId of ["offer", "other-offer"])
      kernel.publishRuntimeOffer(host, {
        hostId: host.hostId,
        hostInstanceId: host.instanceId,
        runtimeOfferId: offerId,
        // A different CLI/profile, not another observation of the same one.
        runtimeProfileId: offerId === "offer" ? "profile" : "other-profile",
        runtimeProfileRevisionId:
          offerId === "offer" ? "profile-v1" : "other-profile-v1",
        revisionDigest: digest,
        protocolFamily: "rah-worker-process/v1",
        state: "available",
        observedAt: now.toISOString(),
        leaseUntil: new Date(now.getTime() + 600_000).toISOString(),
        isolation: { evidence: "declared", level: "none" },
        maxConcurrent: 2,
        capacityPoolIds: [],
        capabilityEvidence: [],
        certificationRefs: [],
        modelBindingDescriptors: [],
        supportedToolAccessModes: ["full_access"],
        workspaceMountDescriptors: [
          {
            workspaceDefinitionId: workspace.workspace.workspaceId,
            workspaceMountRevisionId: "mount",
            workspaceMountDigest: digest,
            modes: ["in_place"],
          },
        ],
      });
    const instances = await Promise.all(
      channels.map(({ room }, i) =>
        client.request("role.instantiate", {
          roleId: role.roleId,
          channelId: room.roomId,
          basedOnRoomSeq: head(room.roomId),
          idempotencyKey: `instance-${i}`,
        }),
      ),
    );
    assert.throws(
      () =>
        kernel.manageWorkspaceAgent(actor, {
          ...create.configuration,
          action: "configure",
          agentId: instances[0]!.instance.agentId,
          handle: instances[0]!.agent.handle,
          runtimeOfferId: "other-offer",
          basedOnRoomSeq: head(workspace.controlRoom.roomId),
          idempotencyKey: "replace-instance-runtime",
        }),
      /instance.*runtime/i,
    );
    const catalog = (
      await client.request("agent.list", {
        controlRoomId: workspace.controlRoom.roomId,
      })
    ).agents;
    for (const { instance } of instances)
      assert.equal(
        catalog.find((a) => a.definition.participantId === instance.instanceId)
          ?.instanceChannelId,
        instance.channelId,
      );
    for (const { instance, agent } of instances) {
      const launch = agentRuntimeContextFromPlacement(db, {
        participant_id: instance.instanceId,
        agent_definition_revision_id:
          agent.currentRevision.agentDefinitionRevisionId,
      });
      assert.equal(launch.instanceSessionRequired, false);
      assert.equal(
        launch.instanceChannelId,
        instance.channelId,
        "launch context must retain Role origin for strict native resume",
      );
    }
    assert.notEqual(
      instances[0]!.instance.instanceId,
      instances[1]!.instance.instanceId,
    );
    assert.equal(instances[0]!.instance.roleId, instances[1]!.instance.roleId);
    assert.equal(
      instances[0]!.agent.currentRevision.instructions,
      "Review only.",
    );
    for (const [i, { instance }] of instances.entries()) {
      const memberships = db
        .prepare(
          "SELECT room_id FROM memberships WHERE principal_id=? AND room_id<>?",
        )
        .all(instance.instanceId, workspace.controlRoom.roomId);
      assert.deepEqual(
        memberships.map((r) => r.room_id),
        [channels[i]!.room.roomId],
      );
      kernel.postMessage(actor, {
        roomId: instance.channelId,
        body: `review-${i}`,
        idempotencyKey: `message-${i}`,
        recipients: [{ participantId: instance.instanceId, reason: "mention" }],
      });
    }
    assert.throws(
      () =>
        kernel.addRoomMember(actor, {
          role: "member",
          principalId: instances[0]!.instance.instanceId,
          roomId: channels[1]!.room.roomId,
          basedOnRoomSeq: head(channels[1]!.room.roomId),
          idempotencyKey: "cross-channel",
        }),
      /instance.*channel/i,
    );
    const queued = db
      .prepare(
        "SELECT DISTINCT participant_id,room_id FROM activations WHERE state='queued' ORDER BY participant_id",
      )
      .all();
    assert.equal(queued.length, 2);
    for (const { instance } of instances)
      assert.ok(
        queued.some(
          (row) =>
            row.participant_id === instance.instanceId &&
            row.room_id === instance.channelId,
        ),
      );
    const privateBox = kernel.openDirectRoom(actor, {
      workspaceId: workspace.workspace.workspaceId,
      peerPrincipalId: instances[0]!.instance.instanceId,
      basedOnControlRoomSeq: head(workspace.controlRoom.roomId),
      idempotencyKey: "instance-dm",
    });
    assert.equal(
      kernel.openDirectRoom(actor, {
        workspaceId: workspace.workspace.workspaceId,
        peerPrincipalId: instances[0]!.instance.instanceId,
        basedOnControlRoomSeq: head(workspace.controlRoom.roomId),
        idempotencyKey: "instance-dm-again",
      }).roomId,
      privateBox.roomId,
    );
    // Owner2026-10-28 permits permanent channel deletion with instances.
    // Exercise it after the collaboration flow so it does not erase this fixture mid-run.
    // Exercise the same Worker box HTTP path as a CLI, without a paid provider.
    for (let round = 0; round < 2; round++) {
      for (let count = 0; count < 2; count++) {
        const activation = kernel.leaseNextActivation(host, {
          leaseMs: 600_000,
        });
        assert.ok(activation);
        const run = kernel.createRunAttempt(host, {
          activationId: activation.activationId,
        });
        const runtime = {
          runAttemptId: run.runAttemptId,
          runtimeRunId: "fake-" + run.runAttemptId,
          recoveryDescriptor: {
            driver: "fake",
            recoveryKey: run.runAttemptId,
            metadata: {},
          },
        };
        kernel.prepareRunAttemptRuntime(host, runtime);
        kernel.markRunAttemptRunning(host, runtime);
        // The fake Host persisted the native session binding for this run.
        kernel.instanceSessions.record(host, {
          runAttemptId: run.runAttemptId,
          runtimeRunId: runtime.runtimeRunId,
        });
        const scope = {
          activationId: activation.activationId,
          consumerId: "worker",
          hostId: host.hostId,
          participantId: activation.participantId,
          roomId: activation.roomId,
          runAttemptId: run.runAttemptId,
          toSeq: activation.toSeq,
        };
        const execution = kernel.authorizeWorkerExecution(host, scope);
        assert.throws(
          () =>
            kernel.workerReads.history(execution, {
              channel: privateBox.roomId,
            }),
          /unavailable|scope|private/i,
        );
        assert.ok(
          !kernel.workerReads
            .rooms(execution, {})
            .rooms.some((entry) => entry.room.roomId === privateBox.roomId),
        );
        const credential = workerService.issueActivationCredential(host, scope);
        const call = async (path: string, body: unknown) => {
          const response = await fetch(
            workerService.origin + "/v1/worker/" + path,
            {
              method: "POST",
              headers: {
                authorization: "Bearer " + credential.accessToken,
                "content-type": "application/json",
              },
              body: JSON.stringify(body),
            },
          );
          const result = (await response.json()) as Record<string, unknown>;
          assert.equal(response.status, 200, JSON.stringify(result));
          return result;
        };
        const presented = await call("message-present", {});
        kernel.markPresentedDeliverySent(host, {
          activationId: activation.activationId,
          consumerId: "worker",
          runAttemptId: run.runAttemptId,
        });
        await call("messages/post", {
          body: "FAKE MVP reply " + round,
          basedOnRoomSeq: presented.presentedThroughSeq,
          idempotencyKey: "reply-" + run.runAttemptId,
        });
        kernel.recordRuntimeTermination(host, {
          runAttemptId: run.runAttemptId,
          runtimeRunId: runtime.runtimeRunId,
          exit: { code: 0 },
        });
        kernel.finishRunAttempt(host, {
          runAttemptId: run.runAttemptId,
          state: "exited",
          exitCode: 0,
        });
        kernel.completeActivation(host, {
          activationId: activation.activationId,
          consumerId: "worker",
        });
      }
      if (round === 0) {
        for (const { instance } of instances)
          kernel.postMessage(actor, {
            roomId: instance.channelId,
            body: "continue",
            idempotencyKey: "continue-" + instance.instanceId,
            recipients: [
              { participantId: instance.instanceId, reason: "mention" },
            ],
          });
      }
    }
    for (const { instance } of instances)
      assert.equal(
        db
          .prepare(
            "SELECT count(*) n FROM messages WHERE room_id=? AND actor_id=?",
          )
          .get(instance.channelId, instance.instanceId)!.n,
        2,
      );
    // A private request waits behind channel work, using the same participant.
    const instance = instances[0]!.instance;
    const start = () => {
      const activation = kernel.leaseNextActivation(host, { leaseMs: 600_000 });
      assert.ok(activation);
      assert.equal(activation.participantId, instance.instanceId);
      const run = kernel.createRunAttempt(host, {
        activationId: activation.activationId,
      });
      const runtime = {
        runAttemptId: run.runAttemptId,
        runtimeRunId: "fake-" + run.runAttemptId,
        recoveryDescriptor: {
          driver: "fake",
          recoveryKey: run.runAttemptId,
          metadata: {},
        },
      };
      kernel.prepareRunAttemptRuntime(host, runtime);
      kernel.markRunAttemptRunning(host, runtime);
      const execution = kernel.authorizeWorkerExecution(host, {
        activationId: activation.activationId,
        consumerId: "private-test",
        hostId: host.hostId,
        participantId: instance.instanceId,
        roomId: activation.roomId,
        runAttemptId: run.runAttemptId,
        toSeq: activation.toSeq,
      });
      return { activation, run, runtime, execution };
    };
    const finish = (work: ReturnType<typeof start>) => {
      const credential = workerService.issueActivationCredential(host, {
        activationId: work.activation.activationId,
        consumerId: "private-test",
        hostId: host.hostId,
        participantId: instance.instanceId,
        roomId: work.activation.roomId,
        runAttemptId: work.run.runAttemptId,
        toSeq: work.activation.toSeq,
      });
      return (async () => {
        const call = async (path: string, body: unknown) => {
          const response = await fetch(
            workerService.origin + "/v1/worker/" + path,
            {
              method: "POST",
              headers: {
                authorization: "Bearer " + credential.accessToken,
                "content-type": "application/json",
              },
              body: JSON.stringify(body),
            },
          );
          assert.equal(response.status, 200, await response.clone().text());
          return response.json() as Promise<{ presentedThroughSeq: number }>;
        };
        const presented = await call("message-present", {});
        kernel.markPresentedDeliverySent(host, {
          activationId: work.activation.activationId,
          consumerId: "private-test",
          runAttemptId: work.run.runAttemptId,
        });
        await call("messages/post", {
          body: "PRIVATE MVP reply",
          basedOnRoomSeq: presented.presentedThroughSeq,
          idempotencyKey: "private-reply-" + work.run.runAttemptId,
        });
        kernel.recordRuntimeTermination(host, {
          runAttemptId: work.run.runAttemptId,
          runtimeRunId: work.runtime.runtimeRunId,
          exit: { code: 0 },
        });
        kernel.finishRunAttempt(host, {
          runAttemptId: work.run.runAttemptId,
          state: "exited",
          exitCode: 0,
        });
        kernel.completeActivation(host, {
          activationId: work.activation.activationId,
          consumerId: "private-test",
        });
      })();
    };
    kernel.postMessage(actor, {
      roomId: instance.channelId,
      body: "channel work",
      idempotencyKey: "busy-channel",
      recipients: [{ participantId: instance.instanceId, reason: "mention" }],
    });
    const busy = start();
    kernel.postMessage(actor, {
      roomId: privateBox.roomId,
      body: "private secret",
      idempotencyKey: "private-question",
      recipients: [{ participantId: instance.instanceId, reason: "mention" }],
    });
    assert.equal(kernel.leaseNextActivation(host, { leaseMs: 600_000 }), null);
    assert.equal(
      kernel.readPendingRuntimeNotice(host, {
        activationId: busy.activation.activationId,
        runAttemptId: busy.run.runAttemptId,
      }),
      undefined,
    );
    assert.throws(
      () =>
        kernel.workerReads.history(busy.execution, {
          channel: privateBox.roomId,
        }),
      /unavailable|scope|private/i,
    );
    assert.equal(
      kernel.workerReads.search(busy.execution, { query: "private secret" })
        .messages.length,
      0,
    );
    await finish(busy);
    assert.throws(
      () =>
        kernel.removeRoomMember(actor, {
          roomId: instance.channelId,
          principalId: instance.instanceId,
          basedOnRoomSeq: head(instance.channelId),
          idempotencyKey: "remove-with-private-pending",
        }),
      /active collaboration work/,
    );
    const privateWork = start();
    assert.equal(privateWork.activation.roomId, privateBox.roomId);
    assert.ok(
      kernel.workerReads
        .history(privateWork.execution, {})
        .messages.some((m) => m.body === "private secret"),
    );
    assert.ok(
      kernel.workerReads.history(privateWork.execution, {
        channel: instance.channelId,
      }).messages.length > 0,
      "private work can consult public channel history",
    );
    assert.throws(
      () =>
        kernel.workerTargetContext.post(privateWork.execution, {
          channel: instance.channelId,
          body: "must not leak private reply",
          idempotencyKey: "cross-private-reply",
        }),
      /active execution target/i,
    );
    await finish(privateWork);
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM messages WHERE room_id=? AND actor_id=?",
        )
        .get(privateBox.roomId, instance.instanceId)!.n,
      1,
    );
    const revisionRequest = {
      roleId: role.roleId,
      expectedRoleRevisionId: role.roleRevisionId,
      basedOnRoomSeq: head(workspace.controlRoom.roomId),
      idempotencyKey: "revise-role",
      configuration: {
        ...create.configuration,
        displayName: "Reviewer v2",
        instructions: "Review accessibility only.",
      },
    };
    const revised = await client.request("role.revise", revisionRequest);
    assert.equal(revised.role.roleId, role.roleId);
    assert.notEqual(revised.role.roleRevisionId, role.roleRevisionId);
    assert.equal(
      (await client.request("role.revise", revisionRequest)).deduplicated,
      true,
    );
    assert.deepEqual(
      (await client.request("role.create", create)).role,
      role,
      "create replay must return its original immutable version",
    );
    await assert.rejects(
      () =>
        client.request("role.revise", {
          ...revisionRequest,
          idempotencyKey: "stale-revise",
          basedOnRoomSeq: head(workspace.controlRoom.roomId),
        }),
      /revision|版本/i,
    );
    await assert.rejects(
      () =>
        client.request("role.revise", {
          ...revisionRequest,
          expectedRoleRevisionId: revised.role.roleRevisionId,
          idempotencyKey: "stale-room",
        }),
      { code: "stale_context" },
    );
    const updatedCatalog = await client.request("agent.list", {
      controlRoomId: workspace.controlRoom.roomId,
    });
    for (const { instance } of instances) {
      assert.equal(
        updatedCatalog.agents.find(
          (a) => a.definition.participantId === instance.instanceId,
        )?.currentRevision.instructions,
        "Review only.",
      );
    }
    const third = await client.request("role.instantiate", {
      roleId: role.roleId,
      channelId: channels[0]!.room.roomId,
      basedOnRoomSeq: head(channels[0]!.room.roomId),
      idempotencyKey: "v2-instance",
    });
    assert.equal(third.instance.roleRevisionId, revised.role.roleRevisionId);
    assert.equal(
      third.agent.currentRevision.instructions,
      "Review accessibility only.",
    );
    const directory = await client.request("role.list", {
      controlRoomId: workspace.controlRoom.roomId,
    });
    assert.deepEqual(
      directory.instances.filter((i) => i.isCurrent).map((i) => i.instanceId),
      [third.instance.instanceId],
    );
    assert.equal(directory.instances.filter((i) => !i.isCurrent).length, 2);
    assert.equal(
      db.prepare("SELECT count(*) n FROM role_revisions").get()!.n,
      2,
    );
    const restartedDb = new DatabaseSync(databasePath);
    const continued = agentRuntimeContextFromPlacement(restartedDb, {
      participant_id: instance.instanceId,
      agent_definition_revision_id:
        instances[0]!.agent.currentRevision.agentDefinitionRevisionId,
    });
    assert.equal(continued.instanceSessionRequired, true);
    restartedDb.close();
    // A legacy queued private activation cannot escape the new execution fence.
    kernel.postMessage(actor, {
      roomId: privateBox.roomId,
      body: "queued before legacy removal",
      idempotencyKey: "legacy-private-pending",
      recipients: [{ participantId: instance.instanceId, reason: "mention" }],
    });
    db.prepare(
      "DELETE FROM memberships WHERE room_id=? AND principal_id=?",
    ).run(instance.channelId, instance.instanceId);
    assert.equal(kernel.leaseNextActivation(host, { leaseMs: 600000 }), null);
    db.prepare(
      "INSERT INTO memberships(room_id,principal_id,role,joined_at) VALUES(?,?,'member',?)",
    ).run(instance.channelId, instance.instanceId, new Date().toISOString());
    const legacyWork = start();
    await finish(legacyWork);
    kernel.removeRoomMember(actor, {
      roomId: instance.channelId,
      principalId: instance.instanceId,
      basedOnRoomSeq: head(instance.channelId),
      idempotencyKey: "remove-idle-instance",
    });
    assert.throws(
      () =>
        kernel.postMessage(actor, {
          roomId: privateBox.roomId,
          body: "must not run removed instance",
          idempotencyKey: "private-after-removal",
          recipients: [
            { participantId: instance.instanceId, reason: "mention" },
          ],
        }),
      /private box.*inactive/i,
    );
    assert.equal(kernel.leaseNextActivation(host, { leaseMs: 600000 }), null);
    kernel.deleteWorkspaceRoom(actor, {
      roomId: channels[0]!.room.roomId,
      basedOnRoomSeq: head(channels[0]!.room.roomId),
      idempotencyKey: "delete-channel",
    });
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM rooms WHERE room_id=?")
        .get(channels[0]!.room.roomId)!.n,
      0,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM role_templates").get()!.n,
      1,
      "reusable Role remains",
    );
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM role_instances WHERE channel_id=?")
        .get(channels[1]!.room.roomId)!.n,
      1,
      "other channel remains isolated",
    );
    db.close();
  } finally {
    await workerService.close();
    await service.close();
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
