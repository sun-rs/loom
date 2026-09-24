import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RoomKernel } from "../src/room-kernel.ts";

for (const previousVersion of [54, 57])
  test(`schema ${previousVersion} without exact Worker receipts upgrades without inventing presentation evidence`, () => {
    const root = mkdtempSync(join(tmpdir(), "rah-v54-receipts-"));
    const path = join(root, "room.db");
    let kernel = new RoomKernel({ databasePath: path });
    try {
      kernel.initialize();
      const human = kernel.provisionPrincipal({
        kind: "human",
        handle: "owner",
      });
      const actor = kernel.authenticateAccessToken(human.accessToken);
      const room = kernel.createRoom(actor, {
        name: "Existing room",
        slug: "existing-room",
      });
      const message = kernel.postMessage(actor, {
        roomId: room.roomId,
        body: "Preserve before upgrade",
        recipients: [],
        idempotencyKey: "original",
      });
      kernel.close();
      const old = new DatabaseSync(path);
      old.exec(
        `DROP TABLE worker_message_presentations; DROP TABLE activation_delivery_windows; DROP TABLE task_batch_command_receipts; PRAGMA user_version=${previousVersion};`,
      );
      const before = old
        .prepare("SELECT * FROM room_events ORDER BY room_id,room_seq")
        .all();
      old.close();
      kernel = new RoomKernel({ databasePath: path });
      kernel.initialize();
      assert.equal(
        kernel.authenticateAccessToken(human.accessToken).principalId,
        human.principal.principalId,
      );
      const upgraded = new DatabaseSync(path, { readOnly: true });
      try {
        assert.equal(
          upgraded.prepare("PRAGMA user_version").get()!.user_version,
          62,
        );
        assert.deepEqual(
          upgraded
            .prepare("SELECT * FROM room_events ORDER BY room_id,room_seq")
            .all(),
          before,
        );
        assert.equal(
          upgraded
            .prepare("SELECT body FROM messages WHERE message_id=?")
            .get(message.event.aggregateId)!.body,
          "Preserve before upgrade",
        );
        for (const table of [
          "worker_message_presentations",
          "activation_delivery_windows",
          "task_batch_command_receipts",
        ])
          assert.equal(
            upgraded.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n,
            0,
          );
        assert.deepEqual(
          upgraded.prepare("PRAGMA foreign_key_check").all(),
          [],
        );
      } finally {
        upgraded.close();
      }
    } finally {
      kernel.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
