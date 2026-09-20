import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { roomTimelineNoticeSql } from "../src/human-activity-notices.ts";

test("only rendered Room system notices contribute to the Room unread count", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE room_events(room_id TEXT, type TEXT, payload_json TEXT)",
    );
    const cases: [string, Record<string, unknown>, boolean][] = [
      ["room.archived", {}, false],
      ["room.unarchived", {}, true],
      ["membership.added", { participantId: "agent" }, true],
      ["membership.added", {}, false],
      [
        "reminder.fired",
        { messageId: "m", anchorRoomId: "room", title: "ping" },
        true,
      ],
      [
        "reminder.fired",
        { messageId: "m", anchorRoomId: "room", title: "ping", threadId: "t" },
        false,
      ],
      [
        "reminder.fired",
        {
          messageId: "m",
          anchorRoomId: "elsewhere",
          title: "ping",
          threadId: "t",
        },
        true,
      ],
      ["reminder.fired", { title: "malformed" }, false],
      ["message.posted", {}, false],
      ["task.created", {}, false],
      ["activation.created", {}, false],
      ["agent.trajectory.recorded", {}, false],
    ];
    for (const [type, payload, expected] of cases) {
      db.exec("DELETE FROM room_events");
      db.prepare("INSERT INTO room_events VALUES('room',?,?)").run(
        type,
        JSON.stringify(payload),
      );
      assert.equal(
        db
          .prepare(
            `SELECT COUNT(*) n FROM room_events e WHERE ${roomTimelineNoticeSql}`,
          )
          .get()!.n,
        expected ? 1 : 0,
        `${type}: ${JSON.stringify(payload)}`,
      );
    }
  } finally {
    db.close();
  }
});
