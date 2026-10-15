import {
  Activity,
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
import { RailTabButton } from "../packages/web/src/components/layout/LeftRail.tsx";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader.tsx";

export const destinations = [
  { id: "search", label: "搜索", icon: Search },
  { id: "channels", label: "频道", icon: MessageSquare },
  { id: "activity", label: "动态", icon: Activity },
  { id: "tasks", label: "任务", icon: CheckSquare },
  { id: "agents", label: "Agent", icon: Users },
  { id: "settings", label: "设置", icon: Settings },
] as const;
export type Destination = (typeof destinations)[number]["id"];
type NavigationProps = { active: string; onSelect: (id: Destination) => void };

/** Official LeftRail composition, without Raft account/server stores or fabricated unread state. */
export function DesktopNavigation({ active, onSelect }: NavigationProps) {
  const item = (entry: (typeof destinations)[number]) => (
    <RailTabButton
      key={entry.id}
      icon={<entry.icon size={18} />}
      label={entry.label}
      active={active === entry.id}
      aria-current={active === entry.id ? "page" : undefined}
      onClick={() => onSelect(entry.id)}
    />
  );
  return (
    <AppShellRailSlot className="hidden md:flex">
      <AppRailRoot className="pb-2" role="navigation" aria-label="主导航">
        <AppRailNav className="relative w-full">
          {destinations
            .filter((entry) => entry.id !== "settings" && entry.id !== "search")
            .map(item)}
        </AppRailNav>
        <AppRailFooter>{item(destinations[5])}</AppRailFooter>
      </AppRailRoot>
    </AppShellRailSlot>
  );
}

/** Same destinations on small screens using the official in-flow mobile navigation primitive. */
export function MobileNavigation({ active, onSelect }: NavigationProps) {
  return (
    <MobileNavRoot
      className="md:hidden shrink-0"
      aria-label="主导航"
      role="navigation"
      style={{ paddingBottom: "min(env(safe-area-inset-bottom, 0px), 34px)" }}
    >
      {destinations.map((entry) => (
        <MobileNavItem
          key={entry.id}
          selected={active === entry.id}
          aria-label={entry.label}
          aria-current={active === entry.id ? "page" : undefined}
          onClick={() => onSelect(entry.id)}
        >
          <entry.icon />
          <MobileNavLabel>{entry.label}</MobileNavLabel>
        </MobileNavItem>
      ))}
    </MobileNavRoot>
  );
}

export function DestinationPlaceholder({ active }: { active: string }) {
  const destination = destinations.find((entry) => entry.id === active);
  return (
    <AppShellMainSlot
      className="bg-layer-canvas theme-brutal:bg-white"
      data-testid="loom-destination-page"
    >
      <PanelHeader
        title={destination?.label ?? "页面不存在"}
        icon={destination ? <destination.icon size={18} /> : undefined}
      />
      <div className="p-6">
        <p>
          {destination
            ? "页面骨架已就位，内容尚未接入。"
            : "这个页面地址无效，请从主导航选择。"}
        </p>
        {destination && (
          <a
            className="mt-4 inline-block underline"
            href="/_rah/console/"
            target="_blank"
            rel="noreferrer"
          >
            打开临时控制台
          </a>
        )}
      </div>
    </AppShellMainSlot>
  );
}
