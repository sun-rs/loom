import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  migrateIdentityAccounts,
  bindMessageMentions,
} from "../src/identity-accounts.ts";

test("migration freezes old mentions before deleted account reuse, preserves foreign keys and is repeatable", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE principals(principal_id TEXT PRIMARY KEY,handle TEXT NOT NULL UNIQUE,kind TEXT,created_at TEXT);
 CREATE TABLE agent_definitions(agent_definition_id TEXT,participant_id TEXT REFERENCES principals(principal_id),state TEXT);
 CREATE TABLE messages(message_id TEXT PRIMARY KEY,body TEXT,actor_id TEXT REFERENCES principals(principal_id),created_at TEXT);
 INSERT INTO principals VALUES('old','Kimi','agent','2020-01-01'),('human','Hakase','human','2020-01-01');
 INSERT INTO agent_definitions VALUES('old-agent','old','tombstoned');
 INSERT INTO messages VALUES('m1','你好 @kimi 和 @Future','human','2021-01-01');`);
    migrateIdentityAccounts(db);
    const original = db
      .prepare("SELECT mentions_json FROM messages")
      .get()?.mentions_json;
    assert.equal(JSON.parse(String(original))[0].principalId, "old");
    db.exec(`INSERT INTO principals VALUES('new','Kimi','agent','2022-01-01');
 INSERT INTO agent_definitions VALUES('new-agent','new','enabled');
 INSERT INTO messages(message_id,body,actor_id,created_at) VALUES('m2','@Kimi','human','2023-01-01');`);
    bindMessageMentions(db, "m2");
    assert.equal(
      JSON.parse(
        String(
          db
            .prepare("SELECT mentions_json FROM messages WHERE message_id='m2'")
            .get()?.mentions_json,
        ),
      )[0].principalId,
      "new",
    );
    assert.throws(
      () =>
        db.exec(
          "INSERT INTO principals VALUES('duplicate','Kimi','agent','2024-01-01')",
        ),
      /already taken/,
    );
    db.exec(
      "INSERT INTO principals VALUES('case','KiMi','agent','2024-01-01')",
    );
    migrateIdentityAccounts(db);
    assert.equal(
      db
        .prepare("SELECT mentions_json FROM messages WHERE message_id='m1'")
        .get()?.mentions_json,
      original,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(db.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
  } finally {
    db.close();
  }
});

test("schema drift recognition accepts only the exact identity migration", async () => {
  const { isIdentityAccountsMigration } =
    await import("../src/kernel-schema-signature.ts");
  const shape = {
    columns: [{ name: "body" }, { name: "mentions_json" }],
    uniqueKeys: [],
    checks: [],
  };
  const previous = { ...shape, columns: [{ name: "body" }] };
  assert.equal(
    isIdentityAccountsMigration(
      "table:messages",
      JSON.stringify(previous),
      JSON.stringify(shape),
    ),
    true,
  );
  assert.equal(
    isIdentityAccountsMigration(
      "table:messages",
      JSON.stringify({ ...previous, checks: ["unexpected"] }),
      JSON.stringify(shape),
    ),
    false,
  );
});
