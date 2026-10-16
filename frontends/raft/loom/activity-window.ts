// Bounded presentation window. Only the server issues pagination cursors.
export const MAX_ACTIVITY_PAGES = 10;
export const MAX_ACTIVITY_ROWS = 200;
type Page<T> = { rows: T[]; total: number; nextCursor: string | undefined };
export function appendActivityPage<T extends { id: string }>(
  current: Page<T>,
  next: Page<T>,
): Page<T> {
  const rows = new Map(current.rows.map((row) => [row.id, row]));
  for (const row of next.rows) if (!rows.has(row.id)) rows.set(row.id, row);
  return { ...next, rows: [...rows.values()].slice(0, MAX_ACTIVITY_ROWS) };
}
export async function readActivityWindow<T extends { id: string }>(
  read: (cursor?: string) => Promise<Page<T>>,
  depth: number,
) {
  let data = await read(),
    pages = 1;
  const seen = new Set<string>();
  while (
    pages < Math.min(MAX_ACTIVITY_PAGES, depth) &&
    data.nextCursor &&
    data.rows.length < MAX_ACTIVITY_ROWS
  ) {
    const cursor = data.nextCursor;
    if (seen.has(cursor)) {
      data = { ...data, nextCursor: undefined };
      break;
    }
    seen.add(cursor);
    try {
      const next = await read(cursor);
      data = appendActivityPage(data, next);
      pages++;
      if (data.nextCursor === cursor) data = { ...data, nextCursor: undefined };
    } catch {
      return { data, pages, incomplete: true };
    }
  }
  return { data, pages, incomplete: false };
}
