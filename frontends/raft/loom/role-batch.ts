export type BatchRow = { instanceId: string; status: string; detail?: string };
/** One explicit user batch, no retry queue. Stop at the first unconfirmed mutation. */
export async function runRoleBatch<T extends { instanceId: string }>(
  items: readonly T[],
  send: (item: T) => Promise<{ kind: string; error?: unknown }>,
  report?: (rows: BatchRow[]) => void,
) {
  const rows: BatchRow[] = items.map((i) => ({
    instanceId: i.instanceId,
    status: "not-run",
  }));
  for (let i = 0; i < items.length; i++) {
    let outcome: { kind: string; error?: unknown };
    try {
      outcome = await send(items[i]!);
    } catch (error) {
      outcome = { kind: "unknown", error };
    }
    rows[i] = {
      instanceId: items[i]!.instanceId,
      status: outcome.kind,
      ...(outcome.error
        ? {
            detail:
              outcome.error instanceof Error
                ? outcome.error.message
                : String(outcome.error),
          }
        : {}),
    };
    report?.([...rows]);
    if (outcome.kind !== "ok") break;
  }
  return rows;
}
