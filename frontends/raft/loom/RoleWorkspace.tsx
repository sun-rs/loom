import PageEmpty from "./PageEmpty";
import { OfficialComputerGroup139 } from "./OfficialSidebar139.generated.js";
import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives";
import { layoutQueries } from "./adaptive-layout.ts";
import { OfficialSidebarDescription139 as OfficialSidebarDescription } from "./OfficialSidebar139.generated.js";
import {
  groupRolesByComputer,
  readCollapsedComputers,
} from "./role-computer-groups";
import { SidebarResize, useSidebarColumn } from "./SidebarLayout";
import { LoomSidebarSlot } from "./SidebarLayout.tsx";
import { OfficialRoleTabs } from "./OfficialIdentityFrames.generated";
import { OfficialRoleRow } from "./OfficialIdentityRows.generated";
import RolePresence from "./RolePresence.tsx";
import type { rolePresence } from "./role-presence.ts";
// Structural port: MainLayout member master/detail, MemberAgentRow and
// AgentDetailPanel tab strip. Store-bound upstream components stay untouched.
import { useState, type ReactNode, type CSSProperties } from "react";
import {
  AppShellMainSlot,
  SidebarSection,
  SidebarList,
  SidebarSectionHeader,
  SidebarSectionDisclosure,
  SidebarSectionCount,
  SidebarSectionControl,
  SidebarSectionTrailing,
  TabsList,
  TabsTab,
  TabsLabel,
} from "raft-ui";
import { Plus, RefreshCw, Bot, Activity, ChevronRight } from "lucide-react";
import Frame from "./ChatSidebarFrame.tsx";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import PanelHeader, {
  PROFILE_HEADER_SURFACE_CLASS,
} from "../packages/web/src/components/ui/PanelHeader.tsx";
export type RoleEntry = {
  id: string;
  name: string;
  description?: string;
  runtimeLabel?: string;
  computer?: { id: string; name: string };
  retired?: boolean;
  avatarUrl?: string;
  presence?: ReturnType<typeof rolePresence>;
};
export default function RoleWorkspace({
  detail,
  workspaceId,
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
  inspector,
}: {
  detail: boolean;
  workspaceId: string;
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
  inspector?: ReactNode;
}) {
  const sectionKey = "loom:role-sections:" + workspaceId;
  const [closedSections, setClosedSections] = useState(() => {
    try {
      return new Set(
        localStorage.getItem(sectionKey) === null
          ? ["deleted"]
          : readCollapsedComputers(localStorage, sectionKey),
      );
    } catch {
      return new Set(["deleted"]);
    }
  });
  const showDeleted = !closedSections.has("deleted");
  const showRoles = !closedSections.has("roles");
  const toggleSection = (id: "roles" | "deleted") =>
    setClosedSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(sectionKey, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  const collapseKey = "loom:role-computers:" + workspaceId;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return new Set(readCollapsedComputers(localStorage, collapseKey));
    } catch {
      return new Set<string>();
    }
  });
  const toggleComputer = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(collapseKey, JSON.stringify([...next]));
      } catch {}
      return next;
    });

  const panel = useSidebarColumn();
  const mobile = useMediaQuery(layoutQueries.single);
  const visible = entries;
  const emptyList =
    mobile &&
    !visible.some((entry) => !entry.retired) &&
    !(showDeleted && visible.some((entry) => entry.retired));
  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1"
      data-testid="loom-role-layout"
    >
      <LoomSidebarSlot
        page="agents"
        className={`relative shrink-0 flex-col md:flex md:w-[var(--agent-sidebar-width)] ${detail ? "hidden" : "flex w-full"}`}
        style={{ "--agent-sidebar-width": `${panel.width}px` } as CSSProperties}
      >
        <Frame
          fillContent={emptyList}
          hideDesktopHeader
          title="Agent"
          testIdPrefix="agent-sidebar"
          scrollTestId="loom-role-list"
        >
          <SidebarSection>
            <SidebarSectionHeader>
              <SidebarSectionDisclosure
                render={<button type="button" />}
                aria-expanded={showRoles}
                data-testid="role-section-toggle"
                className="cursor-default"
                onClick={() => toggleSection("roles")}
              >
                <ChevronRight
                  size={14}
                  className={`shrink-0 transition-transform ${showRoles ? "rotate-90" : ""}`}
                />
                角色{" "}
                <SidebarSectionCount>
                  {entries.filter((e) => !e.retired).length}
                </SidebarSectionCount>
              </SidebarSectionDisclosure>
              <SidebarSectionTrailing>
                <div className="flex items-center gap-1">
                  <SidebarSectionControl
                    aria-label="刷新角色"
                    disabled={busy}
                    onClick={onRefresh}
                  >
                    <RefreshCw className="size-3.5" />
                  </SidebarSectionControl>
                  <SidebarSectionControl
                    aria-label="新建角色"
                    disabled={busy}
                    onClick={onCreate}
                  >
                    <Plus className="size-4" />
                  </SidebarSectionControl>
                </div>
              </SidebarSectionTrailing>
            </SidebarSectionHeader>
            {showRoles && !visible.some((entry) => !entry.retired) && (
              <SidebarList className="hidden md:flex">
                <OfficialSidebarDescription>
                  还没有角色
                </OfficialSidebarDescription>
              </SidebarList>
            )}
            {showRoles &&
              groupRolesByComputer(visible).map((group) => (
                <OfficialComputerGroup139
                  key={group.id}
                  id={group.id}
                  name={group.name}
                  count={group.entries.length}
                  collapsed={collapsed.has(group.id)}
                  onToggle={() => toggleComputer(group.id)}
                >
                  {group.entries.map((entry) => (
                    <OfficialRoleRow
                      key={entry.id}
                      agent={entry}
                      selected={selected?.id === entry.id}
                      busy={busy}
                      onSelect={onSelect}
                      statusDot={
                        <RolePresence state={entry.presence ?? "unknown"} />
                      }
                    />
                  ))}
                </OfficialComputerGroup139>
              ))}
            {entries.some((entry) => entry.retired) && (
              <SidebarSection>
                <SidebarSectionHeader>
                  <SidebarSectionDisclosure
                    render={<button type="button" />}
                    aria-expanded={showDeleted}
                    data-testid="deleted-role-section-toggle"
                    className="cursor-default"
                    onClick={() => toggleSection("deleted")}
                  >
                    <ChevronRight
                      size={14}
                      className={`shrink-0 transition-transform ${showDeleted ? "rotate-90" : ""}`}
                    />
                    已删除{" "}
                    <SidebarSectionCount>
                      {entries.filter((entry) => entry.retired).length}
                    </SidebarSectionCount>
                  </SidebarSectionDisclosure>
                </SidebarSectionHeader>
                {showDeleted && (
                  <SidebarList>
                    {visible
                      .filter((entry) => entry.retired)
                      .map((entry) => (
                        <OfficialRoleRow
                          key={entry.id}
                          agent={entry}
                          selected={selected?.id === entry.id}
                          busy={busy}
                          onSelect={onSelect}
                          statusDot={
                            <RolePresence state={entry.presence ?? "unknown"} />
                          }
                        />
                      ))}
                  </SidebarList>
                )}
              </SidebarSection>
            )}
          </SidebarSection>
          {emptyList && <PageEmpty kind={"roles"} />}
        </Frame>
        <SidebarResize testId="agent-sidebar-resize" />
      </LoomSidebarSlot>
      <div
        className={`relative min-h-0 min-w-0 flex-1 ${detail ? "flex" : "hidden md:flex"}`}
      >
        <AppShellMainSlot
          style={{ zIndex: 1 }}
          className={`min-w-0 bg-layer-panel md:flex ${detail ? "flex" : "hidden"}`}
        >
          <div className="thread-layout-container flex min-h-0 min-w-0 flex-1">
            <div
              className="thread-main-column flex min-h-0 min-w-0 flex-1 flex-col"
              data-testid="loom-role-detail"
            >
              {selected && (
                <PanelHeader
                  title={selected?.name ?? "选择角色"}
                  iconSlot={
                    <AvatarSlot
                      context="panel-header"
                      type="agent"
                      agentAvatarUrl={selected?.avatarUrl}
                    />
                  }
                  iconKind="avatar"
                  iconAlwaysVisible
                  onMobileBack={onBack}
                  mobileBackProps={{ "aria-label": "角色列表" }}
                  containerProps={{
                    className: `agent-profile-header-container ${PROFILE_HEADER_SURFACE_CLASS}`,
                  }}
                  actions={actions}
                />
              )}
              {selected && (
                <OfficialRoleTabs value={tab} onValueChange={onTab}>
                  <TabsList aria-label="角色详情">
                    <TabsTab
                      disabled={busy}
                      value="activity"
                      className="!cursor-default"
                    >
                      <Activity />
                      <TabsLabel>动态</TabsLabel>
                    </TabsTab>
                    <TabsTab
                      disabled={busy}
                      value="roles"
                      className="!cursor-default"
                    >
                      <Bot />
                      <TabsLabel>资料</TabsLabel>
                    </TabsTab>
                  </TabsList>
                </OfficialRoleTabs>
              )}
              <div
                className={`min-h-0 flex-1 overflow-y-auto ${selected ? "" : "flex flex-col"}`}
              >
                {children}
              </div>
            </div>
            {inspector && (
              <div
                className="thread-profile-side-column contents"
                data-collapse-channel="false"
                data-collapse-thread="false"
              >
                {inspector}
              </div>
            )}
          </div>
        </AppShellMainSlot>
      </div>
    </div>
  );
}
