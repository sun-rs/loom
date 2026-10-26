import WorkspaceThemeLink from "./WorkspaceThemeLink";
import WorkspaceThemeSettings from "./WorkspaceThemeSettings";
import { LoomSidebarSlot } from "./SidebarLayout.tsx";
import {
  OfficialSettingsFrame,
  OfficialSettingsBody,
} from "./OfficialComputerProfile.generated";
import LanguageRegionSettings from "./LanguageRegionSettings.tsx";
import NotificationSettings from "./NotificationSettings.tsx";
import { LoomReleaseNotes } from "./OfficialReleaseNotes.generated.tsx";
import { loomReleaseNotes } from "./release-notes.ts";
import { WEB_BUILD_IDENTITY } from "./build-identity.ts";
import UsageSummary from "./UsageSummary.tsx";
import AccountSettings from "./AccountSettings.tsx";
import SystemSettings from "./SystemSettings.tsx";
import { LoomAboutSection } from "./OfficialSettingsSections.generated.tsx";
import { AppearanceSection } from "./OfficialAppearance.generated";
import { useEffect, useState, type CSSProperties } from "react";
import { AppShellMainSlot, Panel, SidebarItemIcon } from "raft-ui";
import {
  ChartNoAxesCombined,
  User,
  Type,
  Bell,
  Languages,
  Shield,
  BadgeInfo,
  FileText,
  Monitor,
  Palette,
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
      { id: "language-region", label: "语言和区域", icon: Languages },
      { id: "appearance", label: "外观", icon: Type },
      { id: "notifications", label: "通知", icon: Bell },
    ],
  },
  {
    label: "我在当前工作区",
    items: [{ id: "theme", label: "主题", icon: Palette }],
  },
  {
    label: "工作空间",
    items: [
      { id: "administration", label: "管理", icon: Shield },
      { id: "usage", label: "用量", icon: ChartNoAxesCombined },
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
  onComputers,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
  tab: string | null;
  onComputers: () => void;
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
  const selectedId = tab === "server" ? "administration" : (tab ?? "account");
  const selected = categories
    .flatMap((group) => group.items)
    .find((item) => item.id === selectedId);
  const groups = categories.map((group) => ({
    label: group.label,
    // Official Sidebar.settingsGroups: Computers is a mobile-only level-2 route.
    items: [
      ...group.items,
      ...(!desktop && group.label === "工作空间"
        ? [{ id: "computers", label: "计算机", icon: Monitor }]
        : []),
    ].map((item) => ({
      id: item.id,
      label: item.label,
      icon: (
        <SidebarItemIcon>
          <item.icon />
        </SidebarItemIcon>
      ),
      onClick: () => (item.id === "computers" ? onComputers() : onTab(item.id)),
    })),
  }));
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1"
      data-testid="loom-settings-page"
    >
      <LoomSidebarSlot
        page="settings"
        data-testid="loom-settings-sidebar"
        className={`relative min-w-0 shrink-0 flex-col md:flex md:w-[var(--settings-sidebar-width)] ${tab ? "hidden" : "flex w-full"}`}
        style={
          { "--settings-sidebar-width": `${panel.width}px` } as CSSProperties
        }
      >
        <ChatSidebarFrame
          title="设置"
          hideDesktopHeader
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
      </LoomSidebarSlot>
      <div
        className={`relative min-h-0 min-w-0 flex-1 ${tab ? "flex" : "hidden md:flex"}`}
      >
        <AppShellMainSlot
          style={{ zIndex: 1 }}
          data-testid="loom-settings-detail"
          className={`min-w-0 md:flex ${tab ? "flex" : "hidden"}`}
        >
          <OfficialSettingsFrame>
            <PanelHeader
              title={selected?.label ?? "设置不存在"}
              onMobileBack={() => onTab(null)}
              mobileBackProps={{ "aria-label": "设置列表" }}
            />
            <OfficialSettingsBody>
              <div
                className={
                  selectedId === "administration" ? "space-y-6" : "hidden"
                }
              >
                {selectedId === "administration" && (
                  <SystemSettings
                    client={client}
                    workspaceId={workspaceId}
                    controlRoomId={controlRoomId}
                  />
                )}
                <RuntimeSettings
                  client={client}
                  workspaceId={workspaceId}
                  controlRoomId={controlRoomId}
                  active={
                    selectedId === "administration" && (desktop || tab !== null)
                  }
                  embedded
                />
              </div>
              {selectedId === "notifications" ? (
                <NotificationSettings
                  client={client}
                  workspaceId={workspaceId}
                  controlRoomId={controlRoomId}
                />
              ) : selectedId === "release-notes" ? (
                <LoomReleaseNotes releases={loomReleaseNotes} />
              ) : selectedId === "usage" ? (
                <UsageSummary
                  client={client}
                  workspaceId={workspaceId}
                  controlRoomId={controlRoomId}
                />
              ) : selectedId === "theme" ? (
                <WorkspaceThemeSettings
                  client={client}
                  workspaceId={workspaceId}
                  controlRoomId={controlRoomId}
                />
              ) : selectedId === "appearance" ? (
                <AppearanceSection
                  themeLink={
                    <WorkspaceThemeLink onOpen={() => onTab("theme")} />
                  }
                />
              ) : selectedId === "about" ? (
                <LoomAboutSection appVersion={WEB_BUILD_IDENTITY.version} />
              ) : selectedId === "account" ? (
                <AccountSettings
                  client={client}
                  workspaceId={workspaceId}
                  controlRoomId={controlRoomId}
                />
              ) : selectedId === "language-region" ? (
                <LanguageRegionSettings />
              ) : selectedId === "administration" ? null : (
                <p className="text-sm text-foreground-muted">
                  {selected ? "此设置尚未接入。" : "请从设置列表选择一个项目。"}
                </p>
              )}
            </OfficialSettingsBody>
          </OfficialSettingsFrame>
        </AppShellMainSlot>
      </div>
    </div>
  );
}
