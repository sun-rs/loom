import type { DiscoveryRow } from "./discovery-client.ts";
/** v1.21.22 ThreadsInbox Oe/Z/Q: partition only the loaded window, preserving
 * recency within each section. Loom room keys also cover standalone conversations.
 * No extra history reads, counts, pagination or thread pin inheritance. */
export function activityPinnedRows(
  rows: readonly DiscoveryRow[],
  pinned: readonly string[],
): { row: DiscoveryRow; section?: "pinned" | "all" }[] {
  const keys = new Set(pinned);
  const isPinned = (row: DiscoveryRow) =>
    row.activityKind !== "thread" && keys.has(`room:${row.message.roomId}`);
  const first = rows.filter(isPinned),
    rest = rows.filter((row) => !isPinned(row));
  if (!first.length) return rows.map((row) => ({ row }));
  return [
    ...first.map((row, index) => ({
      row,
      ...(index === 0 ? { section: "pinned" as const } : {}),
    })),
    ...rest.map((row, index) => ({
      row,
      ...(index === 0 ? { section: "all" as const } : {}),
    })),
  ];
}
