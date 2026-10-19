import assert from "node:assert/strict";
import test from "node:test";
import { RoomKernel } from "../src/room-kernel.ts";
import { roleInstanceFixture } from "./role-instance-fixture.ts";
test("schema 89 unfollows migrate without invented history and preserve canonical events", () => {
  const f = roleInstanceFixture();
  try {
    const task = f.kernel.createTask(f.actor, {
      roomId: f.home.roomId,
      title: "migration",
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "migration-task",
    }).task;
    const scope = { roomId: f.home.roomId, threadId: task.threadId };
    f.kernel.followHumanThread(f.actor, { ...scope, following: false });
    const events = f.db
      .prepare("SELECT * FROM room_events ORDER BY room_id,room_seq")
      .all();
    f.db.exec(
      "ALTER TABLE human_thread_follows DROP COLUMN retained_seq; PRAGMA user_version=89",
    );
    const upgraded = new RoomKernel({
      databasePath: String(f.db.prepare("PRAGMA database_list").get()!.file),
    });
    try {
      upgraded.initialize();
      assert.equal(f.db.prepare("PRAGMA user_version").get()!.user_version, 90);
      assert.equal(
        f.db.prepare("SELECT retained_seq FROM human_thread_follows").get()!
          .retained_seq,
        null,
      );
      assert.equal(
        upgraded.getHumanThreadFollowers(f.actor, scope).following,
        false,
      );
      assert.deepEqual(
        f.db
          .prepare("SELECT * FROM room_events ORDER BY room_id,room_seq")
          .all(),
        events,
      );
      assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    f.close();
  }
});
