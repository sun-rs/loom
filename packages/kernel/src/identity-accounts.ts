import type { DatabaseSync } from "node:sqlite";
import {
  messageMentionCandidates,
  messageReferenceNameKey,
} from "@rah-os/protocol";

/** Accounts are reusable labels. Message references are immutable Principal IDs. */
export function bindMessageMentions(
  database: DatabaseSync,
  messageId: string,
  historical = false,
): void {
  const message = database
    .prepare("SELECT * FROM messages WHERE message_id=?")
    .get(messageId);
  if (!message || message.mentions_json !== null) return;
  const people = database
    .prepare(
      `SELECT p.principal_id,p.handle,p.created_at,a.agent_definition_id,a.state
    FROM principals p LEFT JOIN agent_definitions a ON a.participant_id=p.principal_id
    WHERE p.kind IN ('human','agent')`,
    )
    .all()
    .filter((p) =>
      historical
        ? String(p.created_at) <= String(message.created_at)
        : p.state !== "tombstoned",
    );
  const handles = people.flatMap((p) =>
    historical
      ? [
          ...String(message.body).matchAll(
            new RegExp(
              `@${String(p.handle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
              "giu",
            ),
          ),
        ].map((m) => m[0].slice(1))
      : [String(p.handle)],
  );
  const mentions = messageMentionCandidates(
    String(message.body),
    handles,
  ).flatMap((candidate) => {
    const matches = people.filter((p) =>
      historical
        ? messageReferenceNameKey(String(p.handle)) ===
          messageReferenceNameKey(candidate.handle)
        : p.handle === candidate.handle,
    );
    if (matches.length !== 1) return [];
    const person = matches[0]!;
    return [
      {
        start: candidate.start,
        end: candidate.end,
        handle: candidate.value.slice(1),
        principalId: String(person.principal_id),
        ...(person.agent_definition_id
          ? { agentId: String(person.agent_definition_id) }
          : {}),
      },
    ];
  });
  database
    .prepare(
      "UPDATE messages SET mentions_json=? WHERE message_id=? AND mentions_json IS NULL",
    )
    .run(JSON.stringify(mentions), messageId);
}

const activeOwner = `SELECT 1 FROM principals p LEFT JOIN agent_definitions a ON a.participant_id=p.principal_id
 WHERE p.handle=NEW.handle COLLATE BINARY AND p.principal_id<>NEW.principal_id
 AND (a.state IS NULL OR a.state<>'tombstoned')`;
export const ACCOUNT_CONSTRAINT_SQL = `
CREATE TRIGGER IF NOT EXISTS principal_account_insert BEFORE INSERT ON principals
WHEN EXISTS (${activeOwner}) BEGIN SELECT RAISE(ABORT, 'Agent account name is already taken'); END;
CREATE TRIGGER IF NOT EXISTS principal_account_update BEFORE UPDATE OF handle ON principals
WHEN EXISTS (${activeOwner}) AND NOT EXISTS(SELECT 1 FROM agent_definitions WHERE participant_id=NEW.principal_id AND state='tombstoned')
BEGIN SELECT RAISE(ABORT, 'Agent account name is already taken'); END;
`;

/** External migration unit: rebuild without SQLite's permanent UNIQUE(handle). */
export function migrateIdentityAccounts(database: DatabaseSync): void {
  const foreignKeys =
    database.prepare("PRAGMA foreign_keys").get()?.foreign_keys === 1;
  database.exec("PRAGMA foreign_keys=OFF");
  database.exec("BEGIN IMMEDIATE");
  try {
    if (
      !database
        .prepare("PRAGMA table_info(messages)")
        .all()
        .some((c) => c.name === "mentions_json")
    )
      database.exec("ALTER TABLE messages ADD COLUMN mentions_json TEXT");
    // Freeze every legacy message, including an empty resolution, before allowing reuse.
    for (const row of database
      .prepare("SELECT message_id FROM messages WHERE mentions_json IS NULL")
      .all())
      bindMessageMentions(database, String(row.message_id), true);
    if (
      database
        .prepare("PRAGMA table_info(messages)")
        .all()
        .some((c) => c.name === "forwarded_bundle_json")
    ) {
      for (const row of database
        .prepare(
          "SELECT message_id,forwarded_bundle_json FROM messages WHERE forwarded_bundle_json IS NOT NULL",
        )
        .all()) {
        const bundle = JSON.parse(String(row.forwarded_bundle_json));
        let changed = false;
        for (const item of bundle.items ?? []) {
          if (item.mentions !== undefined) continue;
          const source = database
            .prepare(
              "SELECT body,mentions_json FROM messages WHERE message_id=?",
            )
            .get(item.sourceMessageId);
          item.mentions =
            source && source.body === item.body
              ? JSON.parse(String(source.mentions_json ?? "[]"))
              : [];
          changed = true;
        }
        if (changed)
          database
            .prepare(
              "UPDATE messages SET forwarded_bundle_json=? WHERE message_id=?",
            )
            .run(JSON.stringify(bundle), row.message_id!);
      }
    }
    const priorForeignKeyFailures = new Set(
      database
        .prepare("PRAGMA foreign_key_check")
        .all()
        .map((row) => JSON.stringify(row)),
    );
    const sql = String(
      database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='principals'",
        )
        .get()?.sql,
    );
    if (/handle\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(sql)) {
      const dependents = database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE tbl_name='principals' AND type IN ('index','trigger') AND sql IS NOT NULL",
        )
        .all();
      database.exec(
        sql
          .replace(
            /CREATE TABLE(?: IF NOT EXISTS)?\s+["`]?principals["`]?/i,
            "CREATE TABLE principals_accounts_new",
          )
          .replace(/(handle\s+TEXT\s+NOT\s+NULL)\s+UNIQUE/i, "$1"),
      );
      database.exec(
        "INSERT INTO principals_accounts_new SELECT * FROM principals; DROP TABLE principals; ALTER TABLE principals_accounts_new RENAME TO principals;",
      );
      for (const row of dependents) database.exec(String(row.sql));
    }
    database.exec(ACCOUNT_CONSTRAINT_SQL);
    if (
      database
        .prepare("PRAGMA foreign_key_check")
        .all()
        .some((row) => !priorForeignKeyFailures.has(JSON.stringify(row)))
    )
      throw new Error("Account migration violated foreign keys");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec(`PRAGMA foreign_keys=${foreignKeys ? "ON" : "OFF"}`);
  }
}
