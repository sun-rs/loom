import type { LocalRuntimeInventoryResponse } from "@rah-os/protocol";
export type ComputerGroupEntry = {
  id: string;
  retired?: boolean;
  computer?: { id: string; name: string };
};
/** Inventory is the only binding proof; never parse an opaque RuntimeOffer ID. */
export function roleComputer(
  runtimeOfferId: string | undefined,
  inventory: LocalRuntimeInventoryResponse | undefined,
) {
  return runtimeOfferId &&
    inventory?.runtimes.some((r) => r.runtimeOfferId === runtimeOfferId)
    ? {
        id: inventory.hostId,
        name: inventory.computer?.displayName ?? inventory.hostId,
      }
    : undefined;
}
export function groupRolesByComputer<T extends ComputerGroupEntry>(
  entries: readonly T[],
) {
  const groups = new Map<string, { id: string; name: string; entries: T[] }>();
  for (const entry of entries) {
    if (entry.retired) continue;
    const id = entry.computer?.id ?? "__unconfirmed__";
    if (!groups.has(id))
      groups.set(id, {
        id,
        name: entry.computer?.name ?? "其他或未确认的计算机",
        entries: [],
      });
    groups.get(id)!.entries.push(entry);
  }
  return [...groups.values()];
}
export function readCollapsedComputers(
  storage: Pick<Storage, "getItem">,
  key: string,
): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(value) && value.every((v) => typeof v === "string")
      ? value
      : [];
  } catch {
    return [];
  }
}
