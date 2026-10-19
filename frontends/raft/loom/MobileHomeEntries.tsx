import { Activity, Search } from "lucide-react";
import { SidebarItem, SidebarItemCount } from "raft-ui";
/** Sidebar.tsx mobile Home entries; official row styling, local route owner. */
export default function MobileHomeEntries({
  onSelect,
  unreadCount,
}: {
  onSelect: (id: "search" | "activity") => void;
  unreadCount?: number;
}) {
  return (
    <div className="md:hidden">
      {(
        [
          { id: "search", label: "搜索", icon: Search },
          { id: "activity", label: "动态", icon: Activity },
        ] as const
      ).map((entry) => (
        <SidebarItem
          key={entry.id}
          type="button"
          data-testid={`mobile-home-${entry.id}-entry`}
          onClick={() => onSelect(entry.id)}
          className="loom-mobile-home-action"
        >
          <entry.icon size={14} className="shrink-0 text-foreground-hint" />
          {entry.label}
          {entry.id === "activity" &&
          unreadCount !== undefined &&
          unreadCount > 0 ? (
            <SidebarItemCount className="ml-auto">
              {unreadCount > 99 ? "99+" : unreadCount}
            </SidebarItemCount>
          ) : null}
        </SidebarItem>
      ))}
    </div>
  );
}
