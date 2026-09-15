// App-owned, workspace-scoped presentation state. Never persisted across reloads.
const keys = ["channel", "creator", "assignee"] as const;
export function rememberTaskFilters(
  memory: Map<string, string>,
  workspaceId: string,
  params: URLSearchParams,
) {
  const saved = new URLSearchParams();
  for (const key of keys)
    for (const value of params.getAll(key)) saved.append(key, value);
  memory.set(workspaceId, saved.toString());
}
export function restoreTaskFilters(
  memory: Map<string, string>,
  workspaceId: string,
  params: URLSearchParams,
  reload: boolean,
) {
  const next = new URLSearchParams(params);
  const saved = memory.get(workspaceId);
  if (saved !== undefined || reload) {
    const filters = new URLSearchParams(saved);
    for (const key of keys) {
      next.delete(key);
      for (const value of filters.getAll(key)) next.append(key, value);
    }
  }
  return next;
}
