import SystemSettings from "./SystemSettings.tsx";
import { AppearanceSection } from "loom-native-appearance";
import { useEffect, useState, type CSSProperties } from "react";
import { AppShellMainSlot, AppShellSidebarSlot, Panel } from "raft-ui";
import {
  User,
  Languages,
  Type,
  Bell,
  Building2,
  Shield,
  BadgeInfo,
  FileText,
} from "lucide-react";
import type { RahClient } from "@rah-os/client-sdk";
import SettingsSidebarList from "../packages/web/src/components/settings/SettingsSidebarList.tsx";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader.tsx";
import PanelResizeHandle from "../packages/web/src/components/ui/PanelResizeHandle.tsx";
import { useResizablePanel } from "../packages/web/src/hooks/useResizablePanel.ts";
import { SIDEBAR_PANEL_BOUNDS } from "../packages/web/src/lib/panelBounds.ts";
import ChatSidebarFrame from "./ChatSidebarFrame.tsx";
import RuntimeSettings from "./RuntimeSettings.tsx";
const categories = [
  {
    label: "个人",
    items: [
      { id: "account", label: "账户", icon: User },
      { id: "language-region", label: "语言与区域", icon: Languages },
      { id: "appearance", label: "外观", icon: Type },
      { id: "notifications", label: "通知", icon: Bell },
    ],
  },
  {
    label: "工作空间",
    items: [
      { id: "server", label: "运行设置", icon: Building2 },
      { id: "administration", label: "管理", icon: Shield },
    ],
  },
  {
    label: "资源",
    items: [
      { id: "about", label: "关于", icon: BadgeInfo },
      { id: "release-notes", label: "更新日志", icon: FileText },
    ],
  },
];
/** Sidebar.tsx settings rail + SettingsPanel; no upstream account or server stores. */
export default function SettingsPage({
  client,
  workspaceId,
  controlRoomId,
  tab,
  onTab,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
  tab: string | null;
  onTab: (id: string | null) => void;
}) {
  const panel = useResizablePanel({
    storageKey: "loom:settingsSidebarWidth",
    ...SIDEBAR_PANEL_BOUNDS,
  });
  const [desktop, setDesktop] = useState(
    () => window.matchMedia("(min-width: 768px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  const selectedId = tab ?? "account";
  const selected = categories
    .flatMap((group) => group.items)
    .find((item) => item.id === selectedId);
  const Icon = selected?.icon ?? Building2;
  const groups = categories.map((group) => ({
    label: group.label,
    items: group.items.map((item) => ({
      id: item.id,
      label: item.label,
      icon: <item.icon size={14} className="shrink-0" />,
      onClick: () => onTab(item.id),
    })),
  }));
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1"
      data-testid="loom-settings-page"
    >
      <AppShellSidebarSlot
        data-testid="loom-settings-sidebar"
        className={`relative min-w-0 shrink-0 flex-col md:flex md:w-[var(--settings-sidebar-width)] ${tab ? "hidden" : "flex w-full"}`}
        style={
          { "--settings-sidebar-width": `${panel.width}px` } as CSSProperties
        }
      >
        <ChatSidebarFrame
          title="设置"
          testIdPrefix="settings-sidebar"
          scrollTestId="settings-sidebar-scroll"
        >
          <SettingsSidebarList
            groups={groups}
            activeId={desktop ? selectedId : tab}
          />
        </ChatSidebarFrame>
        <PanelResizeHandle
          side="right"
          visibleFrom="md"
          data-testid="settings-sidebar-resize"
          onPointerDown={panel.handleResizeStart}
          onPointerMove={panel.handleResizeMove}
          onPointerUp={panel.handleResizeEnd}
          onPointerCancel={panel.handleResizeEnd}
        />
      </AppShellSidebarSlot>
      <AppShellMainSlot
        data-testid="loom-settings-detail"
        className={`min-w-0 md:flex ${tab ? "flex" : "hidden"}`}
      >
        <Panel
          edge="attached"
          className="flex min-h-0 flex-1 flex-col bg-layer-canvas-muted text-foreground-strong"
        >
          <PanelHeader
            title={selected?.label ?? "设置不存在"}
            icon={<Icon size={18} />}
            iconBg="bg-primary-soft text-foreground-strong theme-brutal:bg-soft-signal theme-brutal:text-black"
            onMobileBack={() => onTab(null)}
            mobileBackProps={{ "aria-label": "设置列表" }}
          />
          <div
            className={
              selectedId === "server"
                ? "flex min-h-0 flex-1 flex-col"
                : "hidden"
            }
          >
            <RuntimeSettings
              client={client}
              workspaceId={workspaceId}
              controlRoomId={controlRoomId}
              active={selectedId === "server" && (desktop || tab !== null)}
            />
          </div>
          {selectedId !== "server" && (
            <div className="flex-1 overflow-y-auto bg-layer-panel px-5 py-4 text-foreground-strong mobile-nav-clearance theme-brutal:bg-white theme-brutal:text-black">
              {selectedId === "appearance" ? (
                <AppearanceSection />
              ) : selectedId === "administration" ? (
                <SystemSettings
                  client={client}
                  workspaceId={workspaceId}
                  controlRoomId={controlRoomId}
                />
              ) : (
                <p className="text-sm text-foreground-muted">
                  {selected ? "此设置尚未接入。" : "请从设置列表选择一个项目。"}
                </p>
              )}
            </div>
          )}
        </Panel>
      </AppShellMainSlot>
    </div>
  );
}
