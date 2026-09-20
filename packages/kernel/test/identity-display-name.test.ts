import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  identityDisplayName,
  directRoomDisplayName,
} from "../src/identity-display-name.ts";
test("display names retain independent deleted and recreated identities", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE principals(principal_id TEXT,handle TEXT,display_name TEXT);
 CREATE TABLE agent_definitions(participant_id TEXT,current_revision_id TEXT);
 CREATE TABLE agent_definition_revisions(agent_definition_revision_id TEXT,definition_json TEXT);
 CREATE TABLE direct_room_pairs(room_id TEXT,left_principal_id TEXT,right_principal_id TEXT);
 INSERT INTO principals VALUES('old','OpenCode',NULL),('new','OpenCode-2',NULL),('human','owner','Hakase');
 INSERT INTO agent_definitions VALUES('old','r1'),('new','r2');
 INSERT INTO agent_definition_revisions VALUES('r1','{"displayName":"Gemini"}'),('r2','{"displayName":"New Gemini"}');
 INSERT INTO direct_room_pairs VALUES('old-dm','human','old'),('new-dm','human','new');`);
  try {
    assert.equal(identityDisplayName(db, "old"), "Gemini");
    assert.equal(identityDisplayName(db, "new"), "New Gemini");
    assert.equal(identityDisplayName(db, "human"), "Hakase");
    assert.equal(directRoomDisplayName(db, "old-dm", "human"), "Gemini");
    assert.equal(directRoomDisplayName(db, "new-dm", "human"), "New Gemini");
    assert.equal(directRoomDisplayName(db, "old-dm", "unrelated"), undefined);
  } finally {
    db.close();
  }
});
