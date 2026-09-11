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
  MembershipRole,
  NavigationTarget,
  Principal,
  Room,
  RuntimeTrajectoryRecord,
  Reminder,
  AgentExecutionResetMode,
} from "@rah-os/protocol";
import { PanelHeaderAction } from "@rah-os/ui-web/neo-brutalist/panel-header-action";
import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { PanelTabs } from "@rah-os/ui-web/neo-brutalist/panel-tabs";
import { EmptyState } from "@rah-os/ui-web/neo-brutalist/empty-state";
import { AgentEntityCard } from "./agent-entity-card.tsx";
import { HumanProfilePane } from "./human-profile-pane.tsx";
import { HumanIdentity } from "./human-identity.tsx";
import { AgentComputerIdentity } from "./computer-identity.tsx";
import { useWorkspaceEntities } from "./workspace-entity-context.tsx";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import { AgentSidebar } from "./agent-sidebar.tsx";
import {
  OFFICIAL_AGENT_AVATAR_KEYS,
  isUploadedProfileImageKey,
  officialAgentAvatarKey,
} from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

import {
  agentTrajectoryTone,
  agentTrajectoryPulses,
  projectAgentActivityRows,
} from "../agent-activity-projection.ts";
import { activityPresentation } from "../identity-presentation.ts";
import {
  agentConnectionLabel,
  agentPresencePresentation,
  computerStatusLabel,
} from "../attention-presentation.ts";
import { mergeTrajectoryWindow } from "../agent-trajectory-window.ts";
import { renderAgentActivityDiagnostics } from "../agent-activity-diagnostics.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { AgentStatusDot } from "./agent-status-dot.tsx";
import { AgentMemoryConfigDialog } from "./agent-memory-config-dialog.tsx";
import { AgentExecutionResetDialog } from "./agent-execution-reset-dialog.tsx";
import { AgentIssueReportDialog } from "./agent-issue-report-dialog.tsx";
import {
  AgentStateDialog,
  type AgentStateChange,
} from "./agent-state-dialog.tsx";
import { AgentRolePermissions } from "./agent-role-permissions.tsx";
import { AgentSkillsSection } from "./agent-skills-section.tsx";
import { AgentProfileFieldEditor } from "./agent-profile-field.tsx";
import type { AgentProfileEditInput } from "../agent-profile-edit.ts";
import { runtimeProfilePresentation } from "../agent-runtime-presentation.ts";
import { formatRahDateTime } from "../date-time-presentation.ts";
import { ProfileSection } from "@rah-os/ui-web/neo-brutalist/profile-section";
import { AgentWorkspaceBrowser } from "./agent-workspace-browser.tsx";
import { AgentAvatar } from "./agent-avatar.tsx";
import { MemberRelationshipSurface } from "./member-relationship-graph.tsx";
import { projectCreatedAgentViews } from "../agent-created-agents.ts";
import { DiagnosticReferences } from "./diagnostic-references.tsx";
import { ProfilePanelResizer } from "./profile-panel-resizer.tsx";
import { useProfilePanelWidth } from "../use-profile-panel-width.ts";
import {
  reconcileAgentRouteIdentity,
  shouldOpenAgentMobileDetail,
  type AgentRouteSelection,
  type AgentRouteTab,
} from "../agent-route.ts";
import {
  navigationSearch,
  shouldHandleClientNavigation,
} from "../navigation-target.ts";
import {
  AGENT_AVATAR_UPLOAD_ACCEPT,
  uploadAgentAvatar,
} from "../agent-avatar-upload.ts";

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
];

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 240;

export function AgentDirectoryPane({
  initialAgentDefinitionId,
  initialHumanPrincipalId,
  initialTab,
  initialView,
  panel = false,
  onClose,
  agents,
  canCreate,
  canManage,
  canMessage,
  canChangeHumanRole,
  client,
  computerLabel,
  computerStatus,
  currentHuman,
  humans,
  humanDirectoryError,
  humanDirectoryLoading,
  humansTruncated,
  onRetryHumans,
  fullResetEnabled,
  onCreate,
  onManage,
  onChangeState,
  onEditRuntime,
  onResetExecution,
  onSaveProfile,
  onChangeHumanRole,
  onOpenDirectRoom,
  onPeekAgent,
  onOpenMessage,
  onOpenRoom,
  onRouteChange,
  workspaceId,
}: {
  initialAgentDefinitionId?: string | undefined;
  initialHumanPrincipalId?: string | undefined;
  initialTab?: AgentTab;
  initialView?: AgentRouteSelection["view"];
  panel?: boolean;
  onClose?: () => void;
  agents: readonly WorkspaceAgentView[];
  canCreate: boolean;
  canManage: boolean;
  canMessage: boolean;
  canChangeHumanRole: boolean;
  client: RahClient;
  computerLabel: string | undefined;
  computerStatus?: WorkspaceAgentView["connectionStatus"];
  currentHuman: Principal | undefined;
  humans: readonly import("@rah-os/protocol").WorkspaceHumanMember[];
  humanDirectoryError?: string | undefined;
  humanDirectoryLoading?: boolean | undefined;
  humansTruncated?: boolean | undefined;
  onRetryHumans?: (() => void) | undefined;
  fullResetEnabled: boolean;
  onCreate: () => void;
  onManage: (agentDefinitionId: string) => void;
  onChangeState?: AgentStateChange | undefined;
  onEditRuntime: (agentDefinitionId: string) => void;
  onResetExecution?:
    | ((
        agentDefinitionId: string,
        mode: AgentExecutionResetMode,
        idempotencyKey: string,
      ) => Promise<void>)
    | undefined;
  onSaveProfile?: (input: AgentProfileEditInput) => Promise<void>;
  onChangeHumanRole: (
    principalId: string,
    role: MembershipRole,
  ) => Promise<void>;
  onPeekAgent?: ((id: string) => void) | undefined;
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
  workspaceId: string | undefined;
}) {
  const entities = useWorkspaceEntities();
  const [selectedAgentDefinitionId, setSelectedAgentDefinitionId] = useState<
    string | undefined
  >(initialAgentDefinitionId);
  const [memberView, setMemberView] = useState<
    "agent" | "relationship" | "human"
  >(!panel && initialView ? initialView : "agent");
  const [humanId, setHumanId] = useState(initialHumanPrincipalId);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(() =>
    shouldOpenAgentMobileDetail({
      humanPrincipalId: initialHumanPrincipalId,
      agentDefinitionId: initialAgentDefinitionId,
      panel,
      view: initialView,
    }),
  );
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
  const [stateAction, setStateAction] = useState<
    "enabled" | "disabled" | "tombstoned"
  >();
  const [headerResetOpen, setHeaderResetOpen] = useState(false);
  const activityScope = useRef<AbortController | undefined>(undefined);
  const activityHistoryRef = useRef(false);
  const selectedAgent =
    memberView !== "agent"
      ? undefined
      : agents.find(
          ({ agentDefinitionId }) =>
            agentDefinitionId === selectedAgentDefinitionId,
        );
  const detailAgentId = selectedAgent?.agentDefinitionId;
  useEffect(() => {
    setStateAction(undefined);
    setHeaderResetOpen(false);
  }, [detailAgentId]);
  const detailRevisionId = selectedAgent?.agentDefinitionRevisionId;
  const detailPolicyId = selectedAgent?.executionPolicyRevisionId;
  const detailAgentState = selectedAgent?.state;
  const visibleAgentDetail =
    agentDetail?.agent.definition.agentDefinitionId === detailAgentId
      ? agentDetail
      : undefined;
  const selectedRuntimes =
    selectedAgent === undefined
      ? []
      : (entities?.runtimesForAgent(selectedAgent.agentDefinitionId) ?? []);
  useEffect(() => {
    if (!panel && initialAgentDefinitionId !== undefined) {
      setSelectedAgentDefinitionId(initialAgentDefinitionId);
    }
  }, [initialAgentDefinitionId, panel]);

  useEffect(() => {
    if (!panel) {
      setMemberView(initialView ?? "agent");
      setHumanId(initialHumanPrincipalId);
      if (initialView === "human") setMobileDetailOpen(true);
    }
  }, [initialView, initialHumanPrincipalId, panel]);

  useEffect(() => {
    if (!panel && initialTab !== undefined) setTab(initialTab);
  }, [initialTab, panel]);

  useEffect(() => {
    if (memberView !== "agent") return;
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
  }, [agents, memberView, onRouteChange, panel, selectedAgentDefinitionId]);

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
    setMemberView("agent");
    setSelectedAgentDefinitionId(agentDefinitionId);
    setTab("profile");
    if (!panel) onRouteChange?.({ agentDefinitionId, tab: "profile" });
    setDirectRoomError(undefined);
    setMobileDetailOpen(true);
  }

  function selectHuman(principalId: string): void {
    if (panel) return;
    setMemberView("human");
    setHumanId(principalId);
    setMobileDetailOpen(true);
    onRouteChange?.({
      agentDefinitionId: undefined,
      humanPrincipalId: principalId,
      tab: "profile",
      view: "human",
    });
  }

  function selectRelationship(): void {
    if (panel) return;
    setMemberView("relationship");
    setMobileDetailOpen(true);
    onRouteChange?.({
      agentDefinitionId: undefined,
      tab: "profile",
      view: "relationship",
    });
  }

  function closeRelationship(): void {
    setMemberView("agent");
    setMobileDetailOpen(false);
    onRouteChange?.({ agentDefinitionId: undefined, tab: "profile" });
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
      className={`channel rah-agent-runtime-page rah-agent-directory-page${memberView === "relationship" && !panel ? " is-relationship-view" : ""}${panel ? " rah-agent-peek is-mobile-detail-open" : mobileDetailOpen ? " is-mobile-detail-open" : ""}`}
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
          currentHumanId={currentHuman?.principalId}
          humans={humans}
          humanDirectoryError={humanDirectoryError}
          humanDirectoryLoading={humanDirectoryLoading}
          humansTruncated={humansTruncated}
          onRetryHumans={onRetryHumans}
          onSelectHuman={selectHuman}
          selectedHumanId={memberView === "human" ? humanId : undefined}
          onCreate={onCreate}
          onRelationship={selectRelationship}
          onSelect={selectAgent}
          relationshipSelected={memberView === "relationship"}
          selectedAgentDefinitionId={
            memberView === "agent"
              ? selectedAgent?.agentDefinitionId
              : undefined
          }
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
        {memberView === "relationship" && !panel ? (
          <MemberRelationshipSurface
            agents={agents}
            client={client}
            onBack={closeRelationship}
            onOpenAgent={selectAgent}
            workspaceId={workspaceId}
          />
        ) : memberView === "human" && humanId && !panel ? (
          <HumanProfilePane
            key={`${workspaceId}:${currentHuman?.principalId}:${humanId}`}
            canChangeRole={canChangeHumanRole}
            client={client}
            onChangeRole={onChangeHumanRole}
            principalId={humanId}
            workspaceId={workspaceId}
            onBack={closeRelationship}
            onOpenAgent={onPeekAgent ?? selectAgent}
          />
        ) : agents.length === 0 ? (
          <p className="rah-empty-copy">
            当前没有可见 AgentDefinition。请先确认 daemon 已探测并启用了真实
            Runtime，然后创建 Workspace Agent。
          </p>
        ) : selectedAgent === undefined ? (
          <p className="rah-agent-selection-empty">选择一个 Agent</p>
        ) : (
          <section className="rah-agent-detail-panel">
            {stateAction && onChangeState && (
              <AgentStateDialog
                key={`${selectedAgent.agentDefinitionId}:${stateAction}`}
                agent={selectedAgent}
                state={stateAction}
                onChange={onChangeState}
                onClose={() => setStateAction(undefined)}
              />
            )}
            {headerResetOpen && onResetExecution && (
              <AgentExecutionResetDialog
                agentName={selectedAgent.displayName}
                fullResetEnabled={fullResetEnabled}
                onClose={() => setHeaderResetOpen(false)}
                onConfirm={(mode, key) =>
                  onResetExecution(selectedAgent.agentDefinitionId, mode, key)
                }
              />
            )}
            <AgentDetailHeader
              onClose={onClose}
              agent={selectedAgent}
              canMessage={canMessage}
              messagePending={directRoomOpening}
              onBack={() => {
                setMobileDetailOpen(false);
                onRouteChange?.({
                  agentDefinitionId: undefined,
                  tab: "profile",
                });
              }}
              onManage={() => onManage(selectedAgent.agentDefinitionId)}
              onStartStop={
                canManage && onChangeState
                  ? () =>
                      setStateAction(
                        selectedAgent.state === "enabled"
                          ? "disabled"
                          : "enabled",
                      )
                  : undefined
              }
              onRestart={
                canManage && onResetExecution
                  ? () => setHeaderResetOpen(true)
                  : undefined
              }
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
                client={client}
                computerLabel={computerLabel}
                onDiagnostics={() => selectTab("activity")}
                agent={selectedAgent}
                canManage={canManage}
                directory={agents}
                detail={visibleAgentDetail}
                error={agentDetailError}
                fullResetEnabled={fullResetEnabled}
                loading={agentDetailLoading}
                onManage={() => onManage(selectedAgent.agentDefinitionId)}
                onStartStop={
                  canManage && onChangeState
                    ? () =>
                        setStateAction(
                          selectedAgent.state === "enabled"
                            ? "disabled"
                            : "enabled",
                        )
                    : undefined
                }
                onDelete={
                  canManage && onChangeState
                    ? () => setStateAction("tombstoned")
                    : undefined
                }
                onEditRuntime={() =>
                  onEditRuntime(selectedAgent.agentDefinitionId)
                }
                onResetExecution={
                  onResetExecution === undefined
                    ? undefined
                    : (mode, idempotencyKey) =>
                        onResetExecution(
                          selectedAgent.agentDefinitionId,
                          mode,
                          idempotencyKey,
                        )
                }
                onSaveProfile={onSaveProfile}
                onSelectAgent={selectAgent}
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
            ) : null}
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

export function AgentDetailHeader({
  onClose,
  agent,
  canMessage,
  messagePending,
  onBack,
  onStartStop,
  onRestart,
  onMessage,
}: {
  onClose?: (() => void) | undefined;
  agent: WorkspaceAgentView;
  canMessage: boolean;
  messagePending: boolean;
  onBack: () => void;
  onManage: () => void;
  onStartStop?: (() => void) | undefined;
  onRestart?: (() => void) | undefined;
  onMessage: () => void;
}) {
  return (
    <PanelHeader kind="agent" className="rah-agent-detail-head">
      <PanelHeaderAction
        aria-label="返回成员列表"
        className="rah-agent-mobile-back"
        onClick={onBack}
      >
        <Icon name="arrow-left" />
      </PanelHeaderAction>
      <AgentAvatar agent={agent} size="header" />
      <div className="rah-agent-detail-identity">
        <h2>{agent.displayName}</h2>
        {agent.description && <p>{agent.description}</p>}
      </div>
      <div className="rah-agent-head-actions">
        <PanelHeaderAction
          aria-label={`给 ${agent.displayName} 发消息`}
          className="rah-agent-header-message"
          disabled={!canMessage}
          pending={messagePending}
          onClick={onMessage}
          title="聊天"
        >
          <Icon name="chat" />
        </PanelHeaderAction>
        <PanelHeaderAction
          aria-label={agent.state === "enabled" ? "停止 Agent" : "启动 Agent"}
          title={agent.state === "enabled" ? "停止 Agent" : "启动 Agent"}
          disabled={onStartStop === undefined}
          onClick={onStartStop}
        >
          <Icon name={agent.state === "enabled" ? "square" : "play"} />
        </PanelHeaderAction>
        <PanelHeaderAction
          aria-label="重启 / 重置"
          title="重启 / 重置"
          disabled={onRestart === undefined}
          onClick={onRestart}
        >
          <Icon name="rotate-ccw" />
        </PanelHeaderAction>
        {onClose ? (
          <PanelHeaderAction aria-label="关闭 Agent 侧栏" onClick={onClose}>
            ×
          </PanelHeaderAction>
        ) : null}
      </div>
    </PanelHeader>
  );
}

export function AgentTabList({
  activeTab,
  onSelect,
}: {
  activeTab: AgentTab;
  onSelect: (tab: AgentTab) => void;
}) {
  return (
    <PanelTabs
      label="Agent 详情"
      className="rah-agent-tabs-frame"
      listClassName="rah-agent-detail-tabs"
      items={RAFT_AGENT_TABS}
      value={activeTab}
      onSelect={onSelect}
    />
  );
}

export function AgentProfilePane({
  client,
  computerLabel,
  onDiagnostics,
  agent,
  canManage,
  directory,
  detail,
  error,
  fullResetEnabled,
  loading,
  onManage,
  onStartStop,
  onDelete,
  onEditRuntime,
  onResetExecution,
  onSaveProfile,
  onSelectAgent,
  runtimes,
}: {
  client: RahClient;
  computerLabel: string | undefined;
  onDiagnostics: () => void;
  agent: WorkspaceAgentView;
  canManage: boolean;
  directory: readonly WorkspaceAgentView[];
  detail: ClientAgentGetResponse | undefined;
  error: string | undefined;
  fullResetEnabled: boolean;
  loading: boolean;
  onManage: () => void;
  onStartStop?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onEditRuntime: () => void;
  onResetExecution?:
    | ((mode: AgentExecutionResetMode, idempotencyKey: string) => Promise<void>)
    | undefined;
  onSaveProfile?: ((input: AgentProfileEditInput) => Promise<void>) | undefined;
  onSelectAgent: (agentDefinitionId: string) => void;
  runtimes: readonly LocalRuntimeInventoryEntry[];
}) {
  const [resetOpen, setResetOpen] = useState(false);
  const [issueReportOpen, setIssueReportOpen] = useState(false);
  const runtimeView = runtimeProfilePresentation(
    runtimes,
    detail?.policy.modelIntent,
    loading ? "loading" : error ? "error" : "ready",
  );
  const creator = detail?.creator;
  const creatorAgent =
    creator?.kind === "agent"
      ? directory.find(
          ({ participantId }) => participantId === creator.principalId,
        )
      : undefined;
  const createdAgents = projectCreatedAgentViews(detail, directory);
  return (
    <section className="rah-agent-profile-pane rah-scroll-main">
      <AgentProfileAvatarEditor
        agent={agent}
        canManage={canManage}
        client={client}
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
      <ProfileSection title="信息" className="rah-agent-info-section">
        <AgentRolePermissions role={detail?.membershipRole} />
        <dl className="rah-agent-info-grid">
          <div>
            <dt>计算机</dt>
            <dd>
              <AgentComputerIdentity agentId={agent.agentDefinitionId} />
            </dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>{formatProfileDate(agent.createdAt)}</dd>
          </div>
          <div>
            <dt>创建者</dt>
            <dd>
              {creator === undefined ? (
                loading ? (
                  "正在读取…"
                ) : error ? (
                  "暂时无法读取创建者"
                ) : (
                  "创建者尚未加载"
                )
              ) : creator === null ? (
                "未分配创建者"
              ) : creator.kind === "human" ? (
                <HumanIdentity
                  principal={creator}
                  className="rah-agent-creator-identity"
                />
              ) : (
                <span className="rah-agent-creator-identity">
                  {creatorAgent === undefined ? (
                    <ProfileImageAvatar
                      kind="agent"
                      name={creator.displayName ?? creator.handle}
                      avatarKey={creator.avatarKey}
                      principalId={creator.principalId}
                      size="compact"
                    />
                  ) : (
                    <AgentAvatar agent={creatorAgent} size="compact" />
                  )}
                  <b>{creator.displayName ?? creator.handle}</b>
                  <small>@{creator.handle}</small>
                </span>
              )}
            </dd>
          </div>
        </dl>
      </ProfileSection>
      <ProfileSection
        title="运行时配置"
        className="rah-agent-runtime-section"
        action={
          <button
            className="rah-profile-edit rah-interaction-flat"
            aria-label="编辑运行时配置"
            disabled={!canManage}
            onClick={onEditRuntime}
          >
            <Icon name="pencil" />
          </button>
        }
      >
        {loading && detail === undefined ? (
          <p className="rah-agent-profile-status">正在读取 canonical 配置…</p>
        ) : detail !== undefined ? (
          <div className="rah-agent-runtime-chips">
            <ProfileChip
              label="运行时"
              tone="cyan"
              value={runtimeView.runtimeLabel}
              onEdit={canManage ? onEditRuntime : undefined}
            />
            <ProfileChip
              label="模型"
              tone="lavender"
              value={runtimeView.modelLabel}
              onEdit={canManage ? onEditRuntime : undefined}
            />
            {runtimeView.reasoningLabel !== undefined ? (
              <ProfileChip
                label="推理强度"
                tone="yellow"
                value={runtimeView.reasoningLabel}
                onEdit={canManage ? onEditRuntime : undefined}
              />
            ) : null}
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
      </ProfileSection>
      <ProfileSection
        title="已创建的 AGENT"
        count={detail ? createdAgents.length : undefined}
        className="rah-agent-created-section"
      >
        {detail === undefined && loading ? (
          <p className="rah-agent-profile-status">正在读取身份关系…</p>
        ) : detail === undefined ? (
          <p className="rah-agent-profile-status is-error">
            暂时无法读取身份关系
          </p>
        ) : createdAgents.length === 0 ? (
          <p className="rah-agent-profile-status">暂无已创建的 Agent</p>
        ) : (
          <div className="rah-agent-created-list">
            {createdAgents.map((createdAgent) => (
              <AgentEntityCard
                key={createdAgent.agentDefinitionId}
                agent={createdAgent}
                runtimeLabel={
                  createdAgent.runtimeLabels.join(" · ") || undefined
                }
                onOpen={onSelectAgent}
              />
            ))}
          </div>
        )}
      </ProfileSection>
      <AgentSkillsSection
        client={client}
        agentDefinitionId={agent.agentDefinitionId}
        executionPolicyRevisionId={agent.executionPolicyRevisionId}
      />
      <ProfileSection title="操作" className="rah-agent-actions-section">
        <div className="rah-agent-profile-actions">
          <button
            className="rah-interaction-brutal"
            disabled={!canManage || onStartStop === undefined}
            onClick={onStartStop}
          >
            <Icon name={agent.state === "enabled" ? "square" : "play"} />
            {agent.state === "enabled" ? "停止 Agent" : "启动 Agent"}
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
            className="rah-interaction-brutal is-orange"
            disabled={!canManage}
            onClick={() => setIssueReportOpen(true)}
            title="生成经过裁剪的本地诊断文件，不会自动上传"
          >
            <Icon name="bug" />
            报告问题
          </button>
          <button
            className="rah-interaction-brutal is-red"
            disabled={!canManage}
            onClick={onDelete ?? onManage}
            title="确认删除；须先停止并确认无在途工作"
          >
            <Icon name="trash-2" />
            删除 Agent
          </button>
        </div>
      </ProfileSection>
      {resetOpen && onResetExecution !== undefined ? (
        <AgentExecutionResetDialog
          agentName={agent.displayName}
          fullResetEnabled={fullResetEnabled}
          onClose={() => setResetOpen(false)}
          onConfirm={onResetExecution}
        />
      ) : null}
      {issueReportOpen ? (
        <AgentIssueReportDialog
          agent={agent}
          client={client}
          onClose={() => setIssueReportOpen(false)}
        />
      ) : null}
    </section>
  );
}

function AgentProfileAvatarEditor({
  agent,
  canManage,
  children,
  client,
  onSaveProfile,
}: {
  agent: WorkspaceAgentView;
  canManage: boolean;
  children: ReactNode;
  client: RahClient;
  onSaveProfile?: ((input: AgentProfileEditInput) => Promise<void>) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickerId = `rah-agent-avatar-picker-${agent.agentDefinitionId}`;
  const currentUploadedAvatar = isUploadedProfileImageKey(agent.avatarKey);
  const currentOfficialAvatarKey = currentUploadedAvatar
    ? undefined
    : officialAgentAvatarKey(agent.avatarKey, agent.participantId);
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
    if (avatarKey === currentOfficialAvatarKey) {
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

  async function uploadAvatar(file: File): Promise<void> {
    if (
      !editable ||
      pending ||
      revisionId === undefined ||
      client.profileImages === undefined
    )
      return;
    setPending(true);
    setError(undefined);
    try {
      await uploadAgentAvatar({
        agentDefinitionId: agent.agentDefinitionId,
        expectedRevisionId: revisionId,
        file,
        saveProfile: onSaveProfile,
        upload: (candidate) => client.profileImages!.upload(candidate),
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
              aria-label="上传图片"
              className="rah-agent-avatar-upload"
              data-selected={currentUploadedAvatar}
              disabled={pending || client.profileImages === undefined}
              onClick={() => fileInputRef.current?.click()}
              title={
                client.profileImages === undefined
                  ? "头像存储不可用"
                  : "上传图片"
              }
              type="button"
            >
              {currentUploadedAvatar ? (
                <AgentAvatar agent={agent} showStatus={false} size="header" />
              ) : (
                <span aria-hidden="true">⇧</span>
              )}
            </button>
            <input
              accept={AGENT_AVATAR_UPLOAD_ACCEPT}
              className="rah-agent-avatar-file-input"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file !== undefined) void uploadAvatar(file);
              }}
              ref={fileInputRef}
              type="file"
            />
            {OFFICIAL_AGENT_AVATAR_KEYS.map((avatarKey) => (
              <button
                aria-pressed={avatarKey === currentOfficialAvatarKey}
                aria-label={`选择头像 ${avatarKey}`}
                className="rah-agent-avatar-choice"
                data-selected={avatarKey === currentOfficialAvatarKey}
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

export function AgentActivityPane({
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
        <p className="rah-agent-activity-empty" role="status">
          正在读取活动…
        </p>
      ) : activities.length === 0 && error === undefined ? (
        <EmptyState
          context="profile"
          placement="fill"
          icon="pulse"
          title="暂无活动"
          description="启动 Agent 以查看其活动日志。"
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
      {activities.length > 0 && (
        <p className="rah-agent-activity-note">
          未运行的 Agent 不会显示其他测试环境的历史。动态来自 Provider
          的结构化事件，不解析 ANSI。Codex 只显示公开 reasoning
          summary，原始思维链不会进入该投影。
        </p>
      )}
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

export function AgentRemindersPane({
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
          <span>
            此 Agent 尚未安排任何提醒。要设置一个，只需告诉你的
            Agent：「明天提醒我跟进。」
          </span>
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
  return formatRahDateTime(value, {
    dateStyle: "medium",
    timeStyle: "short",
  });
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

export { AgentAvatar } from "./agent-avatar.tsx";

function clampSidebarWidth(width: number): number {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, width));
}

function formatActivityTime(timestamp: string): string {
  return formatRahDateTime(timestamp, {
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
