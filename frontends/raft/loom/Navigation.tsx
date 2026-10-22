import {
  OfficialSortableNavigation,
  type SortableRailBinding,
} from "./OfficialSortableNavigation.generated.js";
import type { NavigationUnread } from "./navigation-unread.ts";
import {
  Home,
  Monitor,
  Activity,
  BookOpen,
  CheckSquare,
  MessageSquare,
  Search,
  Settings,
  Users,
} from "lucide-react";
import {
  AppShellRailSlot,
  AppRailRoot,
  AppRailNav,
  AppRailFooter,
  AppShellMainSlot,
  MobileNavRoot,
  MobileNavItem,
  MobileNavLabel,
} from "raft-ui";
import { RailTabButton } from "./OfficialNavigationLeaves.generated";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader.tsx";

export const destinations = [
  { id: "search", label: "搜索", icon: Search },
  { id: "channels", label: "频道", icon: MessageSquare },
  { id: "activity", label: "动态", icon: Activity },
  { id: "tasks", label: "任务", icon: CheckSquare },
  { id: "agents", label: "Agent", icon: Users },
  { id: "computers", label: "计算机", icon: Monitor },
  { id: "memory", label: "记忆", icon: BookOpen },
  { id: "settings", label: "设置", icon: Settings },
] as const;
export type Destination = (typeof destinations)[number]["id"];
type NavigationProps = {
  active: string;
  onSelect: (id: Destination, focusFirstUnread?: boolean) => void;
  unread?: NavigationUnread;
};

/** Official LeftRail composition, without Raft account/server stores or fabricated unread state. */
export function DesktopNavigation({
  active,
  onSelect,
  unread,
}: NavigationProps) {
  const item = (
    entry: (typeof destinations)[number],
    binding?: SortableRailBinding,
  ) => (
    <RailTabButton
      {...binding?.dragProps}
      key={entry.id}
      icon={<entry.icon size={18} />}
      label={entry.label}
      testId={`left-rail-tab-${entry.id}`}
      showDot={
        entry.id === "channels"
          ? unread?.channels
          : entry.id === "activity"
            ? unread?.activity
            : false
      }
      dotInactiveOnly
      active={active === entry.id}
      aria-current={active === entry.id ? "page" : undefined}
      onDoubleClick={
        entry.id === "activity" ? () => onSelect(entry.id, true) : undefined
      }
      onClick={
        binding
          ? binding.guardClick(() => onSelect(entry.id))
          : () => onSelect(entry.id)
      }
    />
  );
  return (
    <AppShellRailSlot className="hidden md:flex">
      <AppRailRoot className="pb-2" role="navigation" aria-label="主导航">
        <AppRailNav className="relative w-full">
          <OfficialSortableNavigation
            tabs={destinations
              .filter(
                (entry) => entry.id !== "settings" && entry.id !== "search",
              )
              .map((entry) => ({
                id: entry.id,
                label: entry.label,
                render: (binding: SortableRailBinding) => item(entry, binding),
              }))}
          />
        </AppRailNav>
        <AppRailFooter>
          {item(destinations.find((entry) => entry.id === "settings")!)}
        </AppRailFooter>
      </AppRailRoot>
    </AppShellRailSlot>
  );
}

/** Same destinations on small screens using the official mobile navigation primitive in the shared floating host. */
export function MobileNavigation({ active, onSelect }: NavigationProps) {
  const tabs = destinations
    .filter(
      (entry) =>
        entry.id !== "search" &&
        entry.id !== "activity" &&
        entry.id !== "computers",
    )
    .map((entry) =>
      entry.id === "channels" ? { ...entry, label: "首页", icon: Home } : entry,
    );
  return (
    <MobileNavRoot
      className="loom-mobile-nav pointer-events-auto md:hidden"
      aria-label="主导航"
      role="navigation"
    >
      {tabs.map((entry) => (
        <MobileNavItem
          key={entry.id}
          selected={
            active === entry.id ||
            (active === "computers" && entry.id === "settings")
          }
          aria-label={entry.label}
          aria-current={
            active === entry.id ||
            (active === "computers" && entry.id === "settings")
              ? "page"
              : undefined
          }
          onClick={() => onSelect(entry.id)}
        >
          <entry.icon />
          <MobileNavLabel className="sr-only">{entry.label}</MobileNavLabel>
        </MobileNavItem>
      ))}
    </MobileNavRoot>
  );
}

export function DestinationPlaceholder({ active }: { active: string }) {
  const destination = destinations.find((entry) => entry.id === active);
  return (
    <AppShellMainSlot
      className="bg-layer-canvas "
      data-testid="loom-destination-page"
    >
      <PanelHeader
        title={destination?.label ?? "页面不存在"}
        icon={destination ? <destination.icon size={18} /> : undefined}
      />
      <div className="p-6">
        <p>
          {destination
            ? "此页面暂不可用，请从主导航选择。"
            : "这个页面地址无效，请从主导航选择。"}
        </p>
      </div>
    </AppShellMainSlot>
  );
}
