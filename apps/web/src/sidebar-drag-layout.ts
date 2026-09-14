import type { SidebarPreferences } from "@rah-os/protocol";
export type SidebarItems = Record<string, string[]>;
export type SidebarDragLayout = {
  version: number;
  sections: string[];
  items: SidebarItems;
};
export function sidebarAccepts(key: string, section: string) {
  return section === "channels"
    ? key.startsWith("room:")
    : section === "dms"
      ? key.startsWith("peer:")
      : section === "pinned" || section.startsWith("custom:");
}
/** Raft Bm/Sat: transient drag geometry only; persistence stays in HumanSidebar. */
export function moveSidebarPreview(
  items: SidebarItems,
  key: string,
  section: string,
  target: string | undefined,
  after: boolean,
): SidebarItems {
  if (!items[section] || !sidebarAccepts(key, section) || key === target)
    return items;
  const source = Object.keys(items).find((id) => items[id]!.includes(key));
  if (!source) return items;
  const destination = items[section]!.filter((id) => id !== key);
  const index = target ? destination.indexOf(target) : destination.length;
  if (index < 0) return items;
  destination.splice(index + (target && after ? 1 : 0), 0, key);
  if (
    source === section &&
    destination.every((id, i) => id === items[section]![i])
  )
    return items;
  return {
    ...items,
    [source]: items[source]!.filter((id) => id !== key),
    [section]: destination,
  };
}

/** Hidden conversations keep their last placement; dragging visible rows is not deletion. */
export function sidebarPreviewPatch(
  p: SidebarPreferences,
  layout: SidebarDragLayout,
  visible: ReadonlySet<string>,
) {
  const retain = (shown: string[], prior: string[]) => [
    ...shown,
    ...prior.filter((key) => !visible.has(key)),
  ];
  return {
    sectionOrder: layout.sections,
    pinned: retain(layout.items.pinned ?? [], p.pinned),
    channelOrder: retain(layout.items.channels ?? [], p.channelOrder),
    dmOrder: retain(layout.items.dms ?? [], p.dmOrder),
    customSections: p.customSections.map((s) => ({
      ...s,
      items: retain(layout.items[`custom:${s.id}`] ?? [], s.items),
    })),
  };
}
