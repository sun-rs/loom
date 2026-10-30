import {
  SidebarPatchRequestSchema,
  type SidebarPreferences,
  type SidebarPatchRequest,
} from "@rah-os/protocol";

type Ref = { kind: "channel" | "agent" | "human"; id: string };
/** Only verified single-instance standalone Channels may act as native DM peers. */
export type SidebarPeers = ReadonlyMap<string, string>; // instance ID -> Room ID
const roomKey = (id: string) => "room:" + id;
export function conversationPreferences<T extends { id: string }>(
  rows: readonly T[],
  p: SidebarPreferences,
) {
  return rows.map((row) => ({
    ...row,
    activityMuted: p.mutedActivity.includes(roomKey(row.id)),
    collapseLongMessages: !p.expandedLongMessages.includes(roomKey(row.id)),
    prefsVersion: p.version,
    displayPrefsVersion: p.version,
  }));
}
function ref(key: string, peers: SidebarPeers): Ref {
  if (key.startsWith("peer:")) {
    if (peers.has(key.slice(5))) return { kind: "agent", id: key.slice(5) };
    throw Error("尚未对接的旧私信身份；不能从不透明 ID 推断为 Agent");
  }
  if (!key.startsWith("room:")) throw Error("未知侧栏身份");
  const id = key.slice(5);
  const peer = [...peers].find(([, room]) => room === id)?.[0];
  return peer ? { kind: "agent", id: peer } : { kind: "channel", id };
}
function key(value: Ref, peers: SidebarPeers): string {
  if (value.kind === "channel") return roomKey(value.id);
  const room = peers.get(value.id);
  if (room) return roomKey(room);
  throw Error("单聊必须对应已核实的独立频道实例对话，不能将 Role 当作对话");
}
const tab = (value: string) => (value === "workspace" ? "files" : value);
export function nativeSidebar(
  p: SidebarPreferences,
  peers: SidebarPeers = new Map(),
) {
  const id = (value: string) => value.slice(5);
  return {
    channelOrder: p.channelOrder.map(id),
    agentOrder: [],
    dmOrder: p.dmOrder
      .map((value) =>
        value.startsWith("room:") ? id(value) : peers.get(id(value)),
      )
      .filter(Boolean),
    pinned: p.pinned.map((value) => ref(value, peers)),
    hiddenDmIds: p.hiddenDms
      .map((value) =>
        value.startsWith("room:") ? id(value) : peers.get(id(value)),
      )
      .filter(Boolean),
    sectionOrder: p.sectionOrder.map((value) =>
      value.startsWith("custom:") ? value.slice(7) : "system:" + value,
    ),
    customSections: p.customSections.map((s) => ({
      id: s.id,
      name: s.name,
      emoji: s.emoji ?? null,
      sortMode: s.sortMode ?? "manual",
    })),
    sectionPlacements: p.customSections.flatMap((s) =>
      s.items.map((value, position) => ({
        ...ref(value, peers),
        sectionId: s.id,
        position,
      })),
    ),
    channelPanelTabOrder: p.channelPanelTabOrder.map(tab),
    channelSortMode: p.channelSortMode,
    dmSortMode: p.dmSortMode,
    pinnedSortMode: p.pinnedSortMode,
    sectionsVersion: p.version,
    pinnedVersion: p.version,
  };
}
/** Sparse native edits remain sparse SDK edits; one HumanSidebar owner does the CAS. */
export function sidebarPatch(
  input: Record<string, any>,
  current: SidebarPreferences,
  peers: SidebarPeers = new Map(),
): SidebarPatchRequest["patch"] {
  const patch: Record<string, unknown> = {};
  for (const field of Object.keys(input)) {
    if (
      ["loomPrefsVersion", "sectionsVersion", "pinnedVersion"].includes(field)
    )
      continue;
    const value = input[field];
    if (["channelOrder", "dmOrder", "hiddenDmIds"].includes(field)) {
      patch[field === "hiddenDmIds" ? "hiddenDms" : field] = value.map(roomKey);
    } else if (field === "pinned")
      patch.pinned = value.map((r: Ref) => key(r, peers));
    else if (field === "sectionOrder")
      patch.sectionOrder = value.map((v: string) =>
        v.startsWith("system:") ? v.slice(7) : "custom:" + v,
      );
    else if (
      ["channelSortMode", "dmSortMode", "pinnedSortMode"].includes(field)
    )
      patch[field] = value;
    else if (field === "channelPanelTabOrder")
      patch[field] = value.map((v: string) =>
        v === "files" ? "workspace" : v,
      );
    else if (field === "customSections" || field === "sectionPlacements")
      continue;
    else if (
      (field === "agentOrder" || field === "agentPanelTabOrder") &&
      value.length === 0
    )
      continue;
    else throw Error("尚未对接的原生侧栏偏好: " + field);
  }
  if (
    input.customSections !== undefined ||
    input.sectionPlacements !== undefined
  ) {
    const sections = input.customSections ?? current.customSections;
    const known = new Set(sections.map((s: any) => s.id));
    for (const p of input.sectionPlacements ?? [])
      if (!known.has(p.sectionId)) throw Error("未知侧栏分区");
    patch.customSections = sections.map((s: any) => ({
      id: s.id,
      name: s.name,
      ...(s.emoji !== undefined ? { emoji: s.emoji } : {}),
      ...(s.sortMode !== undefined ? { sortMode: s.sortMode } : {}),
      items:
        input.sectionPlacements === undefined
          ? (current.customSections.find((old) => old.id === s.id)?.items ?? [])
          : input.sectionPlacements
              .filter((p: any) => p.sectionId === s.id)
              .sort((a: any, b: any) => a.position - b.position)
              .map((p: Ref) => key(p, peers)),
    }));
  }
  return SidebarPatchRequestSchema.shape.patch.parse(patch);
}
