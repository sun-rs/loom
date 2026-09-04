import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RoomSidebarResizer } from "../src/components/room-sidebar-resizer.tsx";
import { ProfilePanelResizer } from "../src/components/profile-panel-resizer.tsx";
import { ThreadPanelResizer } from "../src/components/thread-panel-resizer.tsx";
import { PanelHeaderAction } from "@rah-os/ui-web/neo-brutalist/panel-header-action";
import { ChannelHeader } from "../src/components/workspace-navigation.tsx";
import { ConversationTabs } from "../src/components/conversation-tabs.tsx";
import { PanelTabs } from "@rah-os/ui-web/neo-brutalist/panel-tabs";
import {
  AgentDetailHeader,
  AgentTabList,
} from "../src/components/agent-directory-pane.tsx";
import type { AgentRouteTab } from "../src/agent-route.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import "../src/product-styles.ts";

const agent: WorkspaceAgentView = {
  participantId: "fixture-agent",
  agentDefinitionId: "fixture-agent",
  handle: "fixture",
  displayName: "很长的 Agent 名称 / Long-name-avatar-inspector-test ".repeat(5),
  description: "测试组件布局，不连接任何 Provider",
  role: "Assistant",
  state: "enabled",
  createdAt: "2026-09-04T00:00:00.000Z",
  createdBy: "owner",
  executionPolicyRevisionId: "fixture",
  skillRefs: [],
  runtimeAvailable: false,
  runtimeLabels: [],
  connectionStatus: "offline",
};

function Fixture() {
  const [widths, setWidths] = useState([240, 380, 400]);
  const [commits, setCommits] = useState<number[][]>([[], [], []]);
  const [clicks, setClicks] = useState(0);
  const [closed, setClosed] = useState(false);
  const [tab, setTab] = useState<"chat" | "tasks" | "files">("chat");
  const [agentTab, setAgentTab] = useState<AgentRouteTab>("activity");
  const click = () => setClicks((n) => n + 1);
  return (
    <main
      className="app rah-product-shell"
      style={{ display: "block", minWidth: 0, padding: 20, overflow: "auto" }}
    >
      <section
        data-fixture="actions"
        style={{ display: "flex", gap: 16, padding: 8 }}
      >
        <PanelHeaderAction aria-label="可用操作" onClick={click}>
          <Icon name="settings" />
        </PanelHeaderAction>
        <PanelHeaderAction aria-label="权限不足" disabled onClick={click}>
          <Icon name="settings" />
        </PanelHeaderAction>
        <PanelHeaderAction aria-label="正在加载" pending onClick={click}>
          <Icon name="settings" />
        </PanelHeaderAction>
        <output data-clicks>{clicks}</output>
      </section>
      <section data-fixture="tabs">
        <ConversationTabs value={tab} onSelect={setTab} canReadTasks={false} />
        <PanelTabs
          label="全部禁用"
          value="only"
          onSelect={click}
          items={[
            { id: "only", label: "不可用", icon: "chat", disabled: true },
          ]}
        />
        <PanelTabs label="空数据" value="missing" onSelect={click} items={[]} />
      </section>
      <section
        data-fixture="headers"
        className="rah-agent-directory-page is-mobile-detail-open"
        style={{
          display: "flex",
          flexWrap: "wrap",
          minWidth: 0,
          border: "2px solid black",
          height: "auto",
        }}
      >
        <div style={{ flex: "1 0 min(320px, 100%)", minWidth: 0 }}>
          <ChannelHeader
            directPeer={undefined}
            memberCount={0}
            onManageAgents={click}
            onOpenRooms={click}
            onOpenDirectPeer={click}
            onSearch={click}
            room={undefined}
          />
        </div>
        {!closed && (
          <div
            className="rah-agent-detail-panel"
            data-inspector
            style={{
              width: "min(380px, 100%)",
              minWidth: 0,
              flex: "none",
              borderLeft: "2px solid black",
            }}
          >
            <AgentDetailHeader
              agent={agent}
              canMessage={false}
              messagePending={false}
              onBack={click}
              onManage={click}
              onMessage={click}
              onClose={() => setClosed(true)}
            />
            <AgentTabList activeTab={agentTab} onSelect={setAgentTab} />
          </div>
        )}
      </section>
      {[RoomSidebarResizer, ProfilePanelResizer, ThreadPanelResizer].map(
        (Component, index) => (
          <section
            key={index}
            data-fixture={index}
            style={{
              position: "relative",
              height: 120,
              marginLeft: 30,
              width: widths[index],
              maxWidth: "90vw",
              border: "2px solid black",
            }}
          >
            <Component
              width={widths[index]!}
              onWidthChange={(width) =>
                setWidths((all) =>
                  all.map((old, i) => (i === index ? width : old)),
                )
              }
              onWidthCommit={(width) =>
                setCommits((all) =>
                  all.map((old, i) => (i === index ? [...old, width] : old)),
                )
              }
            />
            <output>
              {JSON.stringify({
                width: widths[index],
                commits: commits[index],
              })}
            </output>
          </section>
        ),
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
