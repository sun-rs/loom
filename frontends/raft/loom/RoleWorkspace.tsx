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
  SidebarSectionHeader,
  SidebarSectionDisclosure,
  SidebarSectionCount,
  SidebarSectionControl,
  Input,
  TabsList,
  TabsTab,
  TabsLabel,
} from "raft-ui";
import {
  Plus,
  RefreshCw,
  Bot,
  Activity,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import Frame from "./ChatSidebarFrame.tsx";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import PanelHeader, {
  PROFILE_HEADER_SURFACE_CLASS,
} from "../packages/web/src/components/ui/PanelHeader.tsx";
export type RoleEntry = {
  id: string;
  name: string;
  retired?: boolean;
  avatarUrl?: string;
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
  inspector,
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
  inspector?: ReactNode;
}) {
  const [showDeleted, setShowDeleted] = useState(false);
  const [query, setQuery] = useState("");
  const panel = useSidebarColumn();
  const visible = entries.filter((entry) =>
    entry.name
      .normalize("NFKC")
      .toLocaleLowerCase()
      .includes(query.trim().normalize("NFKC").toLocaleLowerCase()),
  );
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
          hideDesktopHeader
          title="Agent"
          testIdPrefix="agent-sidebar"
          scrollTestId="loom-role-list"
        >
          <SidebarSectionHeader>
            <SidebarSectionDisclosure render={<div />} type={undefined}>
              角色{" "}
              <SidebarSectionCount>
                {entries.filter((e) => !e.retired).length}
              </SidebarSectionCount>
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
          {visible
            .filter((entry) => !entry.retired)
            .map((entry) => (
              <OfficialRoleRow
                key={entry.id}
                agent={entry}
                selected={selected?.id === entry.id}
                busy={busy}
                onSelect={onSelect}
                statusDot={<RolePresence state={entry.presence ?? "unknown"} />}
              />
            ))}
          {entries.some((entry) => entry.retired) && (
            <>
              <SidebarSectionHeader>
                <SidebarSectionDisclosure
                  render={<button type="button" />}
                  aria-expanded={showDeleted}
                  onClick={() => setShowDeleted((v) => !v)}
                >
                  {showDeleted ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  已删除{" "}
                  <SidebarSectionCount>
                    {entries.filter((entry) => entry.retired).length}
                  </SidebarSectionCount>
                </SidebarSectionDisclosure>
              </SidebarSectionHeader>
              {showDeleted &&
                visible
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
            </>
          )}
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
                className={`min-h-0 flex-1 overflow-y-auto ${selected ? "" : "px-5 py-5"}`}
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
