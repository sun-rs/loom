import { replaceSidebarSubsetOrder } from "../packages/web/src/components/layout/sidebarDnd.ts";
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
/** Drop coordinates are transient; only this patch changes the durable ordering. */
export function sidebarDrop(
  prefs: SidebarPreferences,
  groups: { id: string; rooms: Channel[] }[],
  active: string,
  over: string,
  after: boolean,
): SidebarPatchRequest["patch"] {
  if (active.startsWith("group:")) {
    const visible = groups.map((g) => g.id);
    const from = visible.indexOf(active.slice(6));
    const to = visible.indexOf(over.slice(6));
    if (from < 0 || to < 0 || from === to) return {};
    const next = [...visible];
    next.splice(to, 0, next.splice(from, 1)[0]!);
    const order = [
      ...(prefs.sectionOrder.length
        ? prefs.sectionOrder
        : ["pinned", "channels", "dms"]),
    ];
    for (const id of visible) if (!order.includes(id)) order.push(id);
    return {
      sectionOrder: replaceSidebarSubsetOrder(order, visible, next),
    };
  }
  const target = groups.find(
    (g) => `group:${g.id}` === over || g.rooms.some((r) => r.roomId === over),
  );
  if (!target || active === over) return {};
  if (
    (target.id === "pinned" ? prefs.pinnedSortMode : prefs.channelSortMode) !==
    "manual"
  )
    return {};
  const ids = target.rooms.map((r) => r.roomId).filter((id) => id !== active);
  const position = ids.indexOf(over);
  ids.splice(position < 0 ? ids.length : position + Number(after), 0, active);
  const moved = moveChannel(prefs, active, target.id);
  const next = { ...prefs, ...moved };
  const keys = ids.map((id) => `room:${id}`);
  const preserve = (saved: string[]) => [
    ...keys,
    ...saved.filter((k) => !keys.includes(k)),
  ];
  if (target.id === "pinned")
    return { ...moved, pinned: preserve(next.pinned) };
  if (target.id === "channels")
    return { ...moved, channelOrder: preserve(next.channelOrder) };
  return {
    ...moved,
    customSections: next.customSections.map((s) =>
      `custom:${s.id}` === target.id ? { ...s, items: preserve(s.items) } : s,
    ),
  };
}
