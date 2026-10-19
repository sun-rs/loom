import RolePresence from "./RolePresence.tsx";
import type { rolePresence } from "./role-presence.ts";
// Structural port: MainLayout member master/detail, MemberAgentRow and
// AgentDetailPanel tab strip. Store-bound upstream components stay untouched.
import { useState, type ReactNode, type CSSProperties } from "react";
import {
  AppShellMainSlot,
  AppShellSidebarSlot,
  SidebarSectionHeader,
  SidebarSectionDisclosure,
  SidebarSectionCount,
  SidebarSectionControl,
  SidebarItemContent,
  SidebarItemTitle,
  Input,
  SidebarItem,
  ConversationPanelTabs,
  Tabs,
  TabsList,
  TabsTab,
  TabsLabel,
} from "raft-ui";
import { Plus, RefreshCw, Settings2, Users } from "lucide-react";
import Frame from "./ChatSidebarFrame.tsx";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import PanelHeader, {
  PROFILE_HEADER_SURFACE_CLASS,
} from "../packages/web/src/components/ui/PanelHeader.tsx";
import PanelResizeHandle from "../packages/web/src/components/ui/PanelResizeHandle.tsx";
import { useResizablePanel } from "../packages/web/src/hooks/useResizablePanel.ts";
import { SIDEBAR_PANEL_BOUNDS } from "../packages/web/src/lib/panelBounds.ts";
export type RoleEntry = {
  id: string;
  name: string;
  retired?: boolean;
  presence?: ReturnType<typeof rolePresence>;
};
export default function RoleWorkspace({
  detail,
  onBack,
  entries,
  selected,
  onSelect,
  tab,
  onTab,
  busy,
  onCreate,
  onRefresh,
  actions,
  children,
}: {
  detail: boolean;
  onBack: () => void;
  entries: RoleEntry[];
  selected?: RoleEntry;
  onSelect: (id: string) => void;
  tab: string;
  onTab: (tab: string) => void;
  busy: boolean;
  onCreate: () => void;
  onRefresh: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const panel = useResizablePanel({
    storageKey: "loom:agentSidebarWidth",
    ...SIDEBAR_PANEL_BOUNDS,
  });
  const visible = entries.filter((entry) =>
    entry.name
      .normalize("NFKC")
      .toLocaleLowerCase()
      .includes(query.trim().normalize("NFKC").toLocaleLowerCase()),
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <AppShellSidebarSlot
        className={`relative shrink-0 flex-col md:flex md:w-[var(--agent-sidebar-width)] ${detail ? "hidden" : "flex w-full"}`}
        style={{ "--agent-sidebar-width": `${panel.width}px` } as CSSProperties}
      >
        <Frame
          title="Agent"
          testIdPrefix="agent-sidebar"
          scrollTestId="loom-role-list"
        >
          <SidebarSectionHeader>
            <SidebarSectionDisclosure render={<div />} type={undefined}>
              角色 <SidebarSectionCount>{entries.length}</SidebarSectionCount>
            </SidebarSectionDisclosure>
            <SidebarSectionControl
              aria-label="刷新角色"
              disabled={busy}
              onClick={onRefresh}
            >
              <RefreshCw size={16} />
            </SidebarSectionControl>
            <SidebarSectionControl
              aria-label="新建角色"
              disabled={busy}
              onClick={onCreate}
            >
              <Plus size={16} />
            </SidebarSectionControl>
          </SidebarSectionHeader>
          <Input
            aria-label="筛选角色"
            placeholder="筛选角色"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-2"
          />
          {!visible.length && (
            <p className="px-2 text-sm">
              {query ? "没有匹配的角色" : "暂无角色"}
            </p>
          )}
          {visible.map((entry) => (
            <SidebarItem
              key={entry.id}
              active={selected?.id === entry.id}
              disabled={busy}
              data-role-id={entry.id}
              aria-label={entry.name}
              onClick={() => {
                onSelect(entry.id);
              }}
              className={`mx-0 w-full items-center ${selected?.id === entry.id ? "  " : ""}`}
            >
              <AvatarSlot
                context="sidebar-list"
                type="agent"
                badge={<RolePresence state={entry.presence ?? "unknown"} />}
              />
              <SidebarItemContent>
                <SidebarItemTitle>{entry.name}</SidebarItemTitle>
              </SidebarItemContent>
            </SidebarItem>
          ))}
        </Frame>
        <PanelResizeHandle
          side="right"
          visibleFrom="md"
          data-testid="agent-sidebar-resize"
          onPointerDown={panel.handleResizeStart}
          onPointerMove={panel.handleResizeMove}
          onPointerUp={panel.handleResizeEnd}
          onPointerCancel={panel.handleResizeEnd}
        />
      </AppShellSidebarSlot>
      <AppShellMainSlot
        className={`min-w-0 bg-layer-panel md:flex ${detail ? "flex" : "hidden"}`}
        data-testid="loom-role-detail"
      >
        <PanelHeader
          title={selected?.name ?? "选择角色"}
          iconSlot={<AvatarSlot context="panel-header" type="agent" />}
          iconKind="avatar"
          iconAlwaysVisible
          onMobileBack={onBack}
          mobileBackProps={{ "aria-label": "角色列表" }}
          containerProps={{
            className: `agent-profile-header-container ${PROFILE_HEADER_SURFACE_CLASS}`,
          }}
          actions={actions}
        />
        {selected && (
          <div className="min-w-0 max-w-full shrink-0">
            <ConversationPanelTabs
              render={<Tabs value={tab} onValueChange={onTab} />}
            >
              <TabsList aria-label="角色详情">
                <TabsTab
                  disabled={busy}
                  value="roles"
                  className="!cursor-default"
                >
                  <Settings2 />
                  <TabsLabel>配置</TabsLabel>
                </TabsTab>
                <TabsTab
                  disabled={busy}
                  value="instances"
                  className="!cursor-default"
                >
                  <Users />
                  <TabsLabel>实例</TabsLabel>
                </TabsTab>
              </TabsList>
            </ConversationPanelTabs>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {children}
        </div>
      </AppShellMainSlot>
    </div>
  );
}
