import type { SidebarPreferences, SidebarPatchRequest } from "@rah-os/protocol";
type Channel = { roomId: string; name: string };
export function sidebarGroups<T extends Channel>(
  rooms: readonly T[],
  prefs: SidebarPreferences,
  recent: Record<string, string>,
) {
  const key = (room: T) => `room:${room.roomId}`;
  const pinned = new Set(prefs.pinned);
  const placed = new Set(prefs.customSections.flatMap((s) => s.items));
  const sort = (items: T[], order: string[], mode: string) =>
    items.sort((a, b) => {
      if (mode === "az")
        return a.name.localeCompare(b.name) || a.roomId.localeCompare(b.roomId);
      if (mode === "recent")
        return (
          (recent[key(b)] ?? "").localeCompare(recent[key(a)] ?? "") ||
          a.name.localeCompare(b.name)
        );
      const rank = (r: T) => {
        const index = order.indexOf(key(r));
        return index < 0 ? Number.MAX_SAFE_INTEGER : index;
      };
      return rank(a) - rank(b);
    });
  const groups = [
    {
      id: "pinned",
      name: "置顶",
      rooms: sort(
        rooms.filter((r) => pinned.has(key(r))),
        prefs.pinned,
        prefs.pinnedSortMode,
      ),
    },
    {
      id: "channels",
      name: "频道",
      rooms: sort(
        rooms.filter((r) => !pinned.has(key(r)) && !placed.has(key(r))),
        prefs.channelOrder,
        prefs.channelSortMode,
      ),
    },
    ...prefs.customSections.map((s) => ({
      id: `custom:${s.id}`,
      name: s.name,
      rooms: sort(
        rooms.filter((r) => s.items.includes(key(r)) && !pinned.has(key(r))),
        s.items,
        prefs.channelSortMode,
      ),
    })),
  ];
  const rank = (id: string) => {
    const i = prefs.sectionOrder.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return groups.sort((a, b) => rank(a.id) - rank(b.id));
}
export function moveChannel(
  prefs: SidebarPreferences,
  roomId: string,
  target: string,
  beforeRoomId?: string,
): SidebarPatchRequest["patch"] {
  const key = `room:${roomId}`;
  const insert = (items: string[]) => {
    const next = items.filter((x) => x !== key);
    const index = beforeRoomId ? next.indexOf(`room:${beforeRoomId}`) : -1;
    next.splice(index < 0 ? next.length : index, 0, key);
    return next;
  };
  if (target === "pinned")
    return { pinned: insert(prefs.pinned), pinnedSortMode: "manual" };
  return {
    pinned: prefs.pinned.filter((x) => x !== key),
    channelSortMode: "manual",
    channelOrder:
      target === "channels" ? insert(prefs.channelOrder) : prefs.channelOrder,
    customSections: prefs.customSections.map((s) => ({
      ...s,
      items:
        `custom:${s.id}` === target
          ? insert(s.items)
          : s.items.filter((x) => x !== key),
    })),
  };
}
/** Start from the displayed order (including sorted or never-reordered rows). */
export function reorderChannel(
  prefs: SidebarPreferences,
  section: string,
  visibleIds: string[],
  roomId: string,
  direction: number,
): SidebarPatchRequest["patch"] {
  const keys = visibleIds.map((id) => `room:${id}`);
  const index = visibleIds.indexOf(roomId),
    next = index + direction;
  if (index < 0 || next < 0 || next >= keys.length) return {};
  [keys[index], keys[next]] = [keys[next]!, keys[index]!];
  const preserve = (existing: string[]) => [
    ...keys,
    ...existing.filter((key) => !keys.includes(key)),
  ];
  if (section === "pinned")
    return { pinned: preserve(prefs.pinned), pinnedSortMode: "manual" };
  if (section === "channels")
    return {
      channelOrder: preserve(prefs.channelOrder),
      channelSortMode: "manual",
    };
  return {
    customSections: prefs.customSections.map((s) =>
      `custom:${s.id}` === section ? { ...s, items: preserve(s.items) } : s,
    ),
    channelSortMode: "manual",
  };
}
export function reorderSection(
  prefs: SidebarPreferences,
  visible: string[],
  id: string,
  direction: number,
): SidebarPatchRequest["patch"] {
  const index = visible.indexOf(id),
    neighbor = visible[index + direction];
  if (index < 0 || !neighbor) return {};
  const order = [
    ...(prefs.sectionOrder.length
      ? prefs.sectionOrder
      : ["pinned", "channels", "dms"]),
  ];
  for (const key of visible) if (!order.includes(key)) order.push(key);
  const a = order.indexOf(id),
    b = order.indexOf(neighbor);
  [order[a], order[b]] = [order[b]!, order[a]!];
  return { sectionOrder: order };
}
