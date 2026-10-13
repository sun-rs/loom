import assert from "node:assert/strict";
import { RoomKernel } from "../src/index.ts";
import { test } from "node:test";
import {
  roleInstanceFixture,
  startInstanceRun,
  claimInstanceRun,
} from "./role-instance-fixture.ts";

for (const busy of [false, true])
  test(`Side discard fences immediately and completes only with terminal proof (busy=${busy})`, async () => {
    const f = roleInstanceFixture();
    try {
      const source = startInstanceRun(f);
      f.kernel.instanceSessions.record(f.host, {
        runAttemptId: source.run.runAttemptId,
        runtimeRunId: source.runtime.runtimeRunId,
      });
      source.finish(0);
      const created = await f.kernel.roles.createSide(
        f.actor,
        f.host,
        {
          instanceId: f.instance.instanceId,
          basedOnRoomSeq: f.head(f.home.roomId),
          idempotencyKey: "side",
        },
        async () => {},
      );
      const s = created.side;
      f.kernel.postMessage(f.actor, {
        roomId: s.roomId,
        body: "work",
        idempotencyKey: "work",
        recipients: [{ participantId: s.instanceId, reason: "mention" }],
      });
      const run = busy
        ? claimInstanceRun({
            ...f,
            home: { ...f.home, roomId: s.roomId },
            instance: {
              ...f.instance,
              instanceId: s.instanceId,
              agentId: s.agentId,
              channelId: s.roomId,
            },
            agentId: s.agentId,
            revisionId: created.agent.currentRevision.agentDefinitionRevisionId,
          })
        : undefined;
      const sourceHead = f.head(f.home.roomId);
      const command = {
        sideId: s.instanceId,
        basedOnRoomSeq: f.head(s.roomId),
        idempotencyKey: "discard",
      };
      assert.throws(
        () =>
          f.kernel.roles.discardSide(f.actor, {
            ...command,
            basedOnRoomSeq: 0,
          }),
        /sequence|context|stale/i,
      );
      const requested = f.kernel.roles.discardSide(f.actor, command);
      assert.equal(requested.side.state, busy ? "discarding" : "discarded");
      assert.equal(f.head(f.home.roomId), sourceHead);
      assert.throws(
        () =>
          f.kernel.manageWorkspaceAgent(f.actor, {
            agentId: s.agentId,
            action: "set_state",
            state: "enabled",
            basedOnRoomSeq: f.head(f.controlRoomId),
            idempotencyKey: "revive",
          }),
        /discard/i,
      );
      assert.throws(
        () =>
          f.kernel.postMessage(f.actor, {
            roomId: s.roomId,
            body: "late",
            idempotencyKey: "late",
            recipients: [],
          }),
        /inactive|archived|Side|side/,
      );
      assert.equal(
        f.kernel.roles.discardSide(f.actor, command).deduplicated,
        true,
      );
      assert.throws(
        () =>
          f.kernel.roles.discardSide(f.actor, {
            ...command,
            basedOnRoomSeq: 0,
          }),
        /key|identity/i,
      );
      if (run) {
        assert.throws(
          () =>
            f.kernel.workerReads.history(run.execution, {
              channel: f.home.roomId,
              limit: 50,
            }),
          /Side|permission|disabled|paused/i,
        );
        assert.throws(
          () =>
            f.kernel.postWorkerMessage(run.execution, {
              body: "late reply",
              basedOnRoomSeq: f.head(s.roomId),
              idempotencyKey: "late-reply",
            }),
          /Side|disabled|paused/i,
        );
        assert.throws(
          () =>
            f.kernel.renewActivationLease(f.host, {
              activationId: run.activation.activationId,
              leaseMs: 60000,
            }),
          /disabled|paused/i,
        );
        assert.equal(f.kernel.roles.reconcileSideDiscards(), 0);
        f.kernel.recordRuntimeTermination(f.host, {
          runAttemptId: run.run.runAttemptId,
          runtimeRunId: run.runtime.runtimeRunId,
          exit: { code: null, signal: "SIGTERM" },
        });
        assert.equal(
          f.kernel.roles.reconcileSideDiscards(),
          0,
          "runtime exit alone cannot finish a live RunAttempt",
        );
        f.kernel.finishRunAttempt(f.host, {
          runAttemptId: run.run.runAttemptId,
          state: "cancelled",
          exitSignal: "SIGTERM",
        });
        f.kernel.retryActivation(f.host, {
          activationId: run.activation.activationId,
          error: "Side disabled",
          retryAfterMs: 1000,
        });
        f.db
          .prepare(
            "INSERT INTO runtime_cleanup_states(runtime_run_id,host_id,participant_id,state,observed_at,updated_at) VALUES(?,?,?,'pending',?,?)",
          )
          .run(
            "side-cleanup",
            "host",
            s.instanceId,
            new Date().toISOString(),
            new Date().toISOString(),
          );
        const recovered = new RoomKernel({
          databasePath: String(
            f.db.prepare("PRAGMA database_list").get()!.file,
          ),
        });
        recovered.initialize();
        try {
          assert.equal(
            recovered.roles.reconcileSideDiscards(),
            0,
            "cleanup proof survives Kernel reconstruction",
          );
          f.db
            .prepare(
              "UPDATE runtime_cleanup_states SET state='resolved' WHERE runtime_run_id='side-cleanup'",
            )
            .run();
          assert.equal(recovered.roles.reconcileSideDiscards(), 1);
        } finally {
          recovered.close();
        }
        assert.equal(
          f.kernel.roles.discardSide(f.actor, command).side.state,
          "discarded",
        );
      }
      assert.equal(f.kernel.roles.reconcileSideDiscards(), 0);
      assert.equal(f.head(f.home.roomId), sourceHead);
      assert.equal(
        f.db
          .prepare(
            "SELECT count(*) n FROM activations WHERE participant_id=? AND state<>'cancelled'",
          )
          .get(s.instanceId)?.n,
        0,
      );
      assert.equal(
        f.db
          .prepare(
            "SELECT count(*) n FROM room_events WHERE room_id=? AND type='side.discarded'",
          )
          .get(s.roomId)?.n,
        1,
      );
    } finally {
      f.close();
    }
  });
