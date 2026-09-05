export function getOrCreateBoundedSession<Key, Value>(
  sessions: Map<Key, Value>,
  key: Key,
  create: () => Value,
  limit: number,
): Value {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Session cache limit must be a positive integer");
  }
  const existing = sessions.get(key);
  if (existing !== undefined) {
    sessions.delete(key);
    sessions.set(key, existing);
    return existing;
  }
  const created = create();
  sessions.set(key, created);
  while (sessions.size > limit) {
    const oldest = sessions.keys().next().value as Key | undefined;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
  return created;
}
