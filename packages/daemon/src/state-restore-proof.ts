import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/** Offline restore is deliberately stricter than event-count equality. */
export function databaseContentDigest(path: string): string {
  const database = new DatabaseSync(path, { readOnly: true });
  const hash = createHash("sha256");
  const add = (value: unknown) =>
    hash.update(
      JSON.stringify(value, (_, item) =>
        typeof item === "bigint" ? { integer: item.toString() } : item,
      ) + "\n",
    );
  try {
    database.exec("BEGIN");
    add(database.prepare("PRAGMA user_version").get());
    const objects = database
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name",
      )
      .all();
    add(objects);
    for (const object of objects) {
      if (object.type !== "table") continue;
      const name = '"' + String(object.name).replaceAll('"', '""') + '"';
      const columns = database
        .prepare(`PRAGMA table_xinfo(${name})`)
        .all()
        .filter((column) => column.hidden !== 1)
        .map((column) => '"' + String(column.name).replaceAll('"', '""') + '"');
      const statement = database.prepare(
        `SELECT ${columns.join(", ")} FROM ${name} ORDER BY ${columns.join(", ")}`,
      );
      statement.setReadBigInts(true);
      for (const row of statement.iterate()) add(row);
    }
    return hash.digest("hex");
  } finally {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
  }
}
