import type { DatabaseSync } from "node:sqlite";

export function isPresentedWindowMigration(
  name: string,
  current: string,
  expected: string,
): boolean {
  if (name !== "table:activation_presented_windows") return false;
  const legacy = JSON.parse(expected) as { columns: Column[] };
  legacy.columns = legacy.columns
    .filter(
      (column) =>
        ![
          "sent_at",
          "sent_by_host_id",
          "pending_ack_seq",
          "memory_json",
        ].includes(column.name),
    )
    .map((column) => ({
      ...column,
      name:
        column.name === "presented_seqs_json"
          ? "message_seqs_json"
          : column.name === "rendered_at"
            ? "presented_at"
            : column.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return JSON.stringify(legacy) === current;
}

function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

// SQLite exposes columns/keys through PRAGMA, but not CHECKs or index predicates.
// Tokenize those expressions without lowercasing or collapsing string literals.
function sqlTokens(value: unknown): string[] {
  return (
    String(value ?? "").match(
      /--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[\w]+|[^\s]/g,
    ) ?? []
  )
    .filter((token) => !token.startsWith("--") && !token.startsWith("/*"))
    .map((token) =>
      token.startsWith("'")
        ? token
        : token
            .toLowerCase()
            .replace(
              /^"(.*)"$|^`(.*)`$|^\[(.*)\]$/,
              (_, a, b, c) => a ?? b ?? c,
            ),
    );
}

function expression(value: unknown): string {
  return JSON.stringify(sqlTokens(value));
}

function checks(sql: unknown): string[] {
  const tokens = sqlTokens(sql);
  const result: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== "check" || tokens[i + 1] !== "(") continue;
    const start = i + 2;
    let depth = 1;
    i += 2;
    for (; i < tokens.length && depth > 0; i++) {
      if (tokens[i] === "(") depth++;
      if (tokens[i] === ")") depth--;
    }
    result.push(JSON.stringify(tokens.slice(start, i - 1)));
  }
  return result.sort();
}

type Column = {
  name: string;
  type: string;
  notnull: number;
  default: string;
  pk: number;
  hidden: number;
};
type TableShape = {
  columns: Column[];
  checks: string[];
  foreignKeys: string[];
  uniqueKeys: string[];
  strict: number;
  withoutRowid: number;
};

function indexColumns(database: DatabaseSync, name: string): string {
  return JSON.stringify(
    database
      .prepare(`PRAGMA index_xinfo(${quoted(name)})`)
      .all()
      .filter((row) => row.key === 1)
      .map((row) => [row.seqno, row.name, row.desc, row.coll]),
  );
}

export function tableSignature(
  database: DatabaseSync,
  name: string,
  sql: unknown,
): string {
  const keys = new Map<number, unknown[]>();
  for (const row of database
    .prepare(`PRAGMA foreign_key_list(${quoted(name)})`)
    .all()) {
    const id = Number(row.id);
    const group = keys.get(id) ?? [];
    group.push([
      row.seq,
      row.table,
      row.from,
      row.to,
      row.on_update,
      row.on_delete,
      row.match,
    ]);
    keys.set(id, group);
  }
  const table = database
    .prepare("PRAGMA table_list")
    .all()
    .find((row) => row.schema === "main" && row.name === name);
  const shape: TableShape = {
    columns: database
      .prepare(`PRAGMA table_xinfo(${quoted(name)})`)
      .all()
      .map((row) => ({
        name: String(row.name),
        type: String(row.type).toLowerCase(),
        notnull: Number(row.notnull),
        default: expression(row.dflt_value),
        pk: Number(row.pk),
        hidden: Number(row.hidden),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "en")),
    checks: checks(sql),
    foreignKeys: [...keys.values()].map((key) => JSON.stringify(key)).sort(),
    uniqueKeys: database
      .prepare(`PRAGMA index_list(${quoted(name)})`)
      .all()
      .filter((row) => row.origin === "u" || row.origin === "pk")
      .map((row) => indexColumns(database, String(row.name)))
      .sort(),
    strict: Number(table?.strict ?? 0),
    withoutRowid: Number(table?.wr ?? 0),
  };
  return JSON.stringify(shape);
}

export function indexSignature(
  database: DatabaseSync,
  name: string,
  tableName: string,
  sql: unknown,
): string {
  const index = database
    .prepare(`PRAGMA index_list(${quoted(tableName)})`)
    .all()
    .find((row) => row.name === name);
  const tokens = sqlTokens(sql);
  return JSON.stringify({
    tableName,
    unique: Number(index?.unique ?? 0),
    partial: Number(index?.partial ?? 0),
    columns: indexColumns(database, name),
    expression: tokens
      .slice(tokens.indexOf("("))
      .filter((token) => token !== ";"),
  });
}

export const sqlSignature = expression;

/** Only these exact historical ALTER omissions are accepted; no table-wide waiver. */
export function isKnownLegacyDrift(
  name: string,
  current: string,
  expected: string,
): boolean {
  if (
    ![
      "table:reminders",
      "table:room_files",
      "table:room_file_gc_receipts",
      "table:agent_hosts",
      "table:room_deletion_receipts",
      "table:runtime_offers",
    ].includes(name)
  )
    return false;
  const live = JSON.parse(current) as TableShape;
  const reference = JSON.parse(expected) as TableShape;
  for (const column of live.columns) {
    const target = reference.columns.find(
      (entry) => entry.name === column.name,
    );
    if (!target) continue;
    if (
      (name === "table:reminders" && column.name === "target_room_id") ||
      (name === "table:room_files" && column.name === "created_at") ||
      (name === "table:agent_hosts" && column.name === "instance_id") ||
      (name === "table:runtime_offers" &&
        [
          "current_observation_id",
          "current_snapshot_digest",
          "accepted_at",
        ].includes(column.name))
    ) {
      if (column.notnull === 0 && target.notnull === 1) column.notnull = 1;
    }
    if (
      name === "table:room_file_gc_receipts" &&
      column.name === "next_attempt_at_ms" &&
      column.default === "[]" &&
      target.default === '["0"]'
    )
      column.default = target.default;
  }
  // room-file-gc.ts v42 added the column without this newer CREATE constraint.
  const gcCheck = expression(
    "gc_reclaimed_count >= 0 AND gc_reclaimed_count <= file_count",
  );
  if (
    name === "table:room_deletion_receipts" &&
    reference.checks.includes(gcCheck) &&
    !live.checks.includes(gcCheck)
  )
    live.checks = [...live.checks, gcCheck].sort();
  const observationKey = '[[0,"current_observation_id",0,"BINARY"]]';
  if (
    name === "table:runtime_offers" &&
    reference.uniqueKeys.includes(observationKey) &&
    !live.uniqueKeys.includes(observationKey)
  )
    live.uniqueKeys = [...live.uniqueKeys, observationKey].sort();
  return JSON.stringify(live) === expected;
}

/** Exactly the v56 account UNIQUE and missing mention column, never a drift waiver. */
export function isIdentityAccountsMigration(
  name: string,
  current: string,
  expected: string,
): boolean {
  if (name !== "table:principals" && name !== "table:messages") return false;
  const live = JSON.parse(current) as TableShape;
  const target = JSON.parse(expected) as TableShape;
  if (name === "table:messages")
    target.columns = target.columns.filter((c) => c.name !== "mentions_json");
  else
    target.uniqueKeys = [
      ...target.uniqueKeys,
      '[[0,"handle",0,"BINARY"]]',
    ].sort();
  return JSON.stringify(target) === JSON.stringify(live);
}
