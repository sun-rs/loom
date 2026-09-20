import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { resolveWorkerReadTarget } from "../src/worker-read-targets.ts";
test("new account addressing selects the live peer while old DM remains addressable by Room ID", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE rooms(room_id TEXT,kind TEXT,system_hidden INTEGER);
 CREATE TABLE principals(principal_id TEXT,handle TEXT,kind TEXT);
 CREATE TABLE memberships(principal_id TEXT,room_id TEXT);
 CREATE TABLE agent_definitions(participant_id TEXT,state TEXT);
 CREATE TABLE direct_room_pairs(room_id TEXT,left_principal_id TEXT,right_principal_id TEXT);
 INSERT INTO rooms VALUES('old-dm','direct',0),('new-dm','direct',0);
 INSERT INTO principals VALUES('reader','reader','agent'),('old','Kimi','agent'),('new','Kimi','agent');
 INSERT INTO agent_definitions VALUES('old','tombstoned'),('new','enabled');
 INSERT INTO memberships VALUES('reader','old-dm'),('reader','new-dm');
 INSERT INTO direct_room_pairs VALUES('old-dm','reader','old'),('new-dm','reader','new');`);
    const origin = { participantId: "reader", roomId: "new-dm" };
    assert.equal(
      resolveWorkerReadTarget(db, origin, "dm:@Kimi").roomId,
      "new-dm",
    );
    assert.equal(
      resolveWorkerReadTarget(db, origin, "old-dm").roomId,
      "old-dm",
    );
    assert.throws(
      () => resolveWorkerReadTarget(db, origin, "dm:@kimi"),
      /unavailable/,
    );
  } finally {
    db.close();
  }
});
