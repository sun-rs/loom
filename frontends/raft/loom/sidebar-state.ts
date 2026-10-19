import { replaceSidebarSubsetOrder } from "../packages/web/src/components/layout/sidebarDnd.ts";
import type { SidebarPreferences, SidebarPatchRequest } from "@rah-os/protocol";
export type SidebarRoom = {
  roomId: string;
  name: string;
  instancePrivateBox?: { instanceId: string };
};
type Channel = SidebarRoom;
// Explicit Human presentation placement, never inferred from member count/name.
// A standalone chat remains a normal Channel with its own instance/session.
export const isStandaloneChat = (
  room: SidebarRoom,
  prefs: SidebarPreferences,
) => !room.instancePrivateBox && prefs.dmOrder.includes(`room:${room.roomId}`);
export const sidebarKey = (room: SidebarRoom) =>
  room.instancePrivateBox
    ? `peer:${room.instancePrivateBox.instanceId}`
    : `room:${room.roomId}`;
export const groupSortMode = (prefs: SidebarPreferences, id: string) =>
  id === "pinned"
    ? prefs.pinnedSortMode
    : id === "dms"
      ? prefs.dmSortMode
      : prefs.channelSortMode;
export const groupSortPatch = (
  id: string,
  mode: SidebarPreferences["channelSortMode"],
): SidebarPatchRequest["patch"] =>
  id === "pinned"
    ? { pinnedSortMode: mode }
    : id === "dms"
      ? { dmSortMode: mode }
      : { channelSortMode: mode };
export function sidebarGroups<T extends Channel>(
  rooms: readonly T[],
  prefs: SidebarPreferences,
  recent: Record<string, string>,
  unread: Record<string, number> = {},
) {
  const key = sidebarKey;
  rooms = rooms.filter(
    (r) =>
      !r.instancePrivateBox &&
      (!isStandaloneChat(r, prefs) ||
        !prefs.hiddenDms.includes(key(r)) ||
        (unread[r.roomId] ?? 0) > 0),
  );
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
        rooms.filter(
          (r) =>
            !isStandaloneChat(r, prefs) &&
            !pinned.has(key(r)) &&
            !placed.has(key(r)),
        ),
        prefs.channelOrder,
        prefs.channelSortMode,
      ),
    },
    ...(rooms.some((r) => isStandaloneChat(r, prefs))
      ? [
          {
            id: "dms",
            name: "私聊",
            rooms: sort(
              rooms.filter(
                (r) =>
                  isStandaloneChat(r, prefs) &&
                  !pinned.has(key(r)) &&
                  !placed.has(key(r)),
              ),
              prefs.dmOrder,
              prefs.dmSortMode,
            ),
          },
        ]
      : []),
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
  return moveSidebarItem(
    prefs,
    { roomId, name: "" },
    target,
    beforeRoomId ? `room:${beforeRoomId}` : undefined,
  );
}
export function moveSidebarItem(
  prefs: SidebarPreferences,
  room: SidebarRoom,
  target: string,
  beforeKey?: string,
): SidebarPatchRequest["patch"] {
  if (
    (target === "channels" && isStandaloneChat(room, prefs)) ||
    (target === "dms" && !isStandaloneChat(room, prefs))
  )
    return {};
  const key = sidebarKey(room);
  const insert = (items: string[]) => {
    const next = items.filter((x) => x !== key);
    const index = beforeKey ? next.indexOf(beforeKey) : -1;
    next.splice(index < 0 ? next.length : index, 0, key);
    return next;
  };
  if (target === "pinned")
    return { pinned: insert(prefs.pinned), pinnedSortMode: "manual" };
  return {
    pinned: prefs.pinned.filter((x) => x !== key),
    ...groupSortPatch(target, "manual"),
    ...(target === "dms"
      ? { dmOrder: insert(prefs.dmOrder) }
      : {
          channelOrder:
            target === "channels"
              ? insert(prefs.channelOrder)
              : prefs.channelOrder,
        }),
    customSections: prefs.customSections.map((section) => ({
      ...section,
      items:
        `custom:${section.id}` === target
          ? insert(section.items)
          : section.items.filter((x) => x !== key),
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
  const item = groups.flatMap((g) => g.rooms).find((r) => r.roomId === active);
  if (
    !target ||
    !item ||
    active === over ||
    (target.id === "channels" && isStandaloneChat(item, prefs)) ||
    (target.id === "dms" && !isStandaloneChat(item, prefs))
  )
    return {};
  if (groupSortMode(prefs, target.id) !== "manual") return {};
  const ids = target.rooms.map((r) => r.roomId).filter((id) => id !== active);
  const position = ids.indexOf(over);
  ids.splice(position < 0 ? ids.length : position + Number(after), 0, active);
  const moved = moveSidebarItem(prefs, item, target.id);
  const next = { ...prefs, ...moved };
  const byId = new Map(
    groups.flatMap((g) => g.rooms).map((r) => [r.roomId, r]),
  );
  const keys = ids.map((id) => sidebarKey(byId.get(id)!));
  const preserve = (saved: string[]) => [
    ...keys,
    ...saved.filter((k) => !keys.includes(k)),
  ];
  if (target.id === "pinned")
    return { ...moved, pinned: preserve(next.pinned) };
  if (target.id === "dms") return { ...moved, dmOrder: preserve(next.dmOrder) };
  if (target.id === "channels")
    return { ...moved, channelOrder: preserve(next.channelOrder) };
  return {
    ...moved,
    customSections: next.customSections.map((s) =>
      `custom:${s.id}` === target.id ? { ...s, items: preserve(s.items) } : s,
    ),
  };
}
