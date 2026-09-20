import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  allocateRecreatedAgentHandle,
  principalHandleIsAvailable,
} from "../src/message-reference-identity.ts";

test("only active exact account names reserve handles; deleted identities keep their original handle", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE principals(principal_id TEXT, handle TEXT);
      CREATE TABLE agent_definitions(participant_id TEXT, state TEXT);
      INSERT INTO principals VALUES ('old','Kimi'),('live','KiMi'),('human','Owner');
      INSERT INTO agent_definitions VALUES ('old','tombstoned'),('live','enabled');`);
    assert.equal(allocateRecreatedAgentHandle(db, "Kimi"), "Kimi");
    assert.equal(principalHandleIsAvailable(db, "Kimi"), true);
    assert.equal(principalHandleIsAvailable(db, "KiMi"), false);
    assert.equal(principalHandleIsAvailable(db, "kimi"), true);
    assert.equal(principalHandleIsAvailable(db, "Owner"), false);
    assert.equal(
      db.prepare("SELECT handle FROM principals WHERE principal_id='old'").get()
        ?.handle,
      "Kimi",
    );
  } finally {
    db.close();
  }
});
