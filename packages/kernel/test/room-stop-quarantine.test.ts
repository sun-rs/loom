import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";

for (const orphaned of [false, true])
  test(`Human stop ${orphaned ? "refuses unproven quarantine" : "withdraws terminated quarantined execution without acknowledging messages"}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-stop-quarantine-"));
    const databasePath = join(directory, "room.db");
    const kernel = new RoomKernel({ databasePath });
    try {
      kernel.initialize();
      const human = kernel.provisionPrincipal({
        handle: "human",
        kind: "human",
      });
      const agent = kernel.provisionPrincipal({
        handle: "agent",
        kind: "agent",
      });
      const actor = kernel.authenticateAccessToken(human.accessToken);
      const agentActor = kernel.authenticateAccessToken(agent.accessToken);
      const room = kernel.createRoom(actor, {
        name: "Council",
        slug: "council",
      });
      kernel.addMember(actor, {
        roomId: room.roomId,
        principalId: agent.principal.principalId,
      });
      const host = kernel.authenticateHostAccessToken(
        kernel.provisionHostCredential({
          hostId: "host",
          participantIds: [agent.principal.principalId],
        }).accessToken,
      );
      kernel.heartbeatHost(host);
      kernel.postRoomMessage(actor, {
        roomId: room.roomId,
        body: "Mistaken request",
        idempotencyKey: "message",
      });
      const old = kernel.leaseNextActivation(host, { leaseMs: 30000 })!;
      if (orphaned)
        kernel.createRunAttempt(host, { activationId: old.activationId });
      if (orphaned)
        kernel.quarantineActivation(host, {
          activationId: old.activationId,
          error: "runtime timed out",
        });
      else {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt)
            assert.equal(
              kernel.leaseNextActivation(host, { leaseMs: 30000 })
                ?.activationId,
              old.activationId,
            );
          kernel.retryActivation(host, {
            activationId: old.activationId,
            error: "runtime timed out",
            retryAfterMs: 0,
          });
        }
      }
      const db = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const beforeInbox = db
          .prepare("SELECT * FROM inbox_items ORDER BY inbox_item_id")
          .all();
        const beforeCursors = db
          .prepare("SELECT * FROM subscription_cursors")
          .all();
        const command = {
          roomId: room.roomId,
          basedOnRoomSeq: kernel.sync(actor, {
            roomId: room.roomId,
            consumerId: "human",
            limit: 500,
          }).latestRoomSeq,
          idempotencyKey: "stop",
          resumeOnMessage: true,
        };
        if (orphaned) {
          assert.throws(
            () => kernel.roomAgentSos.requestStop(actor, command),
            /terminal proof|unfinished RunAttempt/,
          );
          assert.equal(
            kernel.listActivations({ roomId: room.roomId })[0]?.state,
            "quarantined",
          );
          return;
        }
        const stopped = kernel.roomAgentSos.requestStop(actor, command);
        assert.equal(stopped.operation.state, "stopped");
        assert.equal(
          kernel.listActivations({ roomId: room.roomId })[0]?.state,
          "cancelled",
        );
        assert.equal(
          db
            .prepare(
              "SELECT state FROM activation_retry_fences WHERE activation_id = ?",
            )
            .get(old.activationId)?.state,
          "resolved",
        );
        assert.deepEqual(
          db.prepare("SELECT * FROM inbox_items ORDER BY inbox_item_id").all(),
          beforeInbox,
        );
        assert.deepEqual(
          db
            .prepare(
              "SELECT * FROM subscription_cursors WHERE participant_id = ?",
            )
            .all(agent.principal.principalId),
          beforeCursors.filter(
            (row) => row.participant_id === agent.principal.principalId,
          ),
        );
        assert.equal(
          kernel.roomAgentSos.requestStop(actor, command).deduplicated,
          true,
        );
        const cancellation = kernel
          .sync(agentActor, {
            roomId: room.roomId,
            consumerId: "audit",
            limit: 500,
          })
          .events.filter((event) => event.type === "activation.cancelled");
        assert.equal(cancellation.length, 1);
        kernel.postRoomMessage(actor, {
          roomId: room.roomId,
          body: "New request",
          idempotencyKey: "new",
        });
        const next = kernel.leaseNextActivation(host, { leaseMs: 30000 })!;
        assert.notEqual(next.activationId, old.activationId);
        assert.equal(
          kernel
            .listActivations({ roomId: room.roomId })
            .find((a) => a.activationId === old.activationId)?.state,
          "cancelled",
        );
      } finally {
        db.close();
      }
    } finally {
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
