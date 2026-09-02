import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from "react";

import type { RahClient } from "@rah-os/client-sdk";
import type {
  ClientAgentGetResponse,
  ClientAgentMemoryGetResponse,
  LocalRuntimeInventoryEntry,
  ManagedMcpAssignmentRecord,
  ManagedMcpServerRecord,
  ManagedMcpUsageRecord,
  NavigationTarget,
  Principal,
  Room,
  RuntimeTrajectoryRecord,
  Reminder,
  AgentExecutionResetMode,
} from "@rah-os/protocol";
import {
  OFFICIAL_AGENT_AVATAR_KEYS,
  officialAgentAvatarKey,
} from "@rah-os/protocol";
import avatarPack from "@rah-os/ui-tokens/avatar-pack.json";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

import {
  agentTrajectoryTone,
  agentTrajectoryPulses,
  projectAgentActivityRows,
} from "../agent-activity-projection.ts";
import { activityPresentation } from "../identity-presentation.ts";
import { agentAvatarPixels } from "../agent-avatar-presentation.ts";
import {
  agentConnectionLabel,
  agentPresencePresentation,
  computerStatusLabel,
} from "../attention-presentation.ts";
import { mergeTrajectoryWindow } from "../agent-trajectory-window.ts";
import { renderAgentActivityDiagnostics } from "../agent-activity-diagnostics.ts";
import { Icon } from "./icon.tsx";
import { AgentStatusDot } from "./agent-status-dot.tsx";
import { AgentMemoryConfigDialog } from "./agent-memory-config-dialog.tsx";
import { AgentExecutionResetDialog } from "./agent-execution-reset-dialog.tsx";
import { AgentRolePermissions } from "./agent-role-permissions.tsx";
import { AgentProfileFieldEditor } from "./agent-profile-field.tsx";
import type { AgentProfileEditInput } from "../agent-profile-edit.ts";
import {
  projectAgentMcpServers,
  type AgentMcpServerView,
} from "../agent-mcp-projection.ts";
import { runtimeReasoningOptions } from "../agent-runtime-capabilities.ts";
import { AgentWorkspaceBrowser } from "./agent-workspace-browser.tsx";
import { DiagnosticReferences } from "./diagnostic-references.tsx";
import { ProfilePanelResizer } from "./profile-panel-resizer.tsx";
import { useProfilePanelWidth } from "../use-profile-panel-width.ts";
import {
  reconcileAgentRouteIdentity,
  type AgentRouteSelection,
  type AgentRouteTab,
} from "../agent-route.ts";
import {
  navigationSearch,
  shouldHandleClientNavigation,
} from "../navigation-target.ts";

type AgentTab = AgentRouteTab;

const RAFT_AGENT_TABS: ReadonlyArray<{
  icon: string;
  id: AgentTab;
  label: string;
}> = [
  { icon: "pulse", id: "activity", label: "动态" },
  { icon: "bot", id: "profile", label: "资料" },
  { icon: "chat", id: "chat", label: "聊天" },
  { icon: "bell", id: "reminders", label: "提醒" },
  { icon: "folder-open", id: "workspace", label: "工作区" },
  { icon: "link-2", id: "apps", label: "应用" },
  { icon: "blocks", id: "mcp", label: "MCP" },
];

type OfficialAvatarPack = {
  palette: Record<string, string>;
  presets: Record<string, { background: string; grid: string[] }>;
};

const OFFICIAL_AVATAR_PACK = avatarPack as OfficialAvatarPack;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 240;

export function AgentDirectoryPane({
  initialAgentDefinitionId,
  initialTab,
  panel = false,
  onClose,
  agents,
  canCreate,
  canManage,
  canMessage,
  canReadManagedMcp,
  client,
  computerLabel,
  computerStatus,
  controlRoomId,
  currentHuman,
  onCreate,
  onManage,
  onEditRuntime,
  onResetExecution,
  onSaveProfile,
  onOpenDirectRoom,
  onOpenMessage,
  onOpenRoom,
  onRouteChange,
  runtimes,
}: {
  initialAgentDefinitionId?: string | undefined;
  initialTab?: AgentTab;
  panel?: boolean;
  onClose?: () => void;
  agents: readonly WorkspaceAgentView[];
  canCreate: boolean;
  canManage: boolean;
  canMessage: boolean;
  canReadManagedMcp: boolean;
  client: RahClient;
  computerLabel: string | undefined;
  computerStatus?: WorkspaceAgentView["connectionStatus"];
  controlRoomId: string | undefined;
  currentHuman: Principal | undefined;
  onCreate: () => void;
  onManage: (agentDefinitionId: string) => void;
  onEditRuntime: (agentDefinitionId: string) => void;
  onResetExecution?:
    | ((
        agentDefinitionId: string,
        mode: AgentExecutionResetMode,
      ) => Promise<void>)
    | undefined;
  onSaveProfile?: (input: AgentProfileEditInput) => Promise<void>;
  onOpenDirectRoom: (peerPrincipalId: string) => Promise<void>;
  onOpenMessage: (
    target: Extract<NavigationTarget, { kind: "message" }>,
  ) => void;
  onOpenRoom: (roomId: string) => void;
  onRouteChange?:
    | ((
        selection: AgentRouteSelection,
        options?: { replace?: boolean },
      ) => void)
    | undefined;
  runtimes: readonly LocalRuntimeInventoryEntry[];
}) {
  const [selectedAgentDefinitionId, setSelectedAgentDefinitionId] = useState<
    string | undefined
  >(initialAgentDefinitionId);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [tab, setTab] = useState<AgentTab>(
    initialTab ?? (panel ? "activity" : "profile"),
  );
  const panelTrigger = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const closePanel = useRef(onClose);
  closePanel.current = onClose;
  useEffect(() => {
    if (!panel) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector('[aria-modal="true"]')
      )
        return;
      event.preventDefault();
      closePanel.current?.();
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      panelTrigger.current?.focus();
    };
  }, [panel]);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const profilePanelWidth = useProfilePanelWidth();
  const [resizing, setResizing] = useState(false);
  const resizeOrigin = useRef<{ clientX: number; width: number } | undefined>(
    undefined,
  );
  const [agentDetail, setAgentDetail] = useState<ClientAgentGetResponse>();
  const [agentDetailError, setAgentDetailError] = useState<string>();
  const [agentDetailLoading, setAgentDetailLoading] = useState(false);
  const [mcpCalls, setMcpCalls] = useState<ManagedMcpUsageRecord[]>([]);
  const [mcpServers, setMcpServers] = useState<ManagedMcpServerRecord[]>([]);
  const [mcpAssignments, setMcpAssignments] = useState<
    ManagedMcpAssignmentRecord[]
  >([]);
  const [mcpCursor, setMcpCursor] = useState<string>();
  const [mcpError, setMcpError] = useState<string>();
  const [mcpLoading, setMcpLoading] = useState(false);
  const [agentRooms, setAgentRooms] = useState<Room[]>([]);
  const [agentRoomsError, setAgentRoomsError] = useState<string>();
  const [agentRoomsLoading, setAgentRoomsLoading] = useState(false);
  const [directRoomError, setDirectRoomError] = useState<string>();
  const [directRoomOpening, setDirectRoomOpening] = useState(false);
  const [agentActivities, setAgentActivities] = useState<
    RuntimeTrajectoryRecord[]
  >([]);
  const [agentActivityCursor, setAgentActivityCursor] = useState<string>();
  const [agentActivityError, setAgentActivityError] = useState<string>();
  const [agentActivityLoading, setAgentActivityLoading] = useState(false);
  const [activityHistory, setActivityHistory] = useState(false);
  const [activityReload, setActivityReload] = useState(0);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [remindersError, setRemindersError] = useState<string>();
  const [remindersLoading, setRemindersLoading] = useState(false);
  const [remindersReload, setRemindersReload] = useState(0);
  const activityScope = useRef<AbortController | undefined>(undefined);
  const activityHistoryRef = useRef(false);
  const selectedAgent = agents.find(
    ({ agentDefinitionId }) => agentDefinitionId === selectedAgentDefinitionId,
  );
  const detailAgentId = selectedAgent?.agentDefinitionId;
  const detailRevisionId = selectedAgent?.agentDefinitionRevisionId;
  const detailPolicyId = selectedAgent?.executionPolicyRevisionId;
  const detailAgentState = selectedAgent?.state;
  const detailParticipantId = selectedAgent?.participantId;
  const visibleAgentDetail =
    agentDetail?.agent.definition.agentDefinitionId === detailAgentId
      ? agentDetail
      : undefined;
  const selectedRuntimes = useMemo(
    () =>
      selectedAgent === undefined
        ? []
        : runtimes.filter((runtime) =>
            runtime.agentBindings.some(
              ({ agentDefinitionId }) =>
                agentDefinitionId === selectedAgent.agentDefinitionId,
            ),
          ),
    [runtimes, selectedAgent],
  );
  const mcpServerViews = useMemo(
    () => projectAgentMcpServers(mcpServers, mcpAssignments, mcpCalls),
    [mcpAssignments, mcpCalls, mcpServers],
  );

  useEffect(() => {
    if (!panel && initialAgentDefinitionId !== undefined) {
      setSelectedAgentDefinitionId(initialAgentDefinitionId);
    }
  }, [initialAgentDefinitionId, panel]);

  useEffect(() => {
    if (!panel && initialTab !== undefined) setTab(initialTab);
  }, [initialTab, panel]);

  useEffect(() => {
    const resolution = reconcileAgentRouteIdentity(
      selectedAgentDefinitionId,
      agents.map(({ agentDefinitionId }) => agentDefinitionId),
    );
    if (!resolution.replace) return;
    setSelectedAgentDefinitionId(resolution.agentDefinitionId);
    setTab("profile");
    if (!panel) {
      onRouteChange?.(
        {
          agentDefinitionId: resolution.agentDefinitionId,
          tab: "profile",
        },
        { replace: true },
      );
    }
  }, [agents, onRouteChange, panel, selectedAgentDefinitionId]);

  useEffect(() => {
    if (detailAgentId === undefined) {
      setAgentDetail(undefined);
      setAgentDetailError(undefined);
      return;
    }
    const controller = new AbortController();
    setAgentDetailError(undefined);
    setAgentDetailLoading(true);
    void client
      .request(
        "agent.get",
        { agentDefinitionId: detailAgentId },
        { signal: controller.signal },
      )
      .then((response) => {
        if (!controller.signal.aborted) setAgentDetail(response);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setAgentDetailError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setAgentDetailLoading(false);
      });
    return () => controller.abort();
  }, [
    client,
    detailAgentId,
    detailRevisionId,
    detailPolicyId,
    detailAgentState,
  ]);

  useEffect(() => {
    if (tab !== "chat" || detailAgentId === undefined) return;
    const controller = new AbortController();
    setAgentRooms([]);
    setAgentRoomsError(undefined);
    setAgentRoomsLoading(true);
    void client
      .request(
        "agent.room.list",
        { agentDefinitionId: detailAgentId },
        { signal: controller.signal },
      )
      .then((response) => {
        if (!controller.signal.aborted) setAgentRooms(response.rooms);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setAgentRoomsError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setAgentRoomsLoading(false);
      });
    return () => controller.abort();
  }, [client, detailAgentId, remindersReload, tab]);

  useEffect(() => {
    if (tab !== "reminders" || detailAgentId === undefined) return;
    const controller = new AbortController();
    let polling = false;
    setReminders([]);
    setRemindersError(undefined);
    setRemindersLoading(true);
    const refresh = async (initial: boolean): Promise<void> => {
      if (polling || controller.signal.aborted) return;
      polling = true;
      try {
        const response = await client.request(
          "agent.reminder.list",
          { agentDefinitionId: detailAgentId, status: "scheduled" },
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setReminders(response.reminders);
          setRemindersError(undefined);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setRemindersError(errorMessage(error));
        }
      } finally {
        polling = false;
        if (initial && !controller.signal.aborted) {
          setRemindersLoading(false);
        }
      }
    };
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), 2_000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [client, detailAgentId, tab]);

  useEffect(() => {
    const agentDefinitionId = selectedAgent?.agentDefinitionId;
    if (tab !== "activity" || agentDefinitionId === undefined) return;
    const controller = new AbortController();
    activityScope.current = controller;
    activityHistoryRef.current = false;
    setActivityHistory(false);
    let polling = false;
    setAgentActivities([]);
    setAgentActivityCursor(undefined);
    setAgentActivityError(undefined);
    setAgentActivityLoading(true);
    const refresh = async (initial: boolean): Promise<void> => {
      if (polling || controller.signal.aborted || activityHistoryRef.current)
        return;
      polling = true;
      try {
        const response = await client.request(
          "agent.trajectory.list",
          { agentDefinitionId, limit: 50 },
          { signal: controller.signal },
        );
        if (controller.signal.aborted || activityHistoryRef.current) return;
        // Poll a complete bounded tail; do not stitch two non-contiguous pages.
        setAgentActivities(mergeTrajectoryWindow([], response.activities));
        setAgentActivityCursor(response.nextCursor);
        setAgentActivityError(undefined);
      } catch (error) {
        if (!controller.signal.aborted) {
          setAgentActivityError(errorMessage(error));
        }
      } finally {
        polling = false;
        if (initial && !controller.signal.aborted) {
          setAgentActivityLoading(false);
        }
      }
    };
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), 2_000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [client, selectedAgent?.agentDefinitionId, tab, activityReload]);

  useEffect(() => {
    if (
      tab !== "mcp" ||
      !canReadManagedMcp ||
      controlRoomId === undefined ||
      detailParticipantId === undefined
    ) {
      return;
    }
    const controller = new AbortController();
    setMcpCalls([]);
    setMcpServers([]);
    setMcpAssignments([]);
    setMcpCursor(undefined);
    setMcpError(undefined);
    setMcpLoading(true);
    void Promise.all([
      client.request(
        "managedMcp.usage.list",
        {
          controlRoomId,
          limit: 50,
          participantId: detailParticipantId,
        },
        { signal: controller.signal },
      ),
      client.request(
        "managedMcp.server.list",
        { controlRoomId },
        { signal: controller.signal },
      ),
      client.request(
        "managedMcp.assignment.list",
        { controlRoomId, participantId: detailParticipantId },
        { signal: controller.signal },
      ),
    ])
      .then(([usage, serverCatalog, assignmentCatalog]) => {
        if (controller.signal.aborted) return;
        setMcpCalls(usage.calls);
        setMcpCursor(usage.nextCursor);
        setMcpServers(serverCatalog.servers);
        setMcpAssignments(assignmentCatalog.assignments);
        setMcpError(undefined);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setMcpError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setMcpLoading(false);
      });
    return () => controller.abort();
  }, [canReadManagedMcp, client, controlRoomId, detailParticipantId, tab]);

  async function loadEarlierMcpUsage(): Promise<void> {
    if (
      mcpCursor === undefined ||
      controlRoomId === undefined ||
      selectedAgent === undefined
    ) {
      return;
    }
    setMcpLoading(true);
    setMcpError(undefined);
    try {
      const response = await client.request("managedMcp.usage.list", {
        beforeCallId: mcpCursor,
        controlRoomId,
        limit: 50,
        participantId: selectedAgent.participantId,
      });
      setMcpCalls((current) => [...current, ...response.calls]);
      setMcpCursor(response.nextCursor);
    } catch (error) {
      setMcpError(errorMessage(error));
    } finally {
      setMcpLoading(false);
    }
  }

  async function loadEarlierAgentActivity(): Promise<void> {
    const controller = activityScope.current;
    if (
      agentActivityCursor === undefined ||
      selectedAgent === undefined ||
      agentActivityLoading ||
      controller === undefined ||
      controller.signal.aborted
    ) {
      return;
    }
    activityHistoryRef.current = true;
    setActivityHistory(true);
    setAgentActivityLoading(true);
    setAgentActivityError(undefined);
    try {
      const response = await client.request(
        "agent.trajectory.list",
        {
          agentDefinitionId: selectedAgent.agentDefinitionId,
          beforeActivityId: agentActivityCursor,
          limit: 50,
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setAgentActivities((current) =>
        mergeTrajectoryWindow(current, response.activities),
      );
      setAgentActivityCursor(response.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted)
        setAgentActivityError(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setAgentActivityLoading(false);
    }
  }

  function selectAgent(agentDefinitionId: string): void {
    setSelectedAgentDefinitionId(agentDefinitionId);
    setTab("profile");
    if (!panel) onRouteChange?.({ agentDefinitionId, tab: "profile" });
    setDirectRoomError(undefined);
    setMobileDetailOpen(true);
  }

  function selectTab(nextTab: AgentTab): void {
    setTab(nextTab);
    if (!panel && selectedAgent !== undefined) {
      onRouteChange?.({
        agentDefinitionId: selectedAgent.agentDefinitionId,
        tab: nextTab,
      });
    }
  }

  async function openSelectedDirectRoom(): Promise<void> {
    if (selectedAgent === undefined || directRoomOpening || !canMessage) return;
    setTab("chat");
    setDirectRoomError(undefined);
    setDirectRoomOpening(true);
    try {
      await onOpenDirectRoom(selectedAgent.participantId);
    } catch (error) {
      setDirectRoomError(errorMessage(error));
    } finally {
      setDirectRoomOpening(false);
    }
  }

  function onResizePointerDown(event: PointerEvent<HTMLDivElement>): void {
    resizeOrigin.current = { clientX: event.clientX, width: sidebarWidth };
    setResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onResizePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const origin = resizeOrigin.current;
    if (origin === undefined) return;
    setSidebarWidth(
      clampSidebarWidth(origin.width + event.clientX - origin.clientX),
    );
  }

  function onResizePointerEnd(event: PointerEvent<HTMLDivElement>): void {
    resizeOrigin.current = undefined;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onResizeKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Home") {
      event.preventDefault();
      setSidebarWidth(MIN_SIDEBAR_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      setSidebarWidth(MAX_SIDEBAR_WIDTH);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      setSidebarWidth((current) =>
        clampSidebarWidth(current + direction * (event.shiftKey ? 32 : 8)),
      );
    }
  }

  const rootStyle = {
    "--rah-agent-sidebar-width": `${sidebarWidth}px`,
    "--rah-agent-profile-panel-width": `${profilePanelWidth.width}px`,
  } as CSSProperties;

  return (
    <main
      className={`channel rah-agent-runtime-page rah-agent-directory-page${panel ? " rah-agent-peek is-mobile-detail-open" : mobileDetailOpen ? " is-mobile-detail-open" : ""}`}
      aria-label={panel ? "Agent 详情侧栏" : "Agent 与成员"}
      style={rootStyle}
    >
      {panel ? (
        <ProfilePanelResizer
          onWidthChange={profilePanelWidth.setWidth}
          onWidthCommit={profilePanelWidth.commit}
          width={profilePanelWidth.width}
        />
      ) : null}
      <section className="rah-agent-directory-body">
        <AgentSidebar
          agents={agents}
          canCreate={canCreate}
          computerLabel={computerLabel}
          computerStatus={computerStatus}
          currentHuman={currentHuman}
          onCreate={onCreate}
          onSelect={selectAgent}
          selectedAgentDefinitionId={selectedAgent?.agentDefinitionId}
        />
        <div
          aria-label="调整成员边栏宽度"
          aria-orientation="vertical"
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuenow={sidebarWidth}
          className={`rah-agent-sidebar-resizer${resizing ? " is-dragging" : ""}`}
          onKeyDown={onResizeKeyDown}
          onPointerCancel={onResizePointerEnd}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerEnd}
          role="separator"
          tabIndex={0}
        />
        {agents.length === 0 ? (
          <p className="rah-empty-copy">
            当前没有可见 AgentDefinition。请先确认 daemon 已探测并启用了真实
            Runtime，然后创建 Workspace Agent。
          </p>
        ) : selectedAgent === undefined ? (
          <p className="rah-agent-selection-empty">选择一个 Agent</p>
        ) : (
          <section className="rah-agent-detail-panel">
            <AgentDetailHeader
              onClose={onClose}
              agent={selectedAgent}
              canMessage={canMessage}
              messagePending={directRoomOpening}
              onBack={() => setMobileDetailOpen(false)}
              onManage={() => onManage(selectedAgent.agentDefinitionId)}
              onMessage={() => void openSelectedDirectRoom()}
            />
            <AgentTabList activeTab={tab} onSelect={selectTab} />
            {tab === "activity" ? (
              <AgentActivityPane
                onOpenRoom={onOpenRoom}
                key={selectedAgent.agentDefinitionId}
                activities={agentActivities}
                agent={selectedAgent}
                error={agentActivityError}
                hasEarlier={agentActivityCursor !== undefined}
                loading={agentActivityLoading}
                onLoadEarlier={() => void loadEarlierAgentActivity()}
                history={activityHistory}
                onLatest={() => setActivityReload((value) => value + 1)}
              />
            ) : tab === "profile" ? (
              <AgentProfilePane
                key={selectedAgent.agentDefinitionId}
                computerLabel={computerLabel}
                onDiagnostics={() => selectTab("activity")}
                agent={selectedAgent}
                canManage={canManage}
                currentHuman={currentHuman}
                detail={visibleAgentDetail}
                error={agentDetailError}
                loading={agentDetailLoading}
                onManage={() => onManage(selectedAgent.agentDefinitionId)}
                onEditRuntime={() =>
                  onEditRuntime(selectedAgent.agentDefinitionId)
                }
                onResetExecution={
                  onResetExecution === undefined
                    ? undefined
                    : (mode) =>
                        onResetExecution(selectedAgent.agentDefinitionId, mode)
                }
                onSaveProfile={onSaveProfile}
                runtimes={selectedRuntimes}
              />
            ) : tab === "chat" ? (
              <AgentChatPane
                agentName={selectedAgent.displayName}
                canMessage={canMessage}
                directError={directRoomError}
                directOpening={directRoomOpening}
                error={agentRoomsError}
                loading={agentRoomsLoading}
                onOpenDirectRoom={() => void openSelectedDirectRoom()}
                onOpenRoom={onOpenRoom}
                rooms={agentRooms}
              />
            ) : tab === "mcp" ? (
              canReadManagedMcp ? (
                <AgentMcpUsagePane
                  error={mcpError}
                  hasEarlier={mcpCursor !== undefined}
                  loading={mcpLoading}
                  onLoadEarlier={() => void loadEarlierMcpUsage()}
                  servers={mcpServerViews}
                />
              ) : (
                <AgentCapabilityPane
                  icon="code-xml"
                  title="MCP 使用记录不可用"
                  description="当前 Human 没有读取该 Workspace MCP 审计投影的权限。"
                />
              )
            ) : tab === "reminders" ? (
              <AgentRemindersPane
                error={remindersError}
                loading={remindersLoading}
                onOpenMessage={onOpenMessage}
                onRetry={() => setRemindersReload((value) => value + 1)}
                reminders={reminders}
              />
            ) : tab === "workspace" ? (
              <AgentWorkspaceBrowser
                key={selectedAgent.agentDefinitionId}
                agentDefinitionId={selectedAgent.agentDefinitionId}
                client={client}
                memoryControls={
                  <AgentMemoryPane
                    agentDefinitionId={selectedAgent.agentDefinitionId}
                    agentName={selectedAgent.displayName}
                    client={client}
                  />
                }
              />
            ) : (
              <AgentUnavailableTab tab={tab} />
            )}
          </section>
        )}
      </section>
    </main>
  );
}

function AgentMemoryPane({
  agentDefinitionId,
  agentName,
  client,
}: {
  agentDefinitionId: string;
  agentName: string;
  client: RahClient;
}) {
  const [memory, setMemory] = useState<ClientAgentMemoryGetResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [selectedPath, setSelectedPath] = useState<string>();
  const [content, setContent] = useState<string>();
  const [contentError, setContentError] = useState<string>();
  const [contentLoading, setContentLoading] = useState(false);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void client
      .request(
        "agent.memory.get",
        { agentDefinitionId },
        { signal: controller.signal },
      )
      .then((response) => {
        if (controller.signal.aborted) return;
        setMemory(response);
        const paths = response.memory.files.map((file) => file.relativePath);
        setSelectedPath((current) =>
          current !== undefined && paths.includes(current) ? current : paths[0],
        );
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [agentDefinitionId, client, reload]);

  useEffect(() => {
    if (selectedPath === undefined) {
      setContent(undefined);
      setContentError(undefined);
      return;
    }
    const controller = new AbortController();
    setContent(undefined);
    setContentError(undefined);
    setContentLoading(true);
    void client
      .request(
        "agent.memory.read",
        { agentDefinitionId, relativePath: selectedPath },
        { signal: controller.signal },
      )
      .then((response) => {
        if (!controller.signal.aborted) setContent(response.content);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setContentError(errorMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setContentLoading(false);
      });
    return () => controller.abort();
  }, [agentDefinitionId, client, selectedPath, reload]);

  async function resetMemory(): Promise<void> {
    setResetting(true);
    setError(undefined);
    try {
      await client.request("agent.memory.reset", {
        agentDefinitionId,
        confirmation: "RESET_AGENT_MEMORY",
        idempotencyKey: browserMemoryMutationId(),
      });
      setResetConfirming(false);
      setSelectedPath(undefined);
      setContent(undefined);
      setReload((current) => current + 1);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setResetting(false);
    }
  }

  return (
    <section className="rah-agent-memory-pane rah-scroll-main">
      <header>
        <div>
          <Icon name="folder" />
          <span>
            <b>Agent 私有记忆</b>
            <small>
              {memory === undefined
                ? "Computer-owned MEMORY.md + notes/"
                : `Computer ${memory.computerHostId}`}
            </small>
          </span>
        </div>
        {memory?.memory.state === "ready" ? (
          <span className="rah-agent-memory-state">
            {memory.memory.indexOverThreshold ? "需要整理" : "正常"}
          </span>
        ) : null}
      </header>
      {error === undefined ? null : (
        <div className="rah-inline-error">{error}</div>
      )}
      {loading && memory === undefined ? (
        <p className="rah-agent-memory-status">正在读取 Agent Memory…</p>
      ) : memory?.memory.state === "absent" ? (
        <div className="rah-agent-memory-empty">
          <Icon name="folder" />
          <h3>尚未建立记忆</h3>
          <p>{agentName} 首次真实运行时会建立 MEMORY.md 与 notes/。</p>
        </div>
      ) : memory?.memory.state === "ready" ? (
        <div className="rah-agent-memory-browser">
          <nav aria-label="Agent Memory 文件">
            {memory.memory.files.map((file) => (
              <button
                aria-current={selectedPath === file.relativePath}
                key={file.relativePath}
                onClick={() => setSelectedPath(file.relativePath)}
                type="button"
              >
                <Icon
                  name={file.relativePath === "MEMORY.md" ? "briefcase" : "doc"}
                />
                <span>
                  <b>{file.relativePath}</b>
                  <small>{formatMemoryBytes(file.bytes)}</small>
                </span>
              </button>
            ))}
          </nav>
          <article>
            <header>
              <b>{selectedPath ?? "选择文件"}</b>
              <small>只读 · UTF-8 · 最大 1 MiB</small>
            </header>
            {contentLoading ? (
              <p>正在读取…</p>
            ) : contentError !== undefined ? (
              <div className="rah-inline-error">{contentError}</div>
            ) : (
              <pre>{content ?? ""}</pre>
            )}
          </article>
        </div>
      ) : null}
      <footer className="rah-agent-memory-danger">
        {resetConfirming ? null : (
          <button
            className="btn"
            onClick={() => setConfigOpen(true)}
            type="button"
          >
            大小提醒设置
          </button>
        )}
        {resetConfirming ? (
          <div role="alert">
            <span>
              <b>重置 {agentName} 的长期记忆？</b>
              <small>
                Memory 与 Provider continuity 将在全局 Agent fence
                内隔离；下一次运行重新初始化。
              </small>
            </span>
            <button
              className="btn"
              disabled={resetting}
              onClick={() => setResetConfirming(false)}
              type="button"
            >
              取消
            </button>
            <button
              className="btn danger"
              disabled={resetting}
              onClick={() => void resetMemory()}
              type="button"
            >
              {resetting ? "正在重置…" : "确认重置"}
            </button>
          </div>
        ) : (
          <button
            className="btn danger"
            disabled={loading || memory === undefined}
            onClick={() => setResetConfirming(true)}
            type="button"
          >
            重置 Agent Memory
          </button>
        )}
      </footer>
      {configOpen ? (
        <AgentMemoryConfigDialog
          agentDefinitionId={agentDefinitionId}
          client={client}
          onClose={() => setConfigOpen(false)}
          onSaved={() => setReload((value) => value + 1)}
        />
      ) : null}
    </section>
  );
}

function browserMemoryMutationId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `memory-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function formatMemoryBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MiB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${String(bytes)} B`;
}

function AgentChatPane({
  agentName,
  canMessage,
  directError,
  directOpening,
  error,
  loading,
  onOpenDirectRoom,
  onOpenRoom,
  rooms,
}: {
  agentName: string;
  canMessage: boolean;
  directError: string | undefined;
  directOpening: boolean;
  error: string | undefined;
  loading: boolean;
  onOpenDirectRoom: () => void;
  onOpenRoom: (roomId: string) => void;
  rooms: readonly Room[];
}) {
  const channels = rooms.filter(({ kind }) => kind === "channel");
  const directMessages = rooms.filter(({ kind }) => kind === "direct");
  return (
    <section className="rah-agent-chat-pane rah-scroll-main">
      <header className="rah-agent-chat-title">
        <h3>频道和私信</h3>
        <button
          className="rah-agent-chat-compose"
          disabled={!canMessage || directOpening}
          onClick={onOpenDirectRoom}
          type="button"
        >
          <Icon name="chat" />
          {directOpening ? "正在打开…" : `给 ${agentName} 发消息`}
        </button>
      </header>
      {directError === undefined ? null : (
        <div className="rah-inline-error">{directError}</div>
      )}
      {error === undefined ? null : (
        <div className="rah-inline-error">{error}</div>
      )}
      {loading && rooms.length === 0 ? (
        <p className="rah-agent-chat-status">正在读取 Agent 聊天目录…</p>
      ) : error !== undefined && rooms.length === 0 ? null : (
        <>
          <AgentChatRoomGroup
            description="该 Agent 可以读取或参与的频道。"
            emptyDescription="频道成员关系将显示在这里。"
            emptyLabel="暂无频道"
            label="频道"
            onOpenRoom={onOpenRoom}
            rooms={channels}
          />
          <AgentChatRoomGroup
            description="包含该 Agent 的直接对话。"
            emptyDescription="最近的 Agent 间私信活动将显示在这里。"
            emptyLabel="暂无 Agent 间私信"
            label="AGENT 私信"
            onOpenRoom={onOpenRoom}
            rooms={directMessages}
          />
        </>
      )}
      <p className="rah-agent-activity-note">
        仅显示你与该 Agent 都具有 canonical membership 的聊天 Room。
      </p>
    </section>
  );
}

function AgentChatRoomGroup({
  description,
  emptyDescription,
  emptyLabel,
  label,
  onOpenRoom,
  rooms,
}: {
  description: string;
  emptyDescription: string;
  emptyLabel: string;
  label: "AGENT 私信" | "频道";
  onOpenRoom: (roomId: string) => void;
  rooms: readonly Room[];
}) {
  return (
    <section className="rah-agent-chat-group">
      <header>
        <h3>{label}</h3>
        <p>{description}</p>
      </header>
      {rooms.length === 0 ? (
        <div className="rah-agent-chat-empty">
          <Icon name="chat" />
          <div>
            <b>{emptyLabel}</b>
            <span>{emptyDescription}</span>
          </div>
        </div>
      ) : (
        <div className="rah-agent-chat-room-list">
          {rooms.map((room) => (
            <button
              aria-label={`打开 ${room.name}`}
              key={room.roomId}
              onClick={() => onOpenRoom(room.roomId)}
            >
              <Icon name={room.kind === "direct" ? "lock" : "hash"} />
              <span>
                <b>{room.name}</b>
                <small>#{room.slug}</small>
              </span>
              <i>{room.kind === "direct" ? "私信" : "频道"}</i>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function AgentSidebar({
  agents,
  canCreate,
  computerLabel,
  computerStatus,
  currentHuman,
  onCreate,
  onSelect,
  selectedAgentDefinitionId,
}: {
  agents: readonly WorkspaceAgentView[];
  canCreate: boolean;
  computerLabel: string | undefined;
  computerStatus?: WorkspaceAgentView["connectionStatus"];
  currentHuman: Principal | undefined;
  onCreate: () => void;
  onSelect: (agentDefinitionId: string) => void;
  selectedAgentDefinitionId: string | undefined;
}) {
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!createMenuOpen) return;
    const closeOutside = (event: globalThis.PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !createMenuRef.current?.contains(event.target)
      ) {
        setCreateMenuOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") setCreateMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [createMenuOpen]);

  return (
    <aside className="rah-agent-directory-list" aria-label="Agent 列表">
      <header className="rah-agent-sidebar-head">
        <h1>成员</h1>
      </header>
      <div className="rah-agent-sidebar-scroll rah-scroll-main">
        <button
          className="rah-agent-relationship"
          disabled
          title="关系图 canonical projection 尚未接入"
        >
          <Icon name="share-2" />
          <span>关系图</span>
        </button>
        <section className="rah-agent-sidebar-section">
          <header>
            <Icon name="chevron" />
            <b>AGENT</b>
            <span>{agents.length}</span>
            <div className="rah-agent-create-control" ref={createMenuRef}>
              <button
                aria-expanded={createMenuOpen}
                aria-haspopup="menu"
                aria-label="添加 Agent"
                className="rah-interaction-flat"
                disabled={!canCreate}
                onClick={() => setCreateMenuOpen((current) => !current)}
                title={
                  canCreate ? "添加 Agent" : "当前 Workspace 不允许创建 Agent"
                }
              >
                +
              </button>
              {createMenuOpen ? (
                <div className="rah-agent-create-menu" role="menu">
                  <button
                    onClick={() => {
                      setCreateMenuOpen(false);
                      onCreate();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Icon name="briefcase" />
                    创建 Agent
                  </button>
                  <button
                    disabled
                    role="menuitem"
                    title="外部 Agent 激活协议尚未接入"
                    type="button"
                  >
                    <Icon name="link" />
                    创建外部 Agent
                  </button>
                </div>
              ) : null}
            </div>
          </header>
          {computerLabel === undefined ? null : (
            <p className="rah-agent-computer-label">
              <i
                data-online={computerStatus === "online"}
                title={computerStatusLabel(
                  computerStatus ? { status: computerStatus } : undefined,
                )}
              />
              {computerLabel}
            </p>
          )}
          {agents.map((agent) => (
            <button
              aria-current={
                agent.agentDefinitionId === selectedAgentDefinitionId
                  ? "page"
                  : undefined
              }
              className={`rah-agent-member-row rah-interaction-row${agent.agentDefinitionId === selectedAgentDefinitionId ? " is-selected" : ""}`}
              key={agent.agentDefinitionId}
              onClick={() => onSelect(agent.agentDefinitionId)}
            >
              <AgentAvatar agent={agent} size="sidebar" />
              <span>
                <b>{agent.displayName}</b>
                <small>
                  {agent.description}
                  {agent.state === "disabled" ? " · 已暂停" : null}
                </small>
              </span>
            </button>
          ))}
        </section>
        <section className="rah-agent-sidebar-section rah-agent-human-section">
          <header>
            <Icon name="chevron" />
            <b>人类</b>
            <span>{currentHuman === undefined ? 0 : 1}</span>
          </header>
          {currentHuman === undefined ? null : (
            <div className="rah-agent-human-row">
              <span className="rah-agent-human-avatar" aria-hidden="true">
                {currentHuman.handle.slice(0, 1).toUpperCase()}
              </span>
              <b>{currentHuman.handle}</b>
              <small>（你）</small>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

function AgentDetailHeader({
  onClose,
  agent,
  canMessage,
  messagePending,
  onBack,
  onManage,
  onMessage,
}: {
  onClose?: (() => void) | undefined;
  agent: WorkspaceAgentView;
  canMessage: boolean;
  messagePending: boolean;
  onBack: () => void;
  onManage: () => void;
  onMessage: () => void;
}) {
  return (
    <header className="rah-agent-detail-head">
      <button
        aria-label="返回成员列表"
        className="sq-btn rah-agent-mobile-back"
        onClick={onBack}
      >
        <Icon name="arrow-left" />
      </button>
      <AgentAvatar agent={agent} size="header" />
      <div className="rah-agent-detail-identity">
        <h2>{agent.displayName}</h2>
        {agent.description && <p>{agent.description}</p>}
      </div>
      <div className="rah-agent-head-actions">
        <button
          aria-label={`给 ${agent.displayName} 发消息`}
          className="sq-btn rah-agent-header-message"
          disabled={!canMessage || messagePending}
          onClick={onMessage}
          title="聊天"
        >
          <Icon name="chat" />
        </button>
        <button
          aria-label={`管理 ${agent.displayName}`}
          className="sq-btn"
          onClick={onManage}
          title="Agent 菜单"
        >
          <span className="rah-agent-overflow-glyph" aria-hidden="true">
            ⋮
          </span>
        </button>
        {onClose ? (
          <button
            className="sq-btn"
            aria-label="关闭 Agent 侧栏"
            onClick={onClose}
          >
            ×
          </button>
        ) : null}
      </div>
    </header>
  );
}

function AgentTabList({
  activeTab,
  onSelect,
}: {
  activeTab: AgentTab;
  onSelect: (tab: AgentTab) => void;
}) {
  function onTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % RAFT_AGENT_TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + RAFT_AGENT_TABS.length) % RAFT_AGENT_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = RAFT_AGENT_TABS.length - 1;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = RAFT_AGENT_TABS[nextIndex];
    if (next === undefined) return;
    onSelect(next.id);
    const tabs =
      event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
        '[role="tab"]',
      );
    tabs?.[nextIndex]?.focus();
  }

  return (
    <div className="rah-agent-tabs-frame">
      <div
        aria-label="Agent 详情"
        className="tabs rah-agent-detail-tabs"
        role="tablist"
      >
        {RAFT_AGENT_TABS.map((item, index) => (
          <button
            aria-selected={activeTab === item.id}
            className={`tab${activeTab === item.id ? " is-active" : ""}`}
            key={item.id}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
            role="tab"
            tabIndex={activeTab === item.id ? 0 : -1}
          >
            <Icon name={item.icon} />
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AgentProfilePane({
  computerLabel,
  onDiagnostics,
  agent,
  canManage,
  currentHuman,
  detail,
  error,
  loading,
  onManage,
  onEditRuntime,
  onResetExecution,
  onSaveProfile,
  runtimes,
}: {
  computerLabel: string | undefined;
  onDiagnostics: () => void;
  agent: WorkspaceAgentView;
  canManage: boolean;
  currentHuman: Principal | undefined;
  detail: ClientAgentGetResponse | undefined;
  error: string | undefined;
  loading: boolean;
  onManage: () => void;
  onEditRuntime: () => void;
  onResetExecution?:
    ((mode: AgentExecutionResetMode) => Promise<void>) | undefined;
  onSaveProfile?: ((input: AgentProfileEditInput) => Promise<void>) | undefined;
  runtimes: readonly LocalRuntimeInventoryEntry[];
}) {
  const [resetOpen, setResetOpen] = useState(false);
  const runtime = runtimes[0];
  const bindingId = detail?.policy.modelIntent.exactBindingIds?.[0];
  const binding = runtime?.modelBindingDescriptors.find(
    ({ modelBindingId }) => modelBindingId === bindingId,
  );
  const model =
    binding?.displayName ??
    binding?.modelId ??
    bindingId ??
    detail?.policy.modelIntent.capabilityClass ??
    "Runtime 默认";
  const reasoning = detail?.policy.modelIntent.reasoning;
  const creator =
    currentHuman?.principalId === agent.createdBy
      ? currentHuman.handle
      : agent.createdBy;
  return (
    <section className="rah-agent-profile-pane rah-scroll-main">
      <AgentProfileAvatarEditor
        agent={agent}
        canManage={canManage}
        onSaveProfile={onSaveProfile}
      >
        <div className="rah-agent-profile-identity">
          <div className="rah-agent-profile-heading">
            <h3 title={agent.displayName}>{agent.displayName}</h3>
            <span className="rah-agent-online-state">
              <AgentStatusDot
                className="rah-agent-profile-presence"
                {...agentPresencePresentation(agent)}
              />
              {agentAvailabilityLabel(agent)}
            </span>
          </div>
          <p>@{agent.handle}</p>
        </div>
      </AgentProfileAvatarEditor>
      <AgentProfileFieldEditor
        agentDefinitionId={agent.agentDefinitionId}
        revisionId={agent.agentDefinitionRevisionId}
        field="displayName"
        value={agent.displayName}
        onSave={canManage ? onSaveProfile : undefined}
      />
      <AgentProfileFieldEditor
        agentDefinitionId={agent.agentDefinitionId}
        revisionId={agent.agentDefinitionRevisionId}
        field="description"
        value={agent.description ?? ""}
        onSave={canManage ? onSaveProfile : undefined}
      />
      <section className="rah-agent-profile-section rah-agent-info-section">
        <h3>信息</h3>
        <AgentRolePermissions role={detail?.membershipRole} />
        <dl className="rah-agent-info-grid">
          <div>
            <dt>计算机</dt>
            <dd>{computerLabel ?? "未绑定"}</dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>{formatProfileDate(agent.createdAt)}</dd>
          </div>
          <div>
            <dt>创建者</dt>
            <dd>{creator}</dd>
          </div>
        </dl>
      </section>
      <section className="rah-agent-profile-section rah-agent-runtime-section">
        <h3>
          运行时配置{" "}
          <button
            className="rah-profile-edit rah-interaction-flat"
            aria-label="编辑运行时配置"
            disabled={!canManage}
            onClick={onEditRuntime}
          >
            <Icon name="pencil" />
          </button>
        </h3>
        {loading && detail === undefined ? (
          <p className="rah-agent-profile-status">正在读取 canonical 配置…</p>
        ) : detail !== undefined ? (
          <div className="rah-agent-runtime-chips">
            <ProfileChip
              label="运行时"
              tone="cyan"
              value={runtime?.displayName ?? "未绑定"}
              onEdit={canManage ? onEditRuntime : undefined}
            />
            <ProfileChip
              label="模型"
              tone="lavender"
              value={model}
              onEdit={canManage ? onEditRuntime : undefined}
            />
            <ProfileChip
              label="推理强度"
              tone="yellow"
              value={
                !reasoning || reasoning === "default"
                  ? "默认"
                  : (runtimeReasoningOptions(runtime, bindingId).find(
                      (option) => option.value === reasoning,
                    )?.label ?? reasoning)
              }
              onEdit={canManage ? onEditRuntime : undefined}
            />
          </div>
        ) : (
          <p className="rah-agent-profile-status is-error">
            {error ?? "配置尚未加载"}
          </p>
        )}
        {error && detail !== undefined ? (
          <p role="alert" className="rah-agent-profile-status is-error">
            刷新失败：{error}（保留上次配置）
          </p>
        ) : null}
      </section>
      <section className="rah-agent-profile-section rah-agent-created-section">
        <h3>已创建的 AGENT</h3>
        <p className="rah-agent-profile-status">
          暂不支持查看 Agent 创建的成员。
        </p>
      </section>
      <section className="rah-agent-profile-section rah-agent-skills-section">
        <h3>
          技能 <span>({agent.skillRefs.length})</span>
        </h3>
        {agent.skillRefs.length === 0 ? (
          <p className="rah-agent-profile-status">该 Agent 尚未绑定 Skill。</p>
        ) : (
          <div className="rah-agent-skill-list">
            {agent.skillRefs.map((skill) => (
              <article key={`${skill.artifactId}:${skill.versionId}`}>
                <b>{skill.artifactId}</b>
                <span>{skill.versionId}</span>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="rah-agent-profile-section rah-agent-actions-section">
        <h3>操作</h3>
        <div className="rah-agent-profile-actions">
          <button
            className="rah-interaction-brutal"
            disabled={!canManage}
            onClick={onManage}
          >
            <Icon name="settings" />
            管理 Agent
          </button>
          <button
            className="rah-interaction-brutal"
            disabled={!canManage || onResetExecution === undefined}
            onClick={() => setResetOpen(true)}
            title={
              onResetExecution === undefined
                ? "当前 daemon 未开放安全重启与会话重置"
                : "选择重新启动或清除 Provider 会话后重启"
            }
          >
            <Icon name="rotate-ccw" />
            重启 / 重置
          </button>
          <button
            className="rah-interaction-brutal"
            onClick={onDiagnostics}
            title="打开跨 Room 动态，在活动诊断中导出元数据"
          >
            <Icon name="pulse" />
            查看活动诊断
          </button>
          <button
            className="rah-interaction-brutal is-orange is-unavailable"
            disabled
            title="暂不可用：本地问题报告流程尚未接入，不会向 Raft 发送数据"
          >
            <Icon name="bug" />
            报告问题
            <small>暂不可用</small>
          </button>
          <button
            className="rah-interaction-brutal is-red"
            disabled={!canManage}
            onClick={onManage}
            title="打开管理窗口；须先暂停并确认无在途工作后才能删除"
          >
            <Icon name="trash-2" />
            删除 Agent
          </button>
        </div>
      </section>
      {resetOpen && onResetExecution !== undefined ? (
        <AgentExecutionResetDialog
          agentName={agent.displayName}
          onClose={() => setResetOpen(false)}
          onConfirm={onResetExecution}
        />
      ) : null}
    </section>
  );
}

function AgentProfileAvatarEditor({
  agent,
  canManage,
  children,
  onSaveProfile,
}: {
  agent: WorkspaceAgentView;
  canManage: boolean;
  children: ReactNode;
  onSaveProfile?: ((input: AgentProfileEditInput) => Promise<void>) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerId = `rah-agent-avatar-picker-${agent.agentDefinitionId}`;
  const currentAvatarKey = officialAgentAvatarKey(
    agent.avatarKey,
    agent.participantId,
  );
  const revisionId = agent.agentDefinitionRevisionId;
  const editable =
    canManage && onSaveProfile !== undefined && revisionId !== undefined;

  function closePicker(): void {
    setOpen(false);
    setError(undefined);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    const closeAvatarPickerOnEscape = (
      event: globalThis.KeyboardEvent,
    ): void => {
      if (event.key !== "Escape" || pending) return;
      event.preventDefault();
      event.stopPropagation();
      closePicker();
    };
    document.addEventListener("keydown", closeAvatarPickerOnEscape, {
      capture: true,
    });
    return () => {
      document.removeEventListener("keydown", closeAvatarPickerOnEscape, {
        capture: true,
      });
    };
  }, [open, pending]);

  async function selectAvatar(avatarKey: string): Promise<void> {
    if (!editable || pending || revisionId === undefined) return;
    if (avatarKey === currentAvatarKey) {
      closePicker();
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      await onSaveProfile({
        agentDefinitionId: agent.agentDefinitionId,
        expectedRevisionId: revisionId,
        field: "avatarKey",
        value: avatarKey,
      });
      closePicker();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="rah-agent-profile-hero">
        {editable ? (
          <button
            aria-controls={pickerId}
            aria-expanded={open}
            aria-label={`更换 ${agent.displayName} 头像`}
            aria-busy={pending}
            className="rah-agent-profile-avatar-trigger"
            disabled={pending}
            onClick={() => {
              setError(undefined);
              setOpen((current) => !current);
            }}
            ref={triggerRef}
            title="更换头像"
            type="button"
          >
            <AgentAvatar agent={agent} size="profile" />
            <span className="rah-agent-profile-avatar-edit" aria-hidden="true">
              <Icon name="pencil" />
            </span>
          </button>
        ) : (
          <AgentAvatar agent={agent} size="profile" />
        )}
        {children}
      </div>
      {editable && open ? (
        <section
          aria-label="选择头像"
          className="rah-agent-avatar-picker"
          id={pickerId}
        >
          <h3>选择头像</h3>
          <div aria-label="官方 Agent 头像" role="group">
            <button
              aria-label="上传图片暂不可用"
              className="rah-agent-avatar-upload"
              disabled
              title="上传图片暂不可用"
              type="button"
            >
              <span aria-hidden="true">⇧</span>
            </button>
            {OFFICIAL_AGENT_AVATAR_KEYS.map((avatarKey) => (
              <button
                aria-pressed={avatarKey === currentAvatarKey}
                aria-label={`选择头像 ${avatarKey}`}
                className="rah-agent-avatar-choice"
                data-selected={avatarKey === currentAvatarKey}
                disabled={pending}
                key={avatarKey}
                onClick={() => void selectAvatar(avatarKey)}
                title={avatarKey}
                type="button"
              >
                <AgentAvatar agent={{ ...agent, avatarKey }} size="header" />
              </button>
            ))}
          </div>
          {error ? (
            <p className="rah-agent-profile-status is-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function ProfileChip({
  label,
  tone,
  value,
  onEdit,
}: {
  label: string;
  tone: "cyan" | "lavender" | "orange" | "yellow";
  value: string;
  onEdit?: (() => void) | undefined;
}) {
  return (
    <div>
      <span>{label}</span>
      {onEdit ? (
        <button
          className="rah-profile-chip-edit"
          aria-label={`编辑${label}`}
          title={`编辑${label}`}
          onClick={onEdit}
        >
          <strong className={`is-${tone}`}>{value}</strong>
        </button>
      ) : (
        <strong className={`is-${tone}`}>{value}</strong>
      )}
    </div>
  );
}

function AgentActivityPane({
  onOpenRoom,
  activities,
  agent,
  error,
  hasEarlier,
  loading,
  onLoadEarlier,
  history,
  onLatest,
}: {
  onOpenRoom: (roomId: string) => void;
  activities: readonly RuntimeTrajectoryRecord[];
  agent: WorkspaceAgentView;
  error: string | undefined;
  hasEarlier: boolean;
  loading: boolean;
  onLoadEarlier: () => void;
  history: boolean;
  onLatest: () => void;
}) {
  const [copyError, setCopyError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const scrollArea = useRef<HTMLElement>(null);
  const followLatest = useRef(true);
  const visibleActivities = useMemo(
    () => projectAgentActivityRows(activities),
    [activities],
  );

  useEffect(() => {
    setCopyError(undefined);
    setCopied(false);
  }, [agent.agentDefinitionId]);

  useEffect(() => {
    const element = scrollArea.current;
    if (element !== null && followLatest.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [visibleActivities.at(-1)?.serverSequence]);

  async function copyDiagnostics(): Promise<void> {
    setCopyError(undefined);
    try {
      await navigator.clipboard.writeText(
        renderAgentActivityDiagnostics(
          {
            agentDefinitionId: agent.agentDefinitionId,
            displayName: agent.displayName,
            handle: agent.handle,
            participantId: agent.participantId,
          },
          activities,
        ),
      );
      setCopied(true);
    } catch (copyFailure) {
      setCopied(false);
      setCopyError(`无法复制诊断信息：${errorMessage(copyFailure)}`);
    }
  }

  return (
    <section
      aria-label={`${agent.displayName} 动态`}
      className="rah-agent-activity-pane rah-scroll-main"
      onScroll={(event) => {
        const element = event.currentTarget;
        followLatest.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < 48;
      }}
      ref={scrollArea}
    >
      <header>
        <div>
          <h3>活动诊断</h3>
          <p>该 Agent 在所有可访问对话中的执行记录</p>
        </div>
        <button
          className="btn"
          disabled={activities.length === 0}
          onClick={() => void copyDiagnostics()}
          title="复制已加载的安全诊断元数据"
        >
          {copied ? "已复制" : "复制诊断信息"}
        </button>
      </header>
      {history && (
        <button className="btn" onClick={onLatest}>
          返回最新动态（历史浏览已暂停自动刷新）
        </button>
      )}
      {error === undefined ? null : (
        <div className="rah-inline-error">{error}</div>
      )}
      {copyError === undefined ? null : (
        <div className="rah-inline-error">{copyError}</div>
      )}
      {loading && activities.length === 0 ? (
        <p className="rah-agent-activity-empty">正在读取活动…</p>
      ) : activities.length === 0 ? (
        <AgentCapabilityPane
          icon="pulse"
          title="暂无活动"
          description="启动 Agent 或在 Room 中向它发送工作后，思考、工具和回复轨迹会显示在这里。"
        />
      ) : (
        <div className="rah-agent-activity-list" aria-live="polite">
          {visibleActivities.map((activity) => (
            <AgentTrajectoryRow
              activity={activity}
              key={activity.activityId}
              onOpenRoom={onOpenRoom}
            />
          ))}
        </div>
      )}
      {hasEarlier ? (
        <button
          className="btn"
          disabled={loading}
          onClick={() => {
            followLatest.current = false;
            onLoadEarlier();
          }}
        >
          {loading ? "正在读取…" : "加载更早记录"}
        </button>
      ) : null}
      <p className="rah-agent-activity-note">
        未运行的 Agent 不会显示其他测试环境的历史。动态来自 Provider
        的结构化事件，不解析 ANSI。Codex 只显示公开 reasoning
        summary，原始思维链不会进入该投影。
      </p>
    </section>
  );
}

function AgentTrajectoryRow({
  activity,
  onOpenRoom,
}: {
  activity: RuntimeTrajectoryRecord;
  onOpenRoom: (roomId: string) => void;
}) {
  const presentation = activityPresentation(activity.entry);
  const detail = presentation.detail;
  const [expanded, setExpanded] = useState(false);
  const collapsible = detail.length > 200;
  const visibleDetail =
    collapsible && !expanded ? `${detail.slice(0, 200)}…` : detail;
  return (
    <article
      className={`is-${agentTrajectoryTone(activity)} is-${activity.entry.kind}`}
    >
      <time>{formatActivityTime(activity.observedAt)}</time>
      <i aria-hidden="true" data-pulse={agentTrajectoryPulses(activity)} />
      <div
        className={`rah-trajectory-content${presentation.block ? " is-narrative" : ""}`}
      >
        <b>{presentation.label}</b>
        {visibleDetail === "" ? null : (
          <span className="rah-trajectory-detail">
            <DiagnosticReferences text={visibleDetail} />
          </span>
        )}
        {collapsible ? (
          <button
            aria-expanded={expanded}
            className="rah-agent-activity-expand"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "收起" : "展开"}
          </button>
        ) : null}
        {activity.context && (
          <small className="rah-trajectory-context">
            对话：
            <a
              href={`?room=${encodeURIComponent(activity.context.roomId)}`}
              onClick={(e) => {
                if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                  e.preventDefault();
                  onOpenRoom(activity.context!.roomId);
                }
              }}
            >
              {activity.context.roomKind === "direct" ? "@" : "#"}
              {activity.context.roomName}
            </a>
          </small>
        )}
      </div>
    </article>
  );
}

function AgentMcpUsagePane({
  error,
  hasEarlier,
  loading,
  onLoadEarlier,
  servers,
}: {
  error: string | undefined;
  hasEarlier: boolean;
  loading: boolean;
  onLoadEarlier: () => void;
  servers: readonly AgentMcpServerView[];
}) {
  return (
    <section className="rah-agent-mcp-pane rah-scroll-main">
      <header>
        <div>
          <h3>MCP</h3>
          <p>已使用的服务器与工具</p>
        </div>
      </header>
      {error === undefined ? null : (
        <div className="rah-inline-error">{error}</div>
      )}
      {loading && servers.length === 0 ? (
        <p className="rah-agent-activity-empty">正在读取 MCP 使用情况…</p>
      ) : servers.length === 0 ? (
        <AgentCapabilityPane
          icon="code-xml"
          title="暂无 MCP 使用记录"
          description="已分配的 MCP 服务器会自动提供给 Agent，调用后显示在这里。"
        />
      ) : (
        <div className="rah-agent-mcp-servers" aria-live="polite">
          {servers.map((server) => (
            <details key={server.mcpServerId}>
              <summary>
                <Icon name="blocks" />
                <span>
                  <b>{server.serverName}</b>
                  <small>
                    上次调用 {formatActivityTime(server.lastUsedAt)} · 共
                    {server.usageCount} 次
                  </small>
                </span>
                <strong
                  className={
                    server.serverEnabled && server.assignmentEnabled
                      ? "is-enabled"
                      : "is-disabled"
                  }
                >
                  {server.serverEnabled && server.assignmentEnabled
                    ? server.failedCount > 0
                      ? `${server.failedCount} 次失败`
                      : "已连接"
                    : "已停用"}
                </strong>
              </summary>
              <div className="rah-agent-mcp-tools">
                {server.tools.map((tool) => (
                  <article
                    key={tool.toolName}
                    title={tool.description ?? tool.title}
                  >
                    <Icon name="code-xml" />
                    <span>
                      <code>{tool.title ?? tool.toolName}</code>
                      {tool.title ? <small>{tool.toolName}</small> : null}
                      {tool.description ? <p>{tool.description}</p> : null}
                    </span>
                    <i>{tool.usageCount} 次</i>
                  </article>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
      {hasEarlier ? (
        <button className="btn" disabled={loading} onClick={onLoadEarlier}>
          {loading ? "正在读取…" : "加载更早记录"}
        </button>
      ) : null}
      <p className="rah-agent-activity-note">
        调用参数、凭据与结果正文不会进入此浏览器投影。
      </p>
    </section>
  );
}

function AgentRemindersPane({
  error,
  loading,
  onOpenMessage,
  onRetry,
  reminders,
}: {
  error: string | undefined;
  loading: boolean;
  onOpenMessage: (
    target: Extract<NavigationTarget, { kind: "message" }>,
  ) => void;
  onRetry: () => void;
  reminders: readonly Reminder[];
}) {
  return (
    <section className="rah-agent-reminders-pane rah-scroll-main">
      {loading ? (
        <p className="rah-agent-reminders-loading">正在读取…</p>
      ) : null}
      {error ? (
        <div className="rah-agent-reminders-error" role="alert">
          <strong>提醒读取失败</strong>
          <span>{error}</span>
          <button className="btn" onClick={onRetry} type="button">
            <Icon name="refresh-cw" />
            重试
          </button>
        </div>
      ) : reminders.length === 0 ? (
        <div className="rah-agent-reminders-empty">
          <Icon name="bell" />
          <strong>暂无提醒</strong>
          <span>该 Agent 尚未安排提醒。</span>
        </div>
      ) : (
        <div className="rah-agent-reminders-list">
          {reminders.map((reminder) => {
            const target = {
              kind: "message",
              messageId: reminder.msgId,
              roomId: reminder.roomId,
              ...(reminder.threadId === undefined
                ? {}
                : { threadId: reminder.threadId }),
              ...(reminder.rootMessageId === undefined
                ? {}
                : { rootMessageId: reminder.rootMessageId }),
            } satisfies Extract<NavigationTarget, { kind: "message" }>;
            return (
              <article key={reminder.reminderId}>
                <div className="rah-agent-reminder-title">
                  <strong>{reminder.title}</strong>
                </div>
                <div className="rah-agent-reminder-meta">
                  <span className="rah-agent-reminder-relative">
                    <Icon name="clock-3" />
                    {relativeReminderTime(reminder.fireAt)}
                  </span>
                  <time dateTime={reminder.fireAt}>
                    {formatReminderDate(reminder.fireAt)}
                  </time>
                  {reminder.recurrence === undefined ? null : (
                    <span
                      className="rah-agent-reminder-recurrence"
                      title={reminder.recurrence.description}
                    >
                      <Icon name="repeat" />
                      {reminder.recurrence.description}
                    </span>
                  )}
                </div>
                <a
                  className="rah-agent-reminder-reference"
                  href={navigationSearch({ target })}
                  onClick={(event) => {
                    if (!shouldHandleClientNavigation(event)) return;
                    event.preventDefault();
                    onOpenMessage(target);
                  }}
                  title={`消息 ${reminder.msgId}`}
                >
                  <Icon name="link-2" />
                  <span>消息 #{reminder.msgId.slice(0, 8)}</span>
                </a>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatReminderDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function relativeReminderTime(value: string): string {
  const deltaSeconds = Math.round(
    (new Date(value).getTime() - Date.now()) / 1_000,
  );
  const absoluteSeconds = Math.abs(deltaSeconds);
  let amount: number;
  let unit: Intl.RelativeTimeFormatUnit;
  if (absoluteSeconds < 60) {
    amount = deltaSeconds;
    unit = "second";
  } else if (absoluteSeconds < 3_600) {
    amount = Math.round(deltaSeconds / 60);
    unit = "minute";
  } else if (absoluteSeconds < 86_400) {
    amount = Math.round(deltaSeconds / 3_600);
    unit = "hour";
  } else {
    amount = Math.round(deltaSeconds / 86_400);
    unit = "day";
  }
  return new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" }).format(
    amount,
    unit,
  );
}

function AgentUnavailableTab({
  tab,
}: {
  tab: Exclude<
    AgentTab,
    "activity" | "chat" | "mcp" | "profile" | "reminders" | "workspace"
  >;
}) {
  const content = {
    apps: {
      description: "Agent 应用目录尚未形成 canonical API。",
      icon: "link",
      title: "暂无应用",
    },
  }[tab];
  return <AgentCapabilityPane {...content} />;
}

function AgentCapabilityPane({
  description,
  icon,
  title,
}: {
  description: string;
  icon: string;
  title: string;
}) {
  return (
    <section className="rah-agent-capability-pane rah-scroll-main">
      <Icon name={icon} />
      <h3>{title}</h3>
      <p>{description}</p>
    </section>
  );
}

export function AgentAvatar({
  agent,
  showStatus = true,
  size,
}: {
  agent: Pick<
    WorkspaceAgentView,
    | "avatarKey"
    | "displayName"
    | "runtimeAvailable"
    | "state"
    | "connectionStatus"
    | "presence"
  > & { participantId?: string };
  showStatus?: boolean;
  size: "header" | "profile" | "sidebar" | "member" | "compact";
}) {
  const preset = agentAvatarPixels(agent.avatarKey, agent.participantId);
  return (
    <span
      aria-label={`${agent.displayName} 头像`}
      className={`rah-agent-avatar is-${size}`}
      role="img"
      style={{ "--rah-avatar-background": preset.background } as CSSProperties}
    >
      <span className="rah-agent-avatar-grid" aria-hidden="true">
        {preset.grid.flatMap((row, y) =>
          [...row].map((paletteKey, x) => {
            const color = OFFICIAL_AVATAR_PACK.palette[paletteKey];
            return color === undefined || color === "transparent" ? null : (
              <i
                key={`${x}:${y}`}
                style={{
                  backgroundColor: color,
                  gridColumn: x + 1,
                  gridRow: y + 1,
                }}
              />
            );
          }),
        )}
      </span>
      {showStatus ? (
        <AgentStatusDot
          className="rah-agent-avatar-presence"
          size={size === "sidebar" ? "sm" : "md"}
          {...agentPresencePresentation(agent)}
        />
      ) : null}
    </span>
  );
}

function clampSidebarWidth(width: number): number {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, width));
}

function formatActivityTime(timestamp: string): string {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime())
    ? timestamp
    : parsed.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

function formatProfileDate(timestamp: string): string {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime())
    ? timestamp
    : new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(parsed);
}

function agentAvailabilityLabel(agent: WorkspaceAgentView): string {
  return agentConnectionLabel(agent);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "无法读取 Agent 数据";
}
