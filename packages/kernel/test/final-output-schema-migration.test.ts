import assert from "node:assert/strict";
import test from "node:test";
import { RoomKernel } from "../src/room-kernel.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "./role-instance-fixture.ts";

test("schema 82 final markers survive upgrade without gaining trusted final-output provenance", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    f.kernel.postWorkerMessage(work.execution, {
      body: "existing final",
      final: true,
    });
    const before = f.db
      .prepare("SELECT * FROM room_events ORDER BY room_id,room_seq")
      .all();
    const path = f.db.prepare("PRAGMA database_list").get()!.file as string;
    f.db.exec(
      "ALTER TABLE run_attempt_final_replies DROP COLUMN submission_kind; PRAGMA user_version=82",
    );
    const upgraded = new RoomKernel({ databasePath: path });
    try {
      upgraded.initialize();
      assert.equal(f.db.prepare("PRAGMA user_version").get()!.user_version, 83);
      assert.equal(
        f.db
          .prepare("SELECT submission_kind FROM run_attempt_final_replies")
          .get()!.submission_kind,
        null,
      );
      assert.deepEqual(
        f.db
          .prepare("SELECT * FROM room_events ORDER BY room_id,room_seq")
          .all(),
        before,
      );
      assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    f.close();
  }
});
