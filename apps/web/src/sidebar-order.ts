import type { SidebarPreferences } from "@rah-os/protocol";
export type SidebarSectionId =
  "pinned" | "channels" | "dms" | `custom:${string}`;
export function sortSidebar<T extends { key: string; label: string }>(
  rows: readonly T[],
  mode: SidebarPreferences["channelSortMode"],
  order: readonly string[],
  recent: Record<string, string>,
): T[] {
  const positions = new Map(order.map((key, i) => [key, i]));
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (mode === "az")
        return a.row.label.localeCompare(b.row.label) || a.index - b.index;
      if (mode === "recent")
        return (
          (recent[b.row.key] ?? "").localeCompare(recent[a.row.key] ?? "") ||
          a.index - b.index
        );
      return (
        (positions.get(a.row.key) ?? Number.MAX_SAFE_INTEGER) -
          (positions.get(b.row.key) ?? Number.MAX_SAFE_INTEGER) ||
        a.index - b.index
      );
    })
    .map((x) => x.row);
}
// Structural port Raft eet/GA/Lf: remove identity once, insert at a bounded index.
export function sidebarDrop(
  p: SidebarPreferences,
  key: string,
  section: SidebarSectionId,
  target: string | undefined,
  visible: readonly string[],
): Partial<Omit<SidebarPreferences, "version">> | undefined {
  if (key === target) return;
  const custom = section.startsWith("custom:")
    ? p.customSections.find((s) => `custom:${s.id}` === section)
    : undefined;
  if (section.startsWith("custom:") && !custom) return;
  const cleaned = p.customSections.map((s) => ({
    ...s,
    items: s.items.filter((id) => id !== key),
  }));
  if (custom) {
    const list = custom.items.filter((id) => id !== key);
    const index = target ? custom.items.indexOf(target) : -1;
    list.splice(index < 0 ? list.length : Math.min(index, list.length), 0, key);
    return {
      pinned: p.pinned.filter((id) => id !== key),
      customSections: cleaned.map((s) =>
        s.id === custom.id ? { ...s, items: list } : s,
      ),
    };
  }
  const field =
    section === "pinned"
      ? "pinned"
      : section === "channels"
        ? "channelOrder"
        : "dmOrder";
  const mode =
    section === "pinned"
      ? p.pinnedSortMode
      : section === "channels"
        ? p.channelSortMode
        : p.dmSortMode;
  if (
    (section === "channels" && !key.startsWith("room:")) ||
    (section === "dms" && !key.startsWith("peer:"))
  )
    return;
  if (mode !== "manual" && target) return;
  const original = [
    ...new Set([
      ...(section === "pinned"
        ? visible.filter((id) => p.pinned.includes(id))
        : visible),
      ...p[field],
    ]),
  ];
  const index = target ? original.indexOf(target) : -1,
    list = original.filter((id) => id !== key);
  list.splice(index < 0 ? list.length : Math.min(index, list.length), 0, key);
  return section === "pinned"
    ? { pinned: list, customSections: cleaned }
    : {
        [field]: list,
        pinned: p.pinned.filter((id) => id !== key),
        customSections: cleaned,
      };
}
