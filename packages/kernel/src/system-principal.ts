import type { DatabaseSync } from "node:sqlite";

/** The Kernel's own service principal (system notices and audit events). */
export const SYSTEM_PRINCIPAL_ID = "principal_system";

export function ensureSystemPrincipal(
  database: DatabaseSync,
  timestamp: string,
): void {
  database
    .prepare(
      "INSERT OR IGNORE INTO principals(principal_id, handle, kind, created_at) VALUES(?, ?, 'service', ?)",
    )
    .run(SYSTEM_PRINCIPAL_ID, "rah-system", timestamp);
}
