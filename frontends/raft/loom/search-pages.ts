// Loom's bounded client projection; pagination cursors remain owned by the server.
export const MAX_SEARCH_RESULT_ROWS = 200;
export function appendSearchPage<T extends { id: string }>(
  current: { rows: T[]; total: number; nextCursor: string | undefined },
  next: { rows: T[]; total: number; nextCursor: string | undefined },
) {
  const rows = new Map(current.rows.map((row) => [row.id, row]));
  for (const row of next.rows) if (!rows.has(row.id)) rows.set(row.id, row);
  return { ...next, rows: [...rows.values()].slice(0, MAX_SEARCH_RESULT_ROWS) };
}
