import MobileWorkspaceMenu from "./MobileWorkspaceMenu";
import { mobilePrimaryDestinations } from "./mobile-app-navigation";
import { CurrentSidebarToggle } from "./CurrentSidebarToggle.generated.js";
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
  Status,
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
          <CurrentSidebarToggle
            column={active === "activity" ? "activityList" : "sidebar"}
          />
          {item(destinations.find((entry) => entry.id === "settings")!)}
        </AppRailFooter>
      </AppRailRoot>
    </AppShellRailSlot>
  );
}

/** Owner-confirmed app roots, rendered with the official Web navigation primitives. */
export function MobileNavigation({
  active,
  onSelect,
  workspaceName = "Loom",
  unread,
}: NavigationProps & { workspaceName?: string }) {
  const tabs = mobilePrimaryDestinations.map((id) =>
    destinations.find((entry) => entry.id === id)!,
  );
  return (
    <div
      className="loom-mobile-nav-group pointer-events-auto md:hidden"
      role="navigation"
      aria-label="主导航"
    >
      <MobileNavRoot className="loom-mobile-nav" role="presentation">
        {tabs.map((entry) => (
          <MobileNavItem
            key={entry.id}
            data-testid={`mobile-nav-${entry.id}`}
            selected={active === entry.id}
            aria-label={entry.id === "channels" ? "首页" : entry.label}
            aria-current={active === entry.id ? "page" : undefined}
            onClick={() => onSelect(entry.id)}
          >
            {entry.id === "channels" ? <Home /> : <entry.icon />}
            {((entry.id === "channels" && unread?.channels) ||
              (entry.id === "activity" && unread?.activity)) && (
              <Status
                variant="accent"
                className="!absolute right-2 top-1"
                aria-label="有未读消息"
              />
            )}
            <MobileNavLabel className="sr-only">
              {entry.id === "channels" ? "首页" : entry.label}
            </MobileNavLabel>
          </MobileNavItem>
        ))}
      </MobileNavRoot>
      <MobileWorkspaceMenu
        name={workspaceName}
        active={active}
        onSelect={onSelect}
      />
    </div>
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
