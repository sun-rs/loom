import { ChatTaskApproval } from "./components/chat-task-approval.tsx";
import { useMobileLayout } from "./use-mobile-layout.ts";
import { WorkspaceNavigation } from "./components/workspace-navigation-shell.tsx";
import { SurfaceErrorBoundary } from "./components/surface-error-boundary.tsx";
import {
  SearchPreviewResizer,
  useSearchPreviewWidth,
} from "./components/search-preview-resizer.tsx";
import {
  conversationPanels,
  type ConversationPanelIntent,
  type ConversationOrigin,
} from "./conversation-panels.ts";
import { IdentityOriginContext } from "./components/workspace-entity-context.tsx";
import { changeSystemChannel } from "./components/system-channel-settings.tsx";
import { browserOpaqueId } from "./browser-opaque-id.ts";
import { useConversationLayout } from "./use-conversation-layout.ts";
import { createAgentConfigureCommand } from "./agent-configure-command.ts";
import { useSearchChannelPreview } from "./use-search-channel-preview.ts";
import { PublicChannelPreview } from "./components/public-channel-preview.tsx";
import { InteractivePopover } from "@rah-os/ui-web/neo-brutalist/interactive-popover";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  ensureRoomMembership,
  ensureRoomMembershipRemoved,
  loadOrCreateConsumerId,
  MessageSession,
  RAFT_MESSAGE_PAGE_SIZE,
  RoomSession,
  runRoomMutationAtLatest,
} from "@rah-os/client-core";
import { HttpRahClient, type RahClient } from "@rah-os/client-sdk";
import { GlobalDiscoverySurface } from "./components/global-discovery.tsx";
import {
  TaskDetailMetadata,
  TaskThreadPresentation,
} from "./components/global-task-detail.tsx";
import {
  closeGlobalTaskSearch,
  globalTaskDetailFromSearch,
} from "./global-task-detail-route.ts";
import { MessageSocialProvider } from "./components/message-social.tsx";
import { SidebarPreferencesProvider } from "./components/sidebar-preferences.tsx";
import { SavedMessagesPane } from "./components/saved-messages.tsx";
import { ComposerDraftProvider } from "./components/composer-draft-provider.tsx";
import { FilesProvider, RoomFilesPane } from "./components/room-files.tsx";
import {
  discoveryLocation,
  focusAfterSuccessfulSubmit,
  globalSurfaceFromSearch,
  type DiscoveryLocation,
} from "./global-discovery-model.ts";
import { useDiscoveryQuery } from "./use-discovery-query.ts";
import { WorkspaceIdentity } from "./components/workspace-identity.tsx";
import { createWorkspaceEntities } from "./workspace-entities.ts";
import { WorkspaceEntityProvider } from "./components/workspace-entity-context.tsx";
import type {
  AgentCatalogEntry,
  ClientAgentGetResponse,
  ClientHealthResponse,
  InputRequest,
  LocalComputerProfile,
  LocalRuntimeInventoryEntry,
  MembershipRole,
  Message,
  NavigationTarget,
  Principal,
  Room,
  RoomAgentActivity,
  RoomEvent,
  RoomMembership,
  Task,
  Thread,
  Workspace,
} from "@rah-os/protocol";
import {
  canCreateWorkspaceRoom,
  canManageRoomMembers,
  canOnboardWorkspaceAgent,
  createRoomViewModel,
  foundationCapabilityIssue,
  mentionedRoomAgentIds,
  roomMessageAttentionRecipients,
  roomAgentCandidates,
  roomAgentTargets,
  roomPollDelay,
  roomSelectionFromSearch,
  roomSelectionSearch,
  selectProductRooms,
  type TaskParticipantSelection,
  threadRootSelectionFromSearch,
  workspaceAgentDirectory,
} from "@rah-os/ui-web";

import {
  AgentCreateDialog,
  AgentManageDialog,
  type AgentConfigureInput,
  type AgentCreateInput,
} from "./components/agent-dialogs.tsx";
import { AgentRuntimeDialog } from "./components/agent-runtime-dialog.tsx";
import type { AgentProfileEditInput } from "./agent-profile-edit.ts";
import {
  ChatPane,
  TaskPane,
  ThreadPane,
  type ThreadReplyPreview,
  type ThreadSearchMatch,
  UnavailablePane,
} from "./components/conversation-panes.tsx";
import { ConnectionScreen } from "./components/connection-screen.tsx";
import {
  RoomCreateDialog,
  RoomMembersDialog,
  type AgentMembershipIdentity,
} from "./components/room-dialogs.tsx";
import {
  TaskCreateDialog,
  type TaskCreateInput,
} from "./components/task-dialogs.tsx";
import { ComputerRuntimePane } from "./components/workspace-catalog-panes.tsx";
import { AgentDirectoryPane } from "./components/agent-directory-pane.tsx";
import { SettingsSurface } from "./components/settings-surface.tsx";
import { ConversationTabs } from "./components/conversation-tabs.tsx";
import { HumanInboxCenter } from "./components/human-inbox.tsx";
import { RoomSidebarResizer } from "./components/room-sidebar-resizer.tsx";
import { ThreadPanelResizer } from "./components/thread-panel-resizer.tsx";
import {
  ChannelHeader,
  RoomSidebar,
  type Surface,
  type Tab,
} from "./components/workspace-navigation.tsx";
import { useRoomSidebarWidth } from "./use-room-sidebar-width.ts";
import { useThreadPanelWidth } from "./use-thread-panel-width.ts";
import { useThreadFocusReturn } from "./thread-focus-return.ts";
import { loadThreadHistoryPages } from "./thread-history.ts";
import { applyGlobalTaskTransition } from "./global-task-actions.ts";
import { messageTaskMenuTarget } from "./message-task-menu-action.ts";
import { pendingInputRequestsForHuman } from "./human-inbox-projection.ts";
import { useReconciledQuery } from "./use-reconciled-query.ts";
import {
  canEditRoomMemberRole,
  canHumanLeaveRoom,
} from "./room-member-role.ts";
import { useSystemNotices } from "./use-system-notices.ts";
import { useDefaultWebPush } from "./use-default-web-push.ts";
import {
  navigationPresentation,
  roomTabFromSearch,
} from "./navigation-target.ts";
import { DiagnosticNavigationContext } from "./components/diagnostic-references.tsx";
import { createLatestRequest } from "./latest-request.ts";
import {
  agentDirectoryRootRoute,
  agentRouteFromSearch,
  agentRouteSearch,
  type AgentRouteSelection,
} from "./agent-route.ts";
import { rememberWorkspaceLocation } from "./workspace-switcher-state.ts";
import { getOrCreateBoundedSession } from "./bounded-session-cache.ts";
import {
  messageReferenceReadStateRecordsIndex,
  type MessageReferenceReadStateIndex,
} from "./message-reference-read-state.ts";
import {
  appendRoomTaskWindowPage,
  createRoomTaskWindow,
  loadEarlierRoomTaskOverview,
  refreshRoomTaskWindow,
  rememberRoomTaskWindow,
  sameRoomTaskPageCursor,
  type RoomTaskPageCursor,
  type RoomTaskWindow,
} from "./room-task-pages.ts";
import {
  createTaskCreateCommandLedger,
  submitTaskCreateRows,
} from "./task-create-execution.ts";

type AppProps = { client?: RahClient };
declare const __RAH_TRUSTED_PROXY_AUTH__: boolean;
type RoomData = {
  activeMemberIds: string[];
  agentActivity: RoomAgentActivity[];
  caughtUp: boolean;
  hasEarlierMessages: boolean;
  latestRoomSeq: number;
  members: Principal[];
  mentionReadStates: MessageReferenceReadStateIndex;
  memberships: RoomMembership[];
  messages: Message[];
  referenceEventsComplete: boolean;
  roomEvents: RoomEvent[];
  roomId: string;
  taskNextPage?: RoomTaskPageCursor | undefined;
  tasks: Task[];
  threads: Thread[];
};

async function loadMessageReferenceReadStates(
  client: RahClient,
  roomId: string,
  messages: readonly Message[],
  signal?: AbortSignal,
): Promise<MessageReferenceReadStateIndex> {
  const messageIds = [...new Set(messages.map(({ messageId }) => messageId))];
  if (messageIds.length === 0) return new Map();
  const records = [];
  for (let offset = 0; offset < messageIds.length; offset += 200) {
    const response = await client.request(
      "message.reference.read-state.list",
      { messageIds: messageIds.slice(offset, offset + 200), roomId },
      signal === undefined ? undefined : { signal },
    );
    records.push(...response.readStates);
  }
  return messageReferenceReadStateRecordsIndex(records);
}

export function App({ client: injectedClient }: AppProps) {
  const [client, setClient] = useState<RahClient | undefined>(() =>
    injectedClient === undefined && __RAH_TRUSTED_PROXY_AUTH__
      ? new HttpRahClient({
          accessToken: () => "trusted-proxy-auth",
          baseUrl: "",
        })
      : injectedClient,
  );
  return client === undefined ? (
    <ConnectionScreen
      onConnect={(accessToken) => {
        setClient(
          new HttpRahClient({ accessToken: () => accessToken, baseUrl: "" }),
        );
      }}
    />
  ) : (
    <FilesProvider client={client}>
      <ComposerDraftProvider>
        <WorkspaceScreen
          client={client}
          onDisconnect={() => {
            if (__RAH_TRUSTED_PROXY_AUTH__) window.location.reload();
            else setClient(undefined);
          }}
        />
      </ComposerDraftProvider>
    </FilesProvider>
  );
}

function WorkspaceScreen({
  client,
  onDisconnect,
}: {
  client: RahClient;
  onDisconnect: () => void;
}) {
  useDefaultWebPush(client);
  const {
    width: roomSidebarWidth,
    setWidth: setRoomSidebarWidth,
    commit: commitRoomSidebarWidth,
  } = useRoomSidebarWidth();
  const {
    width: threadPanelWidth,
    setWidth: setThreadPanelWidth,
    commit: commitThreadPanelWidth,
  } = useThreadPanelWidth();
  const { rememberThreadFocus, restoreThreadFocus } = useThreadFocusReturn();
  const [health, setHealth] = useState<ClientHealthResponse>();
  const [currentPrincipal, setCurrentPrincipal] = useState<Principal>();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [panelIntent, setPanelIntent] = useState<ConversationPanelIntent>({
    latest: "profile",
    source: "room",
  });
  const [peekAgentId, setPeekAgentId] = useState<string>();
  const [peekActivityRequest, setPeekActivityRequest] = useState(0);
  const [peekHumanId, setPeekHumanId] = useState<string>();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [archivedRooms, setArchivedRooms] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string>();
  const [roomData, setRoomData] = useState<RoomData>();
  const [activeThreadRootMessageId, setActiveThreadRootMessageId] = useState<
    string | undefined
  >(() => {
    const requestedRoomId = roomSelectionFromSearch(window.location.search);
    return requestedRoomId === undefined
      ? undefined
      : threadRootSelectionFromSearch(window.location.search, requestedRoomId);
  });
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [threadMentionReadStates, setThreadMentionReadStates] =
    useState<MessageReferenceReadStateIndex>(new Map());
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadHasEarlierReplies, setThreadHasEarlierReplies] = useState(false);
  const [threadEarlierRepliesLoading, setThreadEarlierRepliesLoading] =
    useState(false);
  const [earlierMessagesLoading, setEarlierMessagesLoading] = useState(false);
  const [earlierTasksLoading, setEarlierTasksLoading] = useState(false);
  const taskCreateCommandLedger = useRef(createTaskCreateCommandLedger());
  const [tab, setTab] = useState<Tab>(() =>
    roomTabFromSearch(window.location.search),
  );
  const taskFilterMemory = useRef(new Map<string, string>());
  const navigationGeneration = useRef(0);
  const diagnosticNavigation = useRef(createLatestRequest());
  const searchPreview = useSearchChannelPreview();
  const searchLayout = useSearchPreviewWidth();
  const [surface, setSurfaceState] = useState<Surface>(() =>
    globalSurfaceFromSearch(window.location.search),
  );
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const [globalTaskDetail, setGlobalTaskDetail] = useState(() =>
    globalTaskDetailFromSearch(window.location.search),
  );
  const [agentRoute, setAgentRoute] = useState<AgentRouteSelection>(() =>
    agentRouteFromSearch(window.location.search),
  );
  const [navigationError, setNavigationError] = useState<string>();
  const invalidateNavigation = useCallback(() => {
    diagnosticNavigation.current.cancel();
    return ++navigationGeneration.current;
  }, []);
  const openAgentPeek = useCallback(
    async (agentDefinitionId: string, origin: ConversationOrigin = "room") => {
      const epoch = invalidateNavigation();
      setNavigationError(undefined);
      try {
        const resolved = await client.request("navigation.resolve", {
          target: { agentDefinitionId, kind: "agent" },
        });
        if (
          navigationGeneration.current !== epoch ||
          resolved.target.kind !== "agent"
        )
          return false;
        setPeekHumanId(undefined);
        setPeekAgentId(resolved.target.agentDefinitionId);
        setPanelIntent({ latest: "profile", source: origin });
        if (
          peekAgentId !== resolved.target.agentDefinitionId ||
          panelIntent.latest === "profile"
        )
          setPeekActivityRequest((request) => request + 1);
        return true;
      } catch (failure) {
        if (navigationGeneration.current === epoch) {
          setNavigationError(
            failure instanceof Error
              ? failure.message
              : "Agent 已不存在或你已无权访问。",
          );
        }
        return false;
      }
    },
    [client, invalidateNavigation, peekAgentId, panelIntent.latest],
  );
  const setSurface = useCallback(
    (next: Surface) => {
      invalidateNavigation();
      if (surfaceRef.current === "search" && next !== "search") {
        setGlobalTaskDetail(undefined);
        const params = new URLSearchParams(window.location.search);
        for (const key of [
          "target",
          "task",
          "thread",
          "threadId",
          "message",
          "q",
          "scope",
          "sender",
          "channel",
          "time",
          "after",
          "before",
          "sort",
          "previewRoom",
          "previewMessage",
          "previewThread",
          "previewRoot",
          "previewTab",
          "highlight",
        ])
          params.delete(key);
        window.history.replaceState(null, "", `?${params}`);
        searchPreview.reset();
      }
      if (next !== "tasks") setGlobalTaskDetail(undefined);
      setSurfaceState(next);
    },
    [invalidateNavigation, searchPreview.reset],
  );
  const navigationEpoch = useCallback(() => navigationGeneration.current, []);
  const navigateAgentRoute = useCallback(
    (selection: AgentRouteSelection, options?: { replace?: boolean }) => {
      const nextSearch = agentRouteSearch(window.location.search, selection);
      window.history[options?.replace ? "replaceState" : "pushState"](
        null,
        "",
        nextSearch,
      );
      setAgentRoute(selection);
    },
    [],
  );
  useEffect(
    () => () => {
      invalidateNavigation();
    },
    [client, invalidateNavigation],
  );
  const [focusHighlightRequest, setFocusHighlightRequest] = useState(0);
  const [focusHighlightQuery, setFocusHighlightQuery] = useState<
    string | undefined
  >(
    () =>
      new URLSearchParams(window.location.search).get("highlight") ?? undefined,
  );
  const [focusedMessageId, setFocusedMessageId] = useState<string | undefined>(
    () =>
      new URLSearchParams(window.location.search).get("previewMessage") ??
      new URLSearchParams(window.location.search).get("message") ??
      undefined,
  );
  const [chatTaskTarget, setChatTaskTarget] =
    useState<Extract<NavigationTarget, { kind: "task" }>>();
  useEffect(() => setChatTaskTarget(undefined), [activeRoomId, surface]);
  const taskDetailVisible = globalTaskDetail !== undefined;
  const taskModalOpen = taskDetailVisible && surface !== "search";
  const taskDetailResult = useDiscoveryQuery(
    client,
    "task.get",
    {
      roomId: globalTaskDetail?.roomId ?? "unavailable",
      taskId: globalTaskDetail?.taskId ?? "unavailable",
    },
    taskDetailVisible,
  );
  const detailTask = taskDetailResult.data?.task;
  useEffect(() => {
    if (
      !taskDetailVisible ||
      !detailTask ||
      detailTask.taskId !== globalTaskDetail?.taskId ||
      detailTask.roomId !== globalTaskDetail.roomId
    )
      return;
    setActiveRoomId(detailTask.roomId);
    setActiveThreadRootMessageId(detailTask.sourceMessageId);
    setFocusedMessageId(detailTask.sourceMessageId);
  }, [detailTask, globalTaskDetail, taskDetailVisible]);
  const closeTaskDetail = () => {
    invalidateNavigation();
    window.history.replaceState(
      null,
      "",
      closeGlobalTaskSearch(window.location.search),
    );
    setGlobalTaskDetail(undefined);
    setActiveThreadRootMessageId(undefined);
    setFocusedMessageId(undefined);
  };
  const locationResult = useDiscoveryQuery(
    client,
    "message.context",
    { messageId: focusedMessageId ?? "none" },
    (surface === "room" ||
      surface === "activity" ||
      surface === "search" ||
      (surface === "tasks" && globalTaskDetail !== undefined)) &&
      focusedMessageId !== undefined,
  );
  const messageContext =
    focusedMessageId !== undefined &&
    locationResult.data?.message.messageId === focusedMessageId &&
    locationResult.data.message.roomId === activeRoomId
      ? locationResult.data
      : undefined;
  useEffect(() => {
    if (
      focusedMessageId !== undefined &&
      messageContext?.message.threadId !== undefined &&
      activeThreadRootMessageId === undefined
    ) {
      setActiveThreadRootMessageId(messageContext.rootMessageId);
    }
  }, [activeThreadRootMessageId, focusedMessageId, messageContext]);
  const previewJoined =
    (surface === "search" || surface === "activity") &&
    !!searchPreview.roomId &&
    rooms.some((room) => room.roomId === searchPreview.roomId);
  const closeSearchPreview = () => {
    invalidateNavigation();
    searchPreview.close();
    setGlobalTaskDetail(undefined);
    window.history.replaceState(
      null,
      "",
      closeGlobalTaskSearch(window.location.search),
    );
    setActiveThreadRootMessageId(undefined);
    setFocusedMessageId(undefined);
    setFocusHighlightQuery(undefined);
  };
  const globalSurface =
    surface === "tasks" || surface === "search" || surface === "activity";
  const openDiscoveryLocation = useCallback(
    async (location: DiscoveryLocation) => {
      const epoch = invalidateNavigation();
      setNavigationError(undefined);
      try {
        const resolved = await client.request("navigation.resolve", {
          target: location.target,
        });
        if (navigationGeneration.current !== epoch) return false;
        if (
          resolved.target.kind === "task" &&
          !location.surface &&
          surface === "room" &&
          resolved.target.roomId === activeRoomId
        ) {
          setChatTaskTarget(resolved.target);
          return true;
        }
        setFocusHighlightQuery(location.highlightQuery?.trim() || undefined);
        if (
          (surface === "search" ||
            ((surface === "activity" || surface === "saved") &&
              "roomId" in resolved.target &&
              !rooms.some(
                (room) =>
                  "roomId" in resolved.target &&
                  room.roomId === resolved.target.roomId,
              ))) &&
          (resolved.target.kind === "room" ||
            resolved.target.kind === "message" ||
            resolved.target.kind === "thread" ||
            resolved.target.kind === "task")
        ) {
          const id = resolved.target.roomId;
          if (surface === "saved") setSurface("search");
          const previewParams = new URLSearchParams(window.location.search);
          for (const key of ["target", "task", "thread", "threadId", "message"])
            previewParams.delete(key);
          if (resolved.target.kind === "task") {
            previewParams.set("target", "task");
            previewParams.set("task", resolved.target.taskId);
          }

          if (location.highlightQuery?.trim())
            previewParams.set("highlight", location.highlightQuery.trim());
          else previewParams.delete("highlight");
          window.history.replaceState(null, "", `?${previewParams}`);
          setFocusHighlightRequest((request) => request + 1);
          searchPreview.open(
            id,
            resolved.target.kind === "message"
              ? resolved.target.messageId
              : resolved.target.kind === "thread" ||
                  resolved.target.kind === "task"
                ? resolved.target.rootMessageId
                : undefined,
            "threadId" in resolved.target
              ? resolved.target.threadId
              : undefined,
          );
          if (rooms.some((room) => room.roomId === id)) {
            setRoomData(undefined);
            setActiveRoomId(id);
          }
          setGlobalTaskDetail(
            globalTaskDetailFromSearch(window.location.search),
          );
          setActiveThreadRootMessageId(
            "rootMessageId" in resolved.target
              ? resolved.target.rootMessageId
              : undefined,
          );
          setFocusedMessageId(
            resolved.target.kind === "message"
              ? resolved.target.messageId
              : undefined,
          );
          setTab("chat");
          return true;
        }
        const presentation = navigationPresentation(
          resolved.target,
          location.surface,
        );
        window.history.pushState(
          null,
          "",
          discoveryLocation(
            { ...location, target: resolved.target },
            window.location.search,
          ),
        );
        setFocusHighlightRequest((request) => request + 1);
        setFocusedMessageId(presentation.focusedMessageId);
        setActiveThreadRootMessageId(presentation.threadRootMessageId);
        if (presentation.roomId !== undefined)
          setActiveRoomId(presentation.roomId);
        if (presentation.agentDefinitionId !== undefined) {
          setAgentRoute({
            agentDefinitionId: presentation.agentDefinitionId,
            tab: presentation.agentTab ?? "profile",
          });
        }
        setPeekAgentId(undefined);
        setPeekHumanId(undefined);
        setRoomMembersOpen(false);
        setMobileRoomsOpen(false);
        setSurface(presentation.surface);
        setGlobalTaskDetail(globalTaskDetailFromSearch(window.location.search));
        setTab(presentation.tab);
        if (presentation.inputRequestId !== undefined) setHumanInboxOpen(true);
        return true;
      } catch (failure) {
        if (navigationGeneration.current === epoch) {
          setNavigationError(
            failure instanceof Error
              ? failure.message
              : "目标已不存在或你已无权访问。",
          );
        }
        return false;
      }
    },
    [
      client,
      invalidateNavigation,
      setSurface,
      surface,
      rooms,
      searchPreview.open,
      activeRoomId,
    ],
  );
  useEffect(() => {
    const navigate = (event: Event) => {
      const target = (event as CustomEvent<NavigationTarget>).detail;
      void openDiscoveryLocation({ target });
    };
    window.addEventListener("rah:push-navigate", navigate);
    return () => window.removeEventListener("rah:push-navigate", navigate);
  }, [openDiscoveryLocation]);
  const inventory = useReconciledQuery(client, "host.runtime.list", {});
  const [computerProfileOverride, setComputerProfileOverride] =
    useState<LocalComputerProfile>();
  const [localRuntimes, setLocalRuntimes] = useState<
    LocalRuntimeInventoryEntry[]
  >([]);
  useEffect(() => {
    if (inventory?.data) setLocalRuntimes(inventory.data.runtimes);
  }, [inventory?.data]);
  const localRuntimeHostId = inventory?.data?.hostId;
  const observedComputer = inventory?.error
    ? undefined
    : inventory?.data?.computer;
  useEffect(() => {
    if (
      computerProfileOverride !== undefined &&
      (observedComputer?.profileRevision ?? 0) >=
        computerProfileOverride.revision
    ) {
      setComputerProfileOverride(undefined);
    }
  }, [computerProfileOverride, observedComputer?.profileRevision]);
  const computer =
    observedComputer === undefined || computerProfileOverride === undefined
      ? observedComputer
      : {
          ...observedComputer,
          description: computerProfileOverride.description,
          displayName: computerProfileOverride.displayName,
          profileRevision: computerProfileOverride.revision,
          profileUpdatedAt: computerProfileOverride.updatedAt,
        };
  const runtimeInventoryError = inventory?.error;
  const [agentCatalog, setAgentCatalog] = useState<AgentCatalogEntry[]>([]);
  const [agentCatalogControlRoomId, setAgentCatalogControlRoomId] =
    useState<string>();
  const [mobileRoomsOpen, setMobileRoomsOpen] = useState(
    () =>
      window.matchMedia("(max-width: 767px)").matches &&
      !new URLSearchParams(window.location.search).has("room") &&
      [null, "room"].includes(
        new URLSearchParams(window.location.search).get("surface"),
      ),
  );
  const [roomCreateOpen, setRoomCreateOpen] = useState(false);
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);
  const [agentCreateOpen, setAgentCreateOpen] = useState(false);
  const [agentManageDetail, setAgentManageDetail] =
    useState<ClientAgentGetResponse>();
  const [agentManageMode, setAgentManageMode] = useState<"all" | "runtime">(
    "all",
  );
  const [roomMembersOpen, setRoomMembersOpen] = useState(false);
  const [humanInboxOpen, setHumanInboxOpen] = useState(() =>
    new URLSearchParams(window.location.search).has("inputRequest"),
  );
  const mobileLayout = useMobileLayout();
  useEffect(() => {
    // Mobile notifications live on Home, including typed links opened without a bell tap.
    if (humanInboxOpen && mobileLayout) {
      setSurface("room");
      setMobileRoomsOpen(true);
    }
  }, [humanInboxOpen, mobileLayout]);
  const [humanInboxLoading, setHumanInboxLoading] = useState(false);
  const [humanInboxError, setHumanInboxError] = useState<string>();
  const [humanInputRequests, setHumanInputRequests] = useState<InputRequest[]>(
    [],
  );
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [directoryRevision, setDirectoryRevision] = useState(0);
  const sessions = useRef(new Map<string, RoomSession>());
  const messageSessions = useRef(new Map<string, MessageSession>());
  const threadMessageSessions = useRef(new Map<string, MessageSession>());
  const taskWindows = useRef(new Map<string, RoomTaskWindow>());
  const roomDataReads = useRef(createLatestRequest());
  const threadHistoryLoadingKey = useRef<string | undefined>(undefined);
  const activeThreadHistoryKey = useRef<string | undefined>(undefined);
  const directRoomOpenRequests = useRef(new Map<string, Promise<Room>>());
  const consecutivePollFailures = useRef(0);
  const consumerPrefix = useMemo(() => browserConsumerId(), []);
  const activeRoom =
    rooms.find((room) => room.roomId === activeRoomId) ??
    archivedRooms.find((room) => room.roomId === activeRoomId);
  const activeWorkspace =
    workspaces.find(
      (workspace) => workspace.workspaceId === activeRoom?.workspaceId,
    ) ??
    workspaces.find(
      (workspace) => workspace.workspaceId === selectedWorkspaceId,
    ) ??
    workspaces[0];
  const attention = useReconciledQuery(
    client,
    "activity.list",
    { workspaceId: activeWorkspace?.workspaceId ?? "none", limit: 1 },
    activeWorkspace !== undefined,
  );
  const unreadSummary = attention?.data?.summary;
  const notificationQuery = useReconciledQuery(
    client,
    "notification.list",
    { workspaceId: activeWorkspace?.workspaceId ?? "none" },
    activeWorkspace !== undefined,
  );
  const humanDirectoryQuery = useReconciledQuery(
    client,
    "workspace.human.list",
    { workspaceId: activeWorkspace?.workspaceId ?? "none" },
    health?.capabilities.memberRead === true && activeWorkspace !== undefined,
    reload,
  );
  // The reconciled directory is the single Workspace membership projection.
  // A failed read cannot leave an old owner capability enabled in the UI.
  const workspaceMembershipRole = humanDirectoryQuery?.error
    ? undefined
    : humanDirectoryQuery?.data?.humans.find(
        ({ principal }) =>
          principal.principalId === currentPrincipal?.principalId,
      )?.membership.role;
  const systemNotices = notificationQuery?.data?.notifications ?? [];
  const systemNoticeView = useSystemNotices(
    systemNotices,
    client,
    activeWorkspace?.workspaceId,
  );
  const scopedAgentCatalog = useMemo(
    () =>
      agentCatalogControlRoomId === activeWorkspace?.controlRoomId
        ? agentCatalog
        : [],
    [activeWorkspace?.controlRoomId, agentCatalog, agentCatalogControlRoomId],
  );

  const refreshHumanInbox = useCallback(
    async (signal?: AbortSignal) => {
      if (signal?.aborted) return;
      if (
        health?.capabilities.inputRequestRead !== true ||
        currentPrincipal === undefined
      ) {
        setHumanInputRequests([]);
        setHumanInboxError(undefined);
        return;
      }
      const responses = await Promise.all(
        rooms.map((room) =>
          client.request(
            "inputRequest.list",
            { roomId: room.roomId, state: "pending" },
            signal === undefined ? undefined : { signal },
          ),
        ),
      );
      if (signal?.aborted) return;
      setHumanInputRequests(
        pendingInputRequestsForHuman({
          inputRequests: responses.flatMap(
            ({ inputRequests }) => inputRequests,
          ),
          principalId: currentPrincipal.principalId,
        }),
      );
      setHumanInboxError(undefined);
    },
    [client, currentPrincipal, health?.capabilities.inputRequestRead, rooms],
  );

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeRequest: AbortController | undefined;
    let activeDeadline: ReturnType<typeof setTimeout> | undefined;
    setHumanInboxLoading(true);
    const reconcile = async () => {
      if (pending || controller.signal.aborted) return;
      clearTimeout(timer);
      pending = true;
      const request = new AbortController();
      activeRequest = request;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          refreshHumanInbox(request.signal),
          new Promise<never>((_, reject) => {
            deadline = activeDeadline = setTimeout(() => {
              request.abort();
              reject(new Error("通知读取超时，请稍后重试"));
            }, 15000);
          }),
        ]);
      } catch (caught) {
        if (!controller.signal.aborted)
          setHumanInboxError(errorMessage(caught));
      } finally {
        clearTimeout(deadline);
        pending = false;
        if (!controller.signal.aborted) {
          setHumanInboxLoading(false);
          timer = setTimeout(
            reconcile,
            document.visibilityState === "visible" ? 5000 : 15000,
          );
        }
      }
    };
    const focus = () => {
      if (document.visibilityState === "visible") void reconcile();
    };
    void reconcile();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      controller.abort();
      activeRequest?.abort();
      clearTimeout(timer);
      clearTimeout(activeDeadline);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refreshHumanInbox, reload]);

  const resolveHumanInputRequest = useCallback(
    async (request: InputRequest, answer: string) => {
      if (health?.capabilities.inputRequestResolve !== true) {
        throw new Error("daemon 未开放 InputRequest resolve capability");
      }
      const session = roomSessionFor(
        sessions.current,
        client,
        consumerPrefix,
        request.roomId,
      );
      await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("inputRequest.resolve", {
            answer,
            basedOnRoomSeq,
            idempotencyKey: `web-input-resolve-${browserOpaqueId()}`,
            inputRequestId: request.inputRequestId,
          }),
        session,
      });
      setHumanInputRequests((current) =>
        current.filter(
          ({ inputRequestId }) => inputRequestId !== request.inputRequestId,
        ),
      );
      setReload((value) => value + 1);
    },
    [client, consumerPrefix, health?.capabilities.inputRequestResolve],
  );

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [currentHealth, workspaceResult, principalResult] =
          await Promise.all([
            client.request("health", {}, { signal: controller.signal }),
            client.request("workspace.list", {}, { signal: controller.signal }),
            client.request("principal.me", {}, { signal: controller.signal }),
          ]);
        if (controller.signal.aborted) return;
        const capabilityIssue = foundationCapabilityIssue(currentHealth);
        if (capabilityIssue !== undefined) throw new Error(capabilityIssue);
        setHealth(currentHealth);
        setCurrentPrincipal(principalResult.principal);
        const activeWorkspaces = workspaceResult.workspaces.filter(
          (workspace) => workspace.state === "active",
        );
        setWorkspaces(activeWorkspaces);
        if (activeWorkspaces.length === 0) {
          setRooms([]);
          setArchivedRooms([]);
          setLoading(false);
          return;
        }
        const roomResult = await client.request(
          "room.list",
          {},
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        const visibleRooms = selectProductRooms({
          rooms: roomResult.rooms,
          workspaces: activeWorkspaces,
        });
        const activeWorkspaceIds = new Set(
          activeWorkspaces.map(({ workspaceId }) => workspaceId),
        );
        const archivedChannels = roomResult.rooms.filter(
          (room) =>
            room.kind === "channel" &&
            room.archivedAt !== undefined &&
            activeWorkspaceIds.has(room.workspaceId),
        );
        setArchivedRooms(archivedChannels);
        setRooms(visibleRooms);
        const navigableRooms = [...visibleRooms, ...archivedChannels];
        setActiveRoomId((current) => {
          if (
            current !== undefined &&
            navigableRooms.some(({ roomId }) => roomId === current)
          ) {
            return current;
          }
          const requested = roomSelectionFromSearch(window.location.search);
          return (
            navigableRooms.find(({ roomId }) => roomId === requested)?.roomId ??
            visibleRooms.find(
              (room) => room.kind === "channel" && room.slug === "all",
            )?.roomId ??
            visibleRooms[0]?.roomId
          );
        });
        setError(undefined);
      } catch (caught) {
        if (!controller.signal.aborted) setError(errorMessage(caught));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [client, directoryRevision]);

  useEffect(() => {
    if (activeRoomId === undefined) return;
    const detachedSurface = surface !== "room";
    const current = new URLSearchParams(window.location.search);
    const sameRoom = current.get("room") === activeRoomId;
    const next = new URLSearchParams(
      surface === "agents"
        ? agentRouteSearch(window.location.search, agentRoute)
        : detachedSurface
          ? window.location.search
          : roomSelectionSearch(activeRoomId, activeThreadRootMessageId),
    );
    if (!detachedSurface && sameRoom) {
      for (const key of [
        "target",
        "task",
        "threadId",
        "inputRequest",
        "artifact",
        "highlight",
      ]) {
        const value = current.get(key);
        if (value !== null) next.set(key, value);
      }
    }
    if (detachedSurface) {
      next.set("surface", surface);
      if (
        (surface === "activity" ||
          (surface === "tasks" && globalTaskDetail !== undefined)) &&
        activeThreadRootMessageId
      ) {
        next.set("room", activeRoomId);
        next.set("thread", `${activeRoomId}:${activeThreadRootMessageId}`);
        if (focusedMessageId) next.set("message", focusedMessageId);
        else next.delete("message");
      } else if (surface !== "agents") {
        next.delete("message");
        next.delete("thread");
      }
    } else {
      if (focusedMessageId) next.set("message", focusedMessageId);
      if (tab === "tasks" || tab === "files") next.set("roomTab", tab);
      else next.delete("roomTab");
    }
    if (mobileLayout && mobileRoomsOpen && surface === "room") {
      for (const key of [
        "room",
        "roomTab",
        "thread",
        "threadId",
        "message",
        "target",
        "task",
        "artifact",
        "highlight",
      ])
        next.delete(key);
    }
    const nextSearch = `?${next}`;
    if (window.location.search !== nextSearch) {
      window.history.replaceState(null, "", nextSearch);
    }
  }, [
    activeRoomId,
    activeThreadRootMessageId,
    focusedMessageId,
    agentRoute,
    globalSurface,
    globalTaskDetail,
    mobileLayout,
    mobileRoomsOpen,
    surface,
    tab,
  ]);

  useEffect(() => {
    if (activeWorkspace === undefined || currentPrincipal === undefined) return;
    rememberWorkspaceLocation(
      window.localStorage,
      currentPrincipal.principalId,
      activeWorkspace.workspaceId,
      window.location.search,
    );
  }, [
    activeRoomId,
    activeThreadRootMessageId,
    activeWorkspace,
    agentRoute,
    currentPrincipal,
    focusedMessageId,
    surface,
    tab,
  ]);

  useEffect(() => {
    const selectFromHistory = () => {
      setRoomMembersOpen(false);
      setSurface(globalSurfaceFromSearch(window.location.search));
      setGlobalTaskDetail(globalTaskDetailFromSearch(window.location.search));
      setAgentRoute(agentRouteFromSearch(window.location.search));
      setTab(roomTabFromSearch(window.location.search));
      setFocusHighlightQuery(
        new URLSearchParams(window.location.search).get("highlight") ??
          undefined,
      );
      setFocusHighlightRequest((request) => request + 1);
      setFocusedMessageId(
        new URLSearchParams(window.location.search).get("previewMessage") ??
          new URLSearchParams(window.location.search).get("message") ??
          undefined,
      );
      setHumanInboxOpen(
        new URLSearchParams(window.location.search).has("inputRequest"),
      );
      const requested = roomSelectionFromSearch(window.location.search);
      if (
        requested !== undefined &&
        rooms.some(({ roomId }) => roomId === requested)
      ) {
        setActiveRoomId(requested);
        setActiveThreadRootMessageId(
          threadRootSelectionFromSearch(window.location.search, requested),
        );
        setRoomData(undefined);
      }
    };
    window.addEventListener("popstate", selectFromHistory);
    return () => window.removeEventListener("popstate", selectFromHistory);
  }, [rooms]);

  useEffect(() => {
    const searchShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setFocusedMessageId(undefined);
        setSurface("search");
      }
    };
    window.addEventListener("keydown", searchShortcut);
    return () => window.removeEventListener("keydown", searchShortcut);
  }, []);

  const agentDirectoryQuery = useReconciledQuery(
    client,
    "agent.list",
    { controlRoomId: activeWorkspace?.controlRoomId ?? "none" },
    health?.capabilities.agentRead === true &&
      activeWorkspace?.controlRoomId !== undefined,
    reload,
  );
  useEffect(() => {
    const controlRoomId = activeWorkspace?.controlRoomId;
    if (
      !health?.capabilities.agentRead ||
      controlRoomId === undefined ||
      agentDirectoryQuery === undefined
    ) {
      setAgentCatalog([]);
      setAgentCatalogControlRoomId(undefined);
      return;
    }
    // A failed read is not an empty directory. The shared query retries and
    // retains only this client's current scope; permissions remain server-owned.
    if (agentDirectoryQuery?.data && !agentDirectoryQuery.error) {
      setAgentCatalog(agentDirectoryQuery.data.agents);
      setAgentCatalogControlRoomId(controlRoomId);
    }
  }, [
    activeWorkspace?.controlRoomId,
    health?.capabilities.agentRead,
    agentDirectoryQuery,
  ]);

  useEffect(() => {
    if (activeRoomId === undefined || health === undefined) return;
    const read = roomDataReads.current.begin();
    const taskWindowBeforeRead = taskWindows.current.get(activeRoomId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let caughtUp = true;
    setLoading(true);
    void (async () => {
      try {
        const session = roomSessionFor(
          sessions.current,
          client,
          consumerPrefix,
          activeRoomId,
        );
        const roomCatchUp = await session.syncUntilCurrent({
          limit: 500,
          maxPages: 4,
          signal: read.signal,
        });
        const messageSession = health.capabilities.messageRead
          ? getOrCreateBoundedSession(
              messageSessions.current,
              activeRoomId,
              () => new MessageSession({ client, roomId: activeRoomId }),
              8,
            )
          : undefined;
        const [
          messageResult,
          taskResult,
          threadResult,
          membershipResult,
          agentActivityResult,
        ] = await Promise.all([
          messageSession === undefined
            ? Promise.resolve({
                complete: true,
                cursorAfter: 0,
                cursorBefore: 0,
                hasEarlier: false,
                messages: [] as Message[],
                pages: 0,
              })
            : messageSession.syncUntilCurrent({
                limit: RAFT_MESSAGE_PAGE_SIZE,
                maxPages: 10,
                signal: read.signal,
              }),
          health.capabilities.taskRead
            ? refreshRoomTaskWindow(
                client,
                activeRoomId,
                taskWindowBeforeRead,
                read.signal,
              )
            : Promise.resolve(createRoomTaskWindow({ tasks: [] })),
          health.capabilities.threadRead
            ? client.request(
                "thread.list",
                { roomId: activeRoomId },
                { signal: read.signal },
              )
            : Promise.resolve({ threads: [] as Thread[] }),
          health.capabilities.memberRead
            ? client.request(
                "room.member.list",
                { roomId: activeRoomId },
                { signal: read.signal },
              )
            : Promise.resolve({
                memberships: [] as RoomMembership[],
              }),
          health.capabilities.agentRead
            ? client.request(
                "room.agent.activity.list",
                { roomId: activeRoomId },
                { signal: read.signal },
              )
            : Promise.resolve({ agents: [] as RoomAgentActivity[] }),
        ]);
        const mentionReadStates = await loadMessageReferenceReadStates(
          client,
          activeRoomId,
          messageResult.messages,
          read.signal,
        );
        if (!read.current()) return;
        caughtUp = roomCatchUp.caughtUp && messageResult.complete;
        const knownPrincipals = new Map(
          (roomCatchUp.state.snapshot?.members ?? []).map((principal) => [
            principal.principalId,
            principal,
          ]),
        );
        for (const entry of scopedAgentCatalog) {
          knownPrincipals.set(entry.definition.participantId, {
            handle: entry.handle,
            kind: "agent",
            principalId: entry.definition.participantId,
          });
        }
        for (const runtime of localRuntimes) {
          for (const binding of runtime.agentBindings) {
            knownPrincipals.set(binding.participantId, {
              handle: binding.handle,
              kind: "agent",
              principalId: binding.participantId,
            });
          }
        }
        const taskWindowAfterRead = taskWindows.current.get(activeRoomId);
        const projectedTaskWindow =
          taskWindowAfterRead !== undefined &&
          taskWindowAfterRead !== taskWindowBeforeRead
            ? taskWindowAfterRead
            : taskResult;
        if (projectedTaskWindow === taskResult)
          rememberRoomTaskWindow(taskWindows.current, activeRoomId, taskResult);
        setRoomData({
          activeMemberIds: health.capabilities.memberRead
            ? membershipResult.memberships.map(({ principalId }) => principalId)
            : (roomCatchUp.state.snapshot?.members ?? []).map(
                ({ principalId }) => principalId,
              ),
          agentActivity: agentActivityResult.agents,
          caughtUp,
          hasEarlierMessages: messageResult.hasEarlier,
          latestRoomSeq: roomCatchUp.state.latestRoomSeq,
          members: [...knownPrincipals.values()],
          mentionReadStates,
          memberships: membershipResult.memberships,
          messages: [...messageResult.messages],
          referenceEventsComplete: roomCatchUp.state.historyComplete,
          roomEvents: [...roomCatchUp.state.events],
          roomId: activeRoomId,
          ...(projectedTaskWindow.nextPage === undefined
            ? {}
            : { taskNextPage: projectedTaskWindow.nextPage }),
          tasks: projectedTaskWindow.tasks,
          threads: threadResult.threads,
        });
        setActiveThreadRootMessageId((current) =>
          current !== undefined &&
          messageResult.messages.some(
            (message) =>
              message.messageId === current && message.threadId === undefined,
          )
            ? current
            : undefined,
        );
        consecutivePollFailures.current = 0;
        setError(undefined);
      } catch (caught) {
        if (read.current()) {
          consecutivePollFailures.current += 1;
          setError(errorMessage(caught));
        }
      } finally {
        if (read.current()) {
          setLoading(false);
          timer = setTimeout(
            () => setReload((value) => value + 1),
            roomPollDelay({
              caughtUp,
              consecutiveFailures: consecutivePollFailures.current,
              visible: document.visibilityState === "visible",
            }),
          );
        }
      }
    })();
    return () => {
      read.cancel();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [
    activeRoomId,
    client,
    consumerPrefix,
    health,
    localRuntimes,
    reload,
    scopedAgentCatalog,
  ]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        setReload((value) => value + 1);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const activeMemberIdSet = new Set(roomData?.activeMemberIds ?? []);
  const currentRoomRole = roomData?.memberships.find(
    ({ principalId }) => principalId === currentPrincipal?.principalId,
  )?.role;
  const canManageCurrentRoomMembers = canManageRoomMembers({
    caughtUp: roomData?.caughtUp === true,
    memberWrite: health?.capabilities.memberWrite === true,
    role: currentRoomRole,
  });
  const canManageCurrentRoomRoles = canEditRoomMemberRole({
    actorRole: currentRoomRole,
    caughtUp: roomData?.caughtUp === true,
    memberWrite: health?.capabilities.memberWrite === true,
    subjectKind: "human",
  });
  const canOnboardCurrentRoomAgent = canOnboardWorkspaceAgent({
    agentOnboard: health?.capabilities.agentOnboard === true,
    caughtUp: roomData?.caughtUp === true,
    memberWrite: health?.capabilities.memberWrite === true,
    role: currentRoomRole,
  });
  const canCreateCurrentWorkspaceRoom = canCreateWorkspaceRoom({
    role: workspaceMembershipRole,
    roomWrite: health?.capabilities.roomWrite === true,
  });
  const currentRoomLeave = canHumanLeaveRoom({
    archived: activeRoom?.archivedAt !== undefined,
    caughtUp: roomData?.caughtUp === true,
    memberWrite: health?.capabilities.memberWrite === true,
    ownerCount:
      roomData?.memberships.filter(({ role }) => role === "owner").length ?? 0,
    role: currentRoomRole,
    roomKind: activeRoom?.kind,
  });
  const canManageCurrentWorkspaceAgent =
    health?.capabilities.agentWrite === true &&
    (workspaceMembershipRole === "owner" ||
      workspaceMembershipRole === "admin");
  const canChangeCurrentWorkspaceHumanRole =
    health?.capabilities.memberWrite === true &&
    workspaceMembershipRole === "owner";
  const canCreateCurrentWorkspaceAgent =
    canManageCurrentWorkspaceAgent &&
    localRuntimes.some(
      (runtime) =>
        runtime.available &&
        runtime.configured &&
        runtime.runtimeOfferId !== undefined,
    );
  const presenceQuery = useReconciledQuery(
    client,
    "agent.presence.list",
    {
      controlRoomId: activeWorkspace?.controlRoomId ?? "unselected",
    },
    health?.capabilities.agentPresenceRead === true &&
      activeWorkspace !== undefined,
  );
  const currentPresence = !presenceQuery?.error
    ? presenceQuery?.data?.agents
    : undefined;
  const presenceById = new Map(
    currentPresence?.map((value) => [value.agentDefinitionId, value]),
  );
  const agentDirectory = workspaceAgentDirectory({
    agents: scopedAgentCatalog,
    runtimes: localRuntimes,
  }).map((agent) => {
    const presence = presenceById.get(agent.agentDefinitionId);
    return {
      ...agent,
      ...(presence ? { presence } : {}),
      connectionStatus: computer?.status ?? ("unknown" as const),
    };
  });
  const entities = createWorkspaceEntities({
    workspaceId: activeWorkspace?.workspaceId,
    actorId: currentPrincipal?.principalId,
    human: currentPrincipal,
    humans: humanDirectoryQuery?.data?.humans ?? [],
    hostId: localRuntimeHostId,
    computer,
    agents: agentDirectory,
    runtimes: localRuntimes,
  });
  const diagnosticRooms = rooms
    .filter((room) => room.workspaceId === activeWorkspace?.workspaceId)
    .map((room) => {
      const peer = room.directParticipantIds?.find(
        (id) => id !== currentPrincipal?.principalId,
      );
      const handle = scopedAgentCatalog.find(
        (agent) => agent.definition.participantId === peer,
      )?.handle;
      return { ...room, ...(handle ? { peerHandle: handle } : {}) };
    });
  const messageReferenceRooms = rooms
    .filter(({ workspaceId }) => workspaceId === activeWorkspace?.workspaceId)
    .map((room) => {
      const peerNames =
        room.kind !== "direct"
          ? []
          : (room.directParticipantIds ?? [])
              .filter((id) => id !== currentPrincipal?.principalId)
              .flatMap((id) => {
                const agent = agentDirectory.find(
                  ({ participantId }) => participantId === id,
                );
                return agent === undefined ? [] : [agent.handle];
              });
      return {
        kind: room.kind,
        names: [room.slug],
        ...(room.kind === "direct"
          ? {
              peerNames: [...new Set(peerNames)],
            }
          : {}),
        roomId: room.roomId,
      };
    });
  const messageReferenceComputers =
    localRuntimeHostId === undefined
      ? []
      : [
          {
            hostId: localRuntimeHostId,
            names: [
              localRuntimeHostId,
              ...(computer === undefined
                ? []
                : [computer.displayName, computer.hostname]),
            ],
          },
        ];
  const activeDirectPeer =
    activeRoom?.kind === "direct"
      ? agentDirectory.find(({ participantId }) =>
          activeMemberIdSet.has(participantId),
        )
      : undefined;
  const roomMemberCandidates = roomAgentCandidates({
    directory: agentDirectory,
    memberIds: roomData?.activeMemberIds ?? [],
  });
  const roomAgents = roomAgentTargets(
    (roomData?.members ?? []).filter(({ principalId }) =>
      activeMemberIdSet.has(principalId),
    ),
  );
  const availableAgentIds = roomAgents.map(
    ({ participantId }) => participantId,
  );
  const memberHandleById = new Map(
    (roomData?.members ?? []).map(
      (member) => [member.principalId, member.handle] as const,
    ),
  );
  const threadReplyPreviews: ThreadReplyPreview[] = (roomData?.messages ?? [])
    .flatMap((message) =>
      message.threadId === undefined
        ? []
        : [
            {
              actorId: message.actorId,
              author: memberHandleById.get(message.actorId) ?? message.actorId,
              body: message.body,
              createdAt: message.createdAt,
              messageId: message.messageId,
              threadId: message.threadId,
            },
          ],
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const view = createRoomViewModel({
    members: roomData?.members ?? [],
    messages:
      messageContext?.message.threadId === undefined &&
      messageContext !== undefined
        ? messageContext.messages
        : [
            ...(roomData?.messages.filter(
              (message) =>
                message.threadId === undefined &&
                message.messageId !== messageContext?.rootMessageId,
            ) ?? []),
            ...(messageContext?.rootMessage
              ? [messageContext.rootMessage]
              : []),
          ],
    tasks: roomData?.tasks ?? [],
  });
  const activeThread = roomData?.threads.find(
    (thread) => thread.rootMessageId === activeThreadRootMessageId,
  );
  const activeThreadId = taskModalOpen
    ? detailTask?.threadId
    : activeThread?.threadId;
  useEffect(() => {
    activeThreadHistoryKey.current =
      activeRoomId && activeThreadId
        ? `${activeRoomId}:${activeThreadId}`
        : undefined;
    threadHistoryLoadingKey.current = undefined;
  }, [activeRoomId, activeThreadId]);
  const activeThreadTask = taskModalOpen
    ? detailTask
    : roomData?.tasks.find((task) => task.threadId === activeThreadId);
  const threadFollowers = useDiscoveryQuery(
    client,
    "thread.followers",
    {
      roomId: activeRoomId ?? "room-unavailable",
      threadId: activeThreadId ?? "thread-unavailable",
    },
    activeRoomId !== undefined && activeThreadId !== undefined,
  );
  const activeThreadRoot = view.messages.find(
    (message) => message.messageId === activeThreadRootMessageId,
  );
  const activeThreadRootRecord = [
    ...(roomData?.messages ?? []),
    ...(messageContext?.rootMessage ? [messageContext.rootMessage] : []),
  ].find((message) => message.messageId === activeThreadRootMessageId);
  const canonicalThreadMessages =
    activeThreadId === undefined
      ? []
      : threadMessages.filter((message) => message.threadId === activeThreadId);
  const contextualThreadMessages =
    activeThreadId !== undefined &&
    messageContext?.message.threadId === activeThreadId
      ? messageContext.messages.filter(
          (message) => message.threadId === activeThreadId,
        )
      : [];
  const visibleThreadMessages = [
    ...new Map(
      [...canonicalThreadMessages, ...contextualThreadMessages].map(
        (message) => [message.messageId, message],
      ),
    ).values(),
  ].sort((left, right) => (left.roomSeq ?? 0) - (right.roomSeq ?? 0));
  const threadView = createRoomViewModel({
    members: roomData?.members ?? [],
    messages:
      visibleThreadMessages.length > 0
        ? visibleThreadMessages
        : activeThreadId === undefined
          ? []
          : messageContext?.message.threadId === activeThreadId &&
              messageContext !== undefined
            ? messageContext.messages
            : [],
    tasks: [],
  });
  const activeThreadFollowerAgents =
    threadFollowers.data?.agentParticipantIds.flatMap((participantId) => {
      const agent = agentDirectory.find(
        (candidate) => candidate.participantId === participantId,
      );
      return agent === undefined ? [] : [agent];
    }) ?? [];
  const activeThreadTaskAgent = agentDirectory.find(
    (agent) => agent.participantId === activeThreadTask?.assigneeId,
  );
  const submitComposer = useCallback(
    async (
      body: string,
      asTask: boolean,
      taskParticipants: TaskParticipantSelection,
      attachmentIds: string[] = [],
    ) => {
      if (
        activeRoom === undefined ||
        roomData === undefined ||
        health === undefined
      )
        return;
      const id = browserOpaqueId();
      if (!roomData.caughtUp) {
        throw new Error("Room 尚未追赶到最新位置，暂不接受写入");
      }
      if (activeRoom.archivedAt !== undefined) {
        throw new Error("此 Room 已归档，只能读取历史记录");
      }
      const session = sessions.current.get(activeRoom.roomId);
      if (session === undefined) {
        throw new Error("当前 Room 尚未建立 canonical session");
      }
      if (asTask) {
        if (!health.capabilities.taskWrite) {
          throw new Error("daemon 未开放 Task write capability");
        }
        await runRoomMutationAtLatest({
          mutate: (basedOnRoomSeq) =>
            client.request("task.create", {
              ...taskParticipants,
              basedOnRoomSeq,
              dependencyTaskIds: [],
              idempotencyKey: `web-task-${id}`,
              roomId: activeRoom.roomId,
              title: body,
            }),
          session,
        });
      } else {
        if (!health.capabilities.messageWrite) {
          throw new Error("daemon 未开放 Message write capability");
        }
        await runRoomMutationAtLatest({
          mutate: (basedOnRoomSeq) =>
            client.request("message.post", {
              ...(attachmentIds.length ? { attachmentIds } : {}),
              basedOnRoomSeq,
              body,
              // A lost HTTP response must not strand a consumed attachment behind a new request key.
              idempotencyKey: attachmentIds[0]
                ? `web-file-message-${attachmentIds[0]}`
                : `web-message-${id}`,
              recipients: roomMessageAttentionRecipients({
                availableAgents: roomAgents,
                mentionedParticipantIds: mentionedRoomAgentIds({
                  agents: roomAgents,
                  body,
                }),
              }),
              roomId: activeRoom.roomId,
            }),
          session,
        });
      }
      setFocusedMessageId((current) =>
        focusAfterSuccessfulSubmit(current, focusedMessageId),
      );
      setReload((value) => value + 1);
    },
    [activeRoom, client, focusedMessageId, health, roomAgents, roomData],
  );

  const convertMessageToTask = useCallback(
    async (messageId: string) => {
      if (activeRoom === undefined || roomData === undefined) return;
      if (health?.capabilities.taskWrite !== true) {
        throw new Error("daemon 未开放 Task write capability");
      }
      if (!roomData.caughtUp) {
        throw new Error("Room 尚未追赶到最新位置，暂不接受写入");
      }
      const session = sessions.current.get(activeRoom.roomId);
      if (session === undefined) {
        throw new Error("当前 Room 尚未建立 canonical session");
      }
      await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("task.convert", {
            basedOnRoomSeq,
            dependencyTaskIds: [],
            idempotencyKey: `web-task-convert-${browserOpaqueId()}`,
            messageId,
            roomId: activeRoom.roomId,
          }),
        session,
      });
      setReload((value) => value + 1);
    },
    [activeRoom, client, health, roomData],
  );

  const updateMessageTaskWorkflow = useCallback(
    async (task: Task) => {
      if (health?.capabilities.taskWrite !== true)
        throw new Error("daemon 未开放 Task write capability");
      if (!roomData?.caughtUp)
        throw new Error("Room 尚未追赶到最新位置，暂不接受写入");
      const session = sessions.current.get(task.roomId);
      if (session === undefined)
        throw new Error("当前 Room 尚未建立 canonical session");
      const canManage =
        currentRoomRole === "owner" ||
        currentRoomRole === "admin" ||
        task.creatorId === currentPrincipal?.principalId;
      await applyGlobalTaskTransition({
        canManageAnyTask: canManage,
        client,
        idempotencyKey: `message-task-${browserOpaqueId()}`,
        session,
        target: messageTaskMenuTarget(task),
        task,
      });
      setReload((value) => value + 1);
    },
    [client, currentPrincipal, currentRoomRole, health, roomData],
  );

  const createBoardTask = useCallback(
    async (input: TaskCreateInput, onAccepted: (clientId: string) => void) => {
      if (activeRoom === undefined || roomData === undefined) return;
      if (health?.capabilities.taskWrite !== true) {
        throw new Error("daemon 未开放 Task write capability");
      }
      if (!roomData.caughtUp) {
        throw new Error("Room 尚未追赶到最新位置，暂不接受写入");
      }
      const session = sessions.current.get(activeRoom.roomId);
      if (session === undefined) {
        throw new Error("当前 Room 尚未建立 canonical session");
      }
      await submitTaskCreateRows({
        ...input,
        client,
        ledger: taskCreateCommandLedger.current,
        onAccepted,
        roomId: activeRoom.roomId,
        session,
      });
      setReload((value) => value + 1);
    },
    [activeRoom, client, health, roomData],
  );

  const loadEarlierTasks = useCallback(async () => {
    if (
      activeRoomId === undefined ||
      earlierTasksLoading ||
      roomData?.taskNextPage === undefined
    )
      return;
    const cursor = roomData.taskNextPage;
    setEarlierTasksLoading(true);
    try {
      const result = await loadEarlierRoomTaskOverview(
        client,
        activeRoomId,
        cursor,
      );
      setRoomData((current) => {
        if (current === undefined || current.roomId !== activeRoomId)
          return current;
        const taskWindow = taskWindows.current.get(activeRoomId);
        if (
          taskWindow === undefined ||
          !sameRoomTaskPageCursor(taskWindow.nextPage, cursor)
        )
          return current;
        const nextWindow = appendRoomTaskWindowPage(taskWindow, cursor, result);
        rememberRoomTaskWindow(taskWindows.current, activeRoomId, nextWindow);
        return {
          ...current,
          ...(nextWindow.nextPage === undefined
            ? { taskNextPage: undefined }
            : { taskNextPage: nextWindow.nextPage }),
          tasks: nextWindow.tasks,
        };
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setEarlierTasksLoading(false);
    }
  }, [activeRoomId, client, earlierTasksLoading, roomData?.taskNextPage]);

  const openThread = useCallback(
    async (rootMessageId: string, returnFocusTarget?: HTMLElement | null) => {
      if (
        activeRoom === undefined ||
        roomData === undefined ||
        health === undefined ||
        !health.capabilities.threadRead
      )
        return;
      try {
        if (
          !view.messages.some((message) => message.messageId === rootMessageId)
        ) {
          throw new Error("Thread 原消息尚未载入");
        }
        setPanelIntent((intent) => ({ ...intent, latest: "thread" }));
        if (activeThreadRootMessageId !== rootMessageId) {
          setThreadMessages([]);
          setThreadHasEarlierReplies(false);
        }
        rememberThreadFocus(returnFocusTarget);
        invalidateNavigation();
        setActiveThreadRootMessageId(rootMessageId);
        setError(undefined);
      } catch (caught) {
        setError(errorMessage(caught));
        setReload((value) => value + 1);
      }
    },
    [
      activeThreadRootMessageId,
      activeRoom,
      health,
      roomData,
      view.messages,
      invalidateNavigation,
      rememberThreadFocus,
    ],
  );

  useEffect(() => {
    if (
      activeRoomId === undefined ||
      activeThreadId === undefined ||
      health === undefined ||
      !health.capabilities.threadRead
    ) {
      setThreadMessages([]);
      setThreadMentionReadStates(new Map());
      setThreadHasEarlierReplies(false);
      setThreadLoading(false);
      return;
    }
    const controller = new AbortController();
    setThreadLoading(true);
    void (async () => {
      try {
        const sessionKey = `${activeRoomId}:${activeThreadId}`;
        const session = getOrCreateBoundedSession(
          threadMessageSessions.current,
          sessionKey,
          () =>
            new MessageSession({
              client,
              roomId: activeRoomId,
              threadId: activeThreadId,
            }),
          8,
        );
        const initial = await session.syncUntilCurrent({
          limit: RAFT_MESSAGE_PAGE_SIZE,
          maxPages: 4,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setThreadMessages([...session.state.messages]);
        const mentionReadStates = await loadMessageReferenceReadStates(
          client,
          activeRoomId,
          initial.messages,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setThreadMentionReadStates(mentionReadStates);
        setThreadHasEarlierReplies(session.state.hasEarlier);
      } catch (caught) {
        if (!controller.signal.aborted) setError(errorMessage(caught));
      } finally {
        if (!controller.signal.aborted) setThreadLoading(false);
      }
    })();
    return () => controller.abort();
    // Activity/catalog refreshes can restart Room reads before their reload timer
    // fires. Follow committed Room reads as well, including recovery without a
    // new sequence number; keep the existing MessageSession and history window.
  }, [activeRoomId, activeThreadId, client, health, reload, roomData]);

  const loadThreadHistory = useCallback(async () => {
    if (
      activeRoomId === undefined ||
      activeThreadId === undefined ||
      threadHistoryLoadingKey.current === `${activeRoomId}:${activeThreadId}`
    )
      return;
    const sessionKey = `${activeRoomId}:${activeThreadId}`;
    const session = threadMessageSessions.current.get(sessionKey);
    if (session === undefined || !session.state.hasEarlier) return;
    threadHistoryLoadingKey.current = sessionKey;
    setThreadEarlierRepliesLoading(true);
    try {
      const result = await loadThreadHistoryPages(session, {
        limit: RAFT_MESSAGE_PAGE_SIZE,
      });
      if (activeThreadHistoryKey.current === sessionKey) {
        const mentionReadStates = await loadMessageReferenceReadStates(
          client,
          activeRoomId,
          result.messages,
        );
        if (activeThreadHistoryKey.current !== sessionKey) return;
        setThreadMessages([...result.messages]);
        setThreadMentionReadStates(mentionReadStates);
        setThreadHasEarlierReplies(result.hasEarlier);
      }
    } catch (caught) {
      if (activeThreadHistoryKey.current === sessionKey)
        setError(errorMessage(caught));
    } finally {
      if (activeThreadHistoryKey.current === sessionKey)
        setThreadEarlierRepliesLoading(false);
      if (threadHistoryLoadingKey.current === sessionKey)
        threadHistoryLoadingKey.current = undefined;
    }
  }, [activeRoomId, activeThreadId, client]);
  const loadEarlierThreadMessages = useCallback(
    () => loadThreadHistory(),
    [loadThreadHistory],
  );

  const searchActiveThread = useCallback(
    async (
      query: string,
      signal: AbortSignal,
    ): Promise<readonly ThreadSearchMatch[]> => {
      if (
        activeWorkspace === undefined ||
        activeRoomId === undefined ||
        activeThreadId === undefined
      )
        return [];
      const matches: ThreadSearchMatch[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.request(
          "search",
          {
            workspaceId: activeWorkspace.workspaceId,
            query,
            limit: 100,
            roomIds: [activeRoomId],
            scope: "thread",
            sort: "recent",
            threadIds: [activeThreadId],
            ...(cursor === undefined ? {} : { cursor }),
          },
          { signal },
        );
        for (const hit of page.hits)
          if (hit.target.kind === "message")
            matches.push({
              messageId: hit.message.messageId,
              target: hit.target,
            });
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      return matches.reverse();
    },
    [activeRoomId, activeThreadId, activeWorkspace, client],
  );

  const ensureActiveThread = useCallback(async () => {
    if (activeThread !== undefined)
      return { createdRoomSeq: 0, thread: activeThread };
    if (
      activeRoom === undefined ||
      activeThreadRootMessageId === undefined ||
      roomData === undefined
    )
      throw new Error("当前消息列已不可用");
    if (!roomData.caughtUp)
      throw new Error("Room 尚未追赶到最新位置，暂不能创建消息列");
    const session = sessions.current.get(activeRoom.roomId);
    if (session === undefined)
      throw new Error("当前 Room 尚未建立 canonical session");
    const created = await runRoomMutationAtLatest({
      mutate: (basedOnRoomSeq) =>
        client.request("thread.create", {
          basedOnRoomSeq,
          idempotencyKey: `web-thread-${browserOpaqueId()}`,
          recipientIds: [],
          roomId: activeRoom.roomId,
          rootMessageId: activeThreadRootMessageId,
        }),
      session,
    });
    setRoomData((current) =>
      current === undefined
        ? current
        : {
            ...current,
            latestRoomSeq: Math.max(
              current.latestRoomSeq,
              created.event.roomSeq,
            ),
            threads: current.threads.some(
              ({ threadId }) => threadId === created.thread.threadId,
            )
              ? current.threads
              : [...current.threads, created.thread],
          },
    );
    return { createdRoomSeq: created.event.roomSeq, thread: created.thread };
  }, [activeRoom, activeThread, activeThreadRootMessageId, client, roomData]);

  const loadEarlierMessages = useCallback(async () => {
    if (activeRoomId === undefined || earlierMessagesLoading) return;
    const session = messageSessions.current.get(activeRoomId);
    if (session === undefined || !session.state.hasEarlier) return;
    setEarlierMessagesLoading(true);
    try {
      const result = await session.loadEarlier({
        limit: RAFT_MESSAGE_PAGE_SIZE,
      });
      const mentionReadStates = await loadMessageReferenceReadStates(
        client,
        activeRoomId,
        result.messages,
      );
      setRoomData((current) =>
        current === undefined
          ? current
          : {
              ...current,
              hasEarlierMessages: result.hasEarlier,
              mentionReadStates,
              messages: [...result.messages],
            },
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setEarlierMessagesLoading(false);
    }
  }, [activeRoomId, client, earlierMessagesLoading]);

  const submitThreadReply = useCallback(
    async (body: string, attachmentIds: string[] = []) => {
      if (
        activeRoom === undefined ||
        activeThreadRootMessageId === undefined ||
        roomData === undefined ||
        health === undefined
      )
        return;
      if (!health.capabilities.threadWrite) {
        throw new Error("daemon 未开放 Thread write capability");
      }
      if (!roomData.caughtUp) {
        throw new Error("Room 尚未追赶到最新位置，暂不接受 Thread 回复");
      }
      const { createdRoomSeq, thread } = await ensureActiveThread();
      const session = sessions.current.get(activeRoom.roomId);
      if (session === undefined)
        throw new Error("当前 Room 尚未建立 canonical session");
      const idempotencyKey = `web-thread-reply-${browserOpaqueId()}`;
      const replied = await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("thread.reply", {
            ...(attachmentIds.length ? { attachmentIds } : {}),
            basedOnRoomSeq,
            body,
            idempotencyKey: attachmentIds[0]
              ? `web-thread-file-reply-${attachmentIds[0]}`
              : idempotencyKey,
            recipientIds: availableAgentIds,
            roomId: activeRoom.roomId,
            threadId: thread.threadId,
          }),
        session,
      });
      const updatedThread = {
        ...thread,
        lastReplyAt: replied.event.createdAt,
        replyCount: thread.replyCount + 1,
      };
      setRoomData((current) =>
        current === undefined
          ? current
          : {
              ...current,
              latestRoomSeq: Math.max(
                current.latestRoomSeq,
                createdRoomSeq,
                replied.event.roomSeq,
              ),
              threads: current.threads.some(
                ({ threadId }) => threadId === updatedThread.threadId,
              )
                ? current.threads.map((candidate) =>
                    candidate.threadId === updatedThread.threadId
                      ? updatedThread
                      : candidate,
                  )
                : [...current.threads, updatedThread],
            },
      );
      setFocusedMessageId((current) =>
        focusAfterSuccessfulSubmit(current, focusedMessageId),
      );
      threadFollowers.refresh();
      setReload((value) => value + 1);
    },
    [
      activeRoom,
      activeThreadRootMessageId,
      availableAgentIds,
      client,
      ensureActiveThread,
      focusedMessageId,
      health,
      roomData,
    ],
  );

  const onboardAgent = useCallback(
    async (binding: AgentMembershipIdentity) => {
      if (activeRoom === undefined || roomData === undefined) return;
      if (!canOnboardCurrentRoomAgent) {
        throw new Error("当前 Human 没有在此 Room 添加 Agent 的权限");
      }
      if (!roomData.caughtUp) {
        throw new Error("Room 尚未追赶到最新位置，暂不能添加 Agent");
      }
      const session = sessions.current.get(activeRoom.roomId);
      if (session === undefined) {
        throw new Error("当前 Room 尚未建立 canonical session");
      }
      const idempotencyKey = `web-agent-onboard-${browserOpaqueId()}`;
      const result = await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          ensureRoomMembership(client, {
            agentDefinitionId: binding.agentDefinitionId,
            basedOnRoomSeq,
            idempotencyKey,
            participantId: binding.participantId,
            roomId: activeRoom.roomId,
          }),
        session,
      });
      setRoomData((current) =>
        current === undefined
          ? current
          : {
              ...current,
              activeMemberIds: current.activeMemberIds.includes(
                binding.participantId,
              )
                ? current.activeMemberIds
                : [...current.activeMemberIds, binding.participantId],
              caughtUp: result.changed ? current.caughtUp : false,
              latestRoomSeq:
                result.changed && result.event !== undefined
                  ? Math.max(current.latestRoomSeq, result.event.roomSeq)
                  : current.latestRoomSeq,
              members: current.members.some(
                ({ principalId }) =>
                  principalId === result.membership.principalId,
              )
                ? current.members
                : [
                    ...current.members,
                    {
                      handle: binding.handle,
                      kind: "agent" as const,
                      principalId: binding.participantId,
                    },
                  ],
            },
      );
      setReload((value) => value + 1);
    },
    [activeRoom, canOnboardCurrentRoomAgent, client, roomData],
  );

  const removeAgent = useCallback(
    async (binding: AgentMembershipIdentity) => {
      if (activeRoom === undefined || roomData === undefined) return;
      if (!canManageCurrentRoomMembers) {
        throw new Error("当前 Human 没有在此 Room 移除 Agent 的权限");
      }
      if (!roomData.caughtUp) {
        throw new Error("Room 尚未追赶到最新位置，暂不能移除 Agent");
      }
      const session = sessions.current.get(activeRoom.roomId);
      if (session === undefined) {
        throw new Error("当前 Room 尚未建立 canonical session");
      }
      const idempotencyKey = `web-agent-remove-${browserOpaqueId()}`;
      const result = await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          ensureRoomMembershipRemoved(client, {
            basedOnRoomSeq,
            idempotencyKey,
            participantId: binding.participantId,
            roomId: activeRoom.roomId,
          }),
        session,
      });
      setRoomData((current) =>
        current === undefined
          ? current
          : {
              ...current,
              activeMemberIds: current.activeMemberIds.filter(
                (principalId) => principalId !== binding.participantId,
              ),
              caughtUp: result.changed ? current.caughtUp : false,
              latestRoomSeq:
                result.changed && result.event !== undefined
                  ? Math.max(current.latestRoomSeq, result.event.roomSeq)
                  : current.latestRoomSeq,
            },
      );
      setReload((value) => value + 1);
    },
    [activeRoom, canManageCurrentRoomMembers, client, roomData],
  );

  const setRoomMemberRole = useCallback(
    async (principalId: string, role: MembershipRole) => {
      if (activeRoom === undefined || roomData === undefined) return;
      if (!canManageCurrentRoomRoles) {
        throw new Error("只有 Room 所有者可以修改 Human 角色");
      }
      if (!roomData.caughtUp) {
        throw new Error("Room 尚未追赶到最新位置，暂不能修改角色");
      }
      const subject = roomData.members.find(
        (member) => member.principalId === principalId,
      );
      if (subject?.kind !== "human") {
        throw new Error("该入口只管理 Human 的 Room 角色");
      }
      const session = sessions.current.get(activeRoom.roomId);
      if (session === undefined) {
        throw new Error("当前 Room 尚未建立 canonical session");
      }
      const result = await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("room.member.role", {
            basedOnRoomSeq,
            idempotencyKey: `web-member-role-${browserOpaqueId()}`,
            principalId,
            role,
            roomId: activeRoom.roomId,
          }),
        session,
      });
      setRoomData((current) =>
        current === undefined
          ? current
          : {
              ...current,
              latestRoomSeq: Math.max(
                current.latestRoomSeq,
                result.event.roomSeq,
              ),
              memberships: current.memberships.map((membership) =>
                membership.principalId === result.membership.principalId
                  ? result.membership
                  : membership,
              ),
            },
      );
      setReload((value) => value + 1);
    },
    [activeRoom, canManageCurrentRoomRoles, client, roomData],
  );

  const updateRoom = useCallback(
    async (input: {
      description?: string;
      name: string;
      visibility: "private" | "public";
    }) => {
      if (activeRoom === undefined || roomData === undefined) return;
      if (!canManageCurrentRoomMembers) {
        throw new Error("当前 Human 没有修改此频道设置的权限");
      }
      if (!roomData.caughtUp) {
        throw new Error("Room 尚未追赶到最新位置，暂不能修改频道设置");
      }
      const session = sessions.current.get(activeRoom.roomId);
      if (session === undefined) {
        throw new Error("当前 Room 尚未建立 canonical session");
      }
      const result = await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("room.update", {
            basedOnRoomSeq,
            ...(input.description === undefined
              ? {}
              : { description: input.description }),
            idempotencyKey: `web-room-update-${browserOpaqueId()}`,
            name: input.name,
            roomId: activeRoom.roomId,
            visibility: input.visibility,
          }),
        session,
      });
      setRooms((current) =>
        current.map((room) =>
          room.roomId === result.room.roomId ? result.room : room,
        ),
      );
      setRoomData((current) =>
        current === undefined
          ? current
          : {
              ...current,
              latestRoomSeq: Math.max(
                current.latestRoomSeq,
                result.event.roomSeq,
              ),
            },
      );
      setReload((value) => value + 1);
    },
    [activeRoom, canManageCurrentRoomMembers, client, roomData],
  );

  const unreadHeld = useRef(new Set<string>());
  const pendingReads = useRef(new Set<Promise<unknown>>());
  useEffect(
    () => () => {
      if (activeRoomId) unreadHeld.current.delete(activeRoomId);
    },
    [activeRoomId],
  );
  const sidebarArchive = async (roomId: string) => {
    const session = roomSessionFor(
      sessions.current,
      client,
      consumerPrefix,
      roomId,
    );
    const result = await runRoomMutationAtLatest({
      session,
      mutate: (basedOnRoomSeq) =>
        client.request("room.archive", {
          roomId,
          basedOnRoomSeq,
          idempotencyKey: `web-context-archive-${browserOpaqueId()}`,
        }),
    });
    setRooms((current) =>
      current.map((room) => (room.roomId === roomId ? result.room : room)),
    );
    setArchivedRooms((current) => [
      ...current.filter((room) => room.roomId !== roomId),
      result.room,
    ]);
    if (activeRoomId === roomId)
      setActiveRoomId(rooms.find((room) => room.slug === "all")?.roomId);
    setReload((value) => value + 1);
  };
  const sidebarUnread = async (roomId: string, unread: boolean) => {
    unreadHeld.current.add(roomId);
    try {
      await Promise.allSettled([...pendingReads.current]);
      const page = await client.request("message.list", { roomId, limit: 1 });
      await client.request("activity.mark", {
        roomId,
        throughSeq: page.messages[0]?.roomSeq ?? 0,
        action: unread ? "unread" : "read",
      });
      if (!unread) unreadHeld.current.delete(roomId);
      setReload((value) => value + 1);
    } catch (e) {
      unreadHeld.current.delete(roomId);
      throw e;
    }
  };

  const unarchiveRoomFromCreate = useCallback(
    async (room: Room, openAfter = true) => {
      if (!canCreateCurrentWorkspaceRoom) {
        throw new Error("当前 Human 没有取消归档此频道的权限");
      }
      const session = roomSessionFor(
        sessions.current,
        client,
        consumerPrefix,
        room.roomId,
      );
      const navigationIntent = invalidateNavigation();
      const result = await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("room.unarchive", {
            basedOnRoomSeq,
            idempotencyKey: `web-room-unarchive-${browserOpaqueId()}`,
            roomId: room.roomId,
          }),
        session,
      });
      setArchivedRooms((current) =>
        current.filter(({ roomId }) => roomId !== result.room.roomId),
      );
      setRooms((current) =>
        current.some(({ roomId }) => roomId === result.room.roomId)
          ? current.map((candidate) =>
              candidate.roomId === result.room.roomId ? result.room : candidate,
            )
          : [...current, result.room],
      );
      if (!openAfter || navigationGeneration.current !== navigationIntent)
        return;
      setRoomCreateOpen(false);
      setRoomData(undefined);
      setActiveThreadRootMessageId(undefined);
      setThreadMessages([]);
      setActiveRoomId(result.room.roomId);
      setSurface("room");
      setTab("chat");
    },
    [
      canCreateCurrentWorkspaceRoom,
      client,
      consumerPrefix,
      invalidateNavigation,
    ],
  );

  const changeRoomArchiveState = useCallback(
    async (archive: boolean) => {
      if (activeRoom === undefined || roomData === undefined) return;
      if (!canManageCurrentRoomMembers) {
        throw new Error("当前 Human 没有归档或恢复此频道的权限");
      }
      if (!roomData.caughtUp) {
        throw new Error("Room 尚未追赶到最新位置，暂不能改变归档状态");
      }
      const session = sessions.current.get(activeRoom.roomId);
      if (session === undefined) {
        throw new Error("当前 Room 尚未建立 canonical session");
      }
      const result = await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request(archive ? "room.archive" : "room.unarchive", {
            basedOnRoomSeq,
            idempotencyKey: `web-room-${archive ? "archive" : "unarchive"}-${browserOpaqueId()}`,
            roomId: activeRoom.roomId,
          }),
        session,
      });
      setRooms((current) =>
        archive
          ? current.filter((room) => room.roomId !== result.room.roomId)
          : current.some((room) => room.roomId === result.room.roomId)
            ? current.map((room) =>
                room.roomId === result.room.roomId ? result.room : room,
              )
            : [...current, result.room],
      );
      setArchivedRooms((current) =>
        archive
          ? current.some(({ roomId }) => roomId === result.room.roomId)
            ? current.map((room) =>
                room.roomId === result.room.roomId ? result.room : room,
              )
            : [...current, result.room]
          : current.filter(({ roomId }) => roomId !== result.room.roomId),
      );
      setRoomData((current) =>
        current === undefined
          ? current
          : {
              ...current,
              latestRoomSeq: Math.max(
                current.latestRoomSeq,
                result.event.roomSeq,
              ),
            },
      );
      setReload((value) => value + 1);
    },
    [activeRoom, canManageCurrentRoomMembers, client, roomData],
  );

  const stopCurrentRoomAgents = useCallback(async () => {
    if (activeRoom === undefined || roomData === undefined) return;
    if (!canManageCurrentRoomMembers) {
      throw new Error("当前 Human 没有停止此频道 Agent 的权限");
    }
    if (!roomData.caughtUp) {
      throw new Error("Room 尚未追赶到最新位置，暂不能停止 Agent");
    }
    const session = sessions.current.get(activeRoom.roomId);
    if (session === undefined) {
      throw new Error("当前 Room 尚未建立 canonical session");
    }
    const result = await runRoomMutationAtLatest({
      mutate: (basedOnRoomSeq) =>
        client.request("room.sos.stop", {
          basedOnRoomSeq,
          idempotencyKey: `web-room-sos-stop-${browserOpaqueId()}`,
          roomId: activeRoom.roomId,
        }),
      session,
    });
    setRoomData((current) =>
      current === undefined
        ? current
        : {
            ...current,
            latestRoomSeq: Math.max(
              current.latestRoomSeq,
              result.event.roomSeq,
            ),
          },
    );
    setReload((value) => value + 1);
  }, [activeRoom, canManageCurrentRoomMembers, client, roomData]);

  const resumeCurrentRoomAgents = useCallback(
    async (guidance: string) => {
      if (activeRoom === undefined || roomData === undefined) return;
      if (!canManageCurrentRoomMembers) {
        throw new Error("当前 Human 没有恢复此频道 Agent 的权限");
      }
      if (!roomData.caughtUp) {
        throw new Error("Room 尚未追赶到最新位置，暂不能恢复 Agent");
      }
      const session = sessions.current.get(activeRoom.roomId);
      if (session === undefined) {
        throw new Error("当前 Room 尚未建立 canonical session");
      }
      const result = await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("room.sos.resume", {
            basedOnRoomSeq,
            guidance,
            idempotencyKey: `web-room-sos-resume-${browserOpaqueId()}`,
            roomId: activeRoom.roomId,
          }),
        session,
      });
      setRoomData((current) =>
        current === undefined
          ? current
          : {
              ...current,
              latestRoomSeq: Math.max(
                current.latestRoomSeq,
                result.event.roomSeq,
              ),
            },
      );
      setReload((value) => value + 1);
    },
    [activeRoom, canManageCurrentRoomMembers, client, roomData],
  );

  const leaveCurrentRoom = useCallback(async () => {
    if (activeRoom === undefined || roomData === undefined) return;
    if (!currentRoomLeave.allowed) {
      throw new Error(currentRoomLeave.reason ?? "当前 Human 不能退出此频道");
    }
    const session = sessions.current.get(activeRoom.roomId);
    if (session === undefined) {
      throw new Error("当前 Room 尚未建立 canonical session");
    }
    const leavingRoomId = activeRoom.roomId;
    const leavingWorkspaceId = activeRoom.workspaceId;
    const navigationIntent = navigationGeneration.current;
    await runRoomMutationAtLatest({
      mutate: (basedOnRoomSeq) =>
        client.request("room.leave", {
          basedOnRoomSeq,
          idempotencyKey: `web-room-leave-${browserOpaqueId()}`,
          roomId: leavingRoomId,
        }),
      session,
    });
    sessions.current.delete(leavingRoomId);
    setRooms((current) =>
      current.filter(({ roomId }) => roomId !== leavingRoomId),
    );
    setReload((value) => value + 1);
    if (navigationGeneration.current !== navigationIntent) return;
    const remaining = rooms.filter(({ roomId }) => roomId !== leavingRoomId);
    const nextRoom =
      remaining.find(({ workspaceId }) => workspaceId === leavingWorkspaceId) ??
      remaining[0];
    invalidateNavigation();
    setRoomMembersOpen(false);
    setRoomData(undefined);
    setActiveThreadRootMessageId(undefined);
    setThreadMessages([]);
    setFocusedMessageId(undefined);
    setActiveRoomId(nextRoom?.roomId);
    setSurface("room");
    setTab("chat");
    if (nextRoom === undefined) {
      const search = new URLSearchParams(window.location.search);
      for (const key of ["room", "roomTab", "thread", "message", "target"])
        search.delete(key);
      window.history.replaceState(null, "", `?${search}`);
    }
  }, [
    activeRoom,
    client,
    currentRoomLeave.allowed,
    currentRoomLeave.reason,
    invalidateNavigation,
    roomData,
    rooms,
  ]);

  const deleteCurrentRoom = useCallback(async () => {
    if (activeRoom === undefined || roomData === undefined) return;
    if (!canManageCurrentRoomMembers) {
      throw new Error("当前 Human 没有永久删除此频道的权限");
    }
    if (!roomData.caughtUp) {
      throw new Error("Room 尚未追赶到最新位置，暂不能永久删除");
    }
    const session = sessions.current.get(activeRoom.roomId);
    if (session === undefined) {
      throw new Error("当前 Room 尚未建立 canonical session");
    }
    const deletingRoomId = activeRoom.roomId;
    const deletingWorkspaceId = activeRoom.workspaceId;
    const navigationIntent = navigationGeneration.current;
    await runRoomMutationAtLatest({
      mutate: (basedOnRoomSeq) =>
        client.request("room.delete", {
          basedOnRoomSeq,
          idempotencyKey: `web-room-delete-${browserOpaqueId()}`,
          roomId: deletingRoomId,
        }),
      session,
    });
    sessions.current.delete(deletingRoomId);
    setRooms((current) =>
      current.filter(({ roomId }) => roomId !== deletingRoomId),
    );
    setArchivedRooms((current) =>
      current.filter(({ roomId }) => roomId !== deletingRoomId),
    );
    setReload((value) => value + 1);
    if (navigationGeneration.current !== navigationIntent) return;
    const remaining = rooms.filter(({ roomId }) => roomId !== deletingRoomId);
    const nextRoom =
      remaining.find(
        ({ kind, workspaceId }) =>
          workspaceId === deletingWorkspaceId && kind !== "control",
      ) ??
      remaining.find(
        ({ workspaceId }) => workspaceId === deletingWorkspaceId,
      ) ??
      remaining[0];
    invalidateNavigation();
    setRoomMembersOpen(false);
    setRoomData(undefined);
    setActiveThreadRootMessageId(undefined);
    setThreadMessages([]);
    setFocusedMessageId(undefined);
    setActiveRoomId(nextRoom?.roomId);
    setSurface("room");
    setTab("chat");
    if (nextRoom === undefined) {
      const search = new URLSearchParams(window.location.search);
      for (const key of ["room", "roomTab", "thread", "message", "target"])
        search.delete(key);
      window.history.replaceState(null, "", `?${search}`);
    }
  }, [
    activeRoom,
    canManageCurrentRoomMembers,
    client,
    invalidateNavigation,
    roomData,
    rooms,
  ]);

  const createRoom = useCallback(
    async (input: {
      description?: string;
      initialAgentParticipantIds: string[];
      name: string;
      slug: string;
      visibility: "private" | "public";
    }) => {
      if (!canCreateCurrentWorkspaceRoom) {
        throw new Error("当前 Human 没有在此 Workspace 创建 Room 的权限");
      }
      const workspace = activeWorkspace;
      const controlRoomId = workspace?.controlRoomId;
      if (workspace === undefined || controlRoomId === undefined) {
        throw new Error("当前 Workspace 没有可写 control Room");
      }
      const controlSession = roomSessionFor(
        sessions.current,
        client,
        consumerPrefix,
        controlRoomId,
      );
      const idempotencyKey = `web-room-create-${browserOpaqueId()}`;
      const navigationIntent = invalidateNavigation();
      const result = await runRoomMutationAtLatest({
        mutate: (basedOnControlRoomSeq) =>
          client.request("room.create", {
            basedOnControlRoomSeq,
            ...(input.description === undefined
              ? {}
              : { description: input.description }),
            idempotencyKey,
            initialAgentParticipantIds: input.initialAgentParticipantIds,
            kind: "channel",
            name: input.name,
            slug: input.slug,
            visibility: input.visibility,
            workspaceId: workspace.workspaceId,
          }),
        session: controlSession,
      });
      setRooms((current) =>
        current.some(({ roomId }) => roomId === result.room.roomId)
          ? current
          : [...current, result.room],
      );
      if (navigationGeneration.current !== navigationIntent) return;
      setActiveThreadRootMessageId(undefined);
      setThreadMessages([]);
      setRoomData(undefined);
      setActiveRoomId(result.room.roomId);
      setRoomCreateOpen(false);
      setMobileRoomsOpen(false);
      setSurface("room");
      setTab("chat");
    },
    [
      activeWorkspace,
      canCreateCurrentWorkspaceRoom,
      client,
      consumerPrefix,
      invalidateNavigation,
    ],
  );

  const openDirectRoom = useCallback(
    async (peerPrincipalId: string): Promise<void> => {
      const navigationIntent = invalidateNavigation();
      const requestKey = `${activeWorkspace?.workspaceId}:${peerPrincipalId}`;
      let operation = directRoomOpenRequests.current.get(requestKey);
      if (operation === undefined) {
        operation = (async () => {
          const workspace = activeWorkspace;
          const controlRoomId = workspace?.controlRoomId;
          if (workspace === undefined || controlRoomId === undefined) {
            throw new Error("当前 Workspace 没有可写 control Room");
          }
          if (
            health?.capabilities.roomWrite !== true ||
            workspaceMembershipRole === undefined
          ) {
            throw new Error("当前 Human 不能在此 Workspace 发起私信");
          }
          const controlSession = roomSessionFor(
            sessions.current,
            client,
            consumerPrefix,
            controlRoomId,
          );
          const result = await runRoomMutationAtLatest({
            mutate: (basedOnControlRoomSeq) =>
              client.request("room.direct.open", {
                basedOnControlRoomSeq,
                idempotencyKey: `web-direct-open-${browserOpaqueId()}`,
                peerPrincipalId,
                workspaceId: workspace.workspaceId,
              }),
            session: controlSession,
          });
          return result.room;
        })().finally(() => {
          if (directRoomOpenRequests.current.get(requestKey) === operation)
            directRoomOpenRequests.current.delete(requestKey);
        });
        directRoomOpenRequests.current.set(requestKey, operation);
      }
      const room = await operation;
      setRooms((current) =>
        current.some(({ roomId }) => roomId === room.roomId)
          ? current
          : [...current, room],
      );
      if (navigationGeneration.current !== navigationIntent) return;
      setPeekAgentId(undefined);
      setPeekHumanId(undefined);
      setFocusedMessageId(undefined);
      setActiveThreadRootMessageId(undefined);
      setRoomMembersOpen(false);
      setThreadMessages([]);
      setRoomData(undefined);
      consecutivePollFailures.current = 0;
      setActiveRoomId(room.roomId);
      setSurface("room");
      setTab("chat");
      setMobileRoomsOpen(false);
    },
    [
      activeWorkspace,
      client,
      consumerPrefix,
      health?.capabilities.roomWrite,
      workspaceMembershipRole,
      invalidateNavigation,
    ],
  );

  const createAgent = useCallback(
    async (input: AgentCreateInput) => {
      if (!canCreateCurrentWorkspaceAgent) {
        throw new Error("需要 Workspace 管理员权限和已验证的可用 Runtime");
      }
      const controlRoomId = activeWorkspace?.controlRoomId;
      if (controlRoomId === undefined) {
        throw new Error("当前 Workspace 没有可写 control Room");
      }
      const controlSession = roomSessionFor(
        sessions.current,
        client,
        consumerPrefix,
        controlRoomId,
      );
      const idempotencyKey = `web-agent-provision-${browserOpaqueId()}`;
      const result = await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("agent.provision", {
            ...input,
            basedOnRoomSeq,
            controlRoomId,
            idempotencyKey,
          }),
        session: controlSession,
      });
      setAgentCatalog((current) =>
        current.some(
          ({ definition }) =>
            definition.agentDefinitionId ===
            result.agent.definition.agentDefinitionId,
        )
          ? current
          : [...current, result.agent],
      );
      setAgentCatalogControlRoomId(controlRoomId);
      setLocalRuntimes((current) =>
        current.map((runtime) =>
          runtime.runtimeOfferId !== result.hostBinding.runtimeOfferId ||
          runtime.agentBindings.some(
            ({ agentDefinitionId }) =>
              agentDefinitionId === result.agent.definition.agentDefinitionId,
          )
            ? runtime
            : {
                ...runtime,
                agentBindings: [
                  ...runtime.agentBindings,
                  {
                    agentDefinitionId:
                      result.agent.definition.agentDefinitionId,
                    handle: result.agent.handle,
                    participantId: result.agent.definition.participantId,
                  },
                ],
              },
        ),
      );
      return result.agent.definition.agentDefinitionId;
    },
    [activeWorkspace, canCreateCurrentWorkspaceAgent, client, consumerPrefix],
  );

  const openAgentManagement = useCallback(
    async (agentDefinitionId: string, mode: "all" | "runtime" = "all") => {
      if (!canManageCurrentWorkspaceAgent) {
        setError("需要 Workspace 管理员权限才能设置 Agent");
        return;
      }
      try {
        setAgentManageMode(mode);
        setAgentManageDetail(
          await client.request("agent.get", { agentDefinitionId }),
        );
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [canManageCurrentWorkspaceAgent, client],
  );

  const saveAgentProfile = useCallback(
    async (input: AgentProfileEditInput) => {
      const controlRoomId = activeWorkspace?.controlRoomId;
      if (!canManageCurrentWorkspaceAgent || !controlRoomId)
        throw new Error("当前 Agent 资料不可写");
      const reconcile = (entry: ClientAgentGetResponse["agent"]) =>
        setAgentCatalog((current) =>
          current.map((agent) =>
            agent.definition.agentDefinitionId ===
              entry.definition.agentDefinitionId &&
            agent.currentRevision.revision <= entry.currentRevision.revision
              ? entry
              : agent,
          ),
        );
      try {
        const result = await runRoomMutationAtLatest({
          session: roomSessionFor(
            sessions.current,
            client,
            consumerPrefix,
            controlRoomId,
          ),
          mutate: (basedOnRoomSeq) =>
            client.request("agent.manage", {
              ...input,
              action: "update_profile",
              basedOnRoomSeq,
              idempotencyKey: `web-agent-profile-${browserOpaqueId()}`,
            }),
        });
        reconcile(result.agent);
      } catch (caught) {
        // Preserve the rejected draft, but let cancel/reopen start from the
        // latest canonical revision. A failed refresh must not mask the error.
        try {
          reconcile(
            (
              await client.request("agent.get", {
                agentDefinitionId: input.agentDefinitionId,
              })
            ).agent,
          );
        } catch {
          /* retain last readable projection */
        }
        throw caught;
      }
    },
    [activeWorkspace, canManageCurrentWorkspaceAgent, client, consumerPrefix],
  );

  const agentConfigureCommand = useRef<
    | {
        detail: ClientAgentGetResponse;
        save: ReturnType<typeof createAgentConfigureCommand>;
      }
    | undefined
  >(undefined);
  const configureAgent = useCallback(
    async (input: AgentConfigureInput) => {
      const detail = agentManageDetail;
      const controlRoomId = activeWorkspace?.controlRoomId;
      if (
        !canManageCurrentWorkspaceAgent ||
        detail === undefined ||
        controlRoomId === undefined
      ) {
        throw new Error("当前 Agent 设置上下文不可写");
      }
      const controlSession = roomSessionFor(
        sessions.current,
        client,
        consumerPrefix,
        controlRoomId,
      );
      if (agentConfigureCommand.current?.detail !== detail) {
        agentConfigureCommand.current = {
          detail,
          save: createAgentConfigureCommand({
            client,
            detail,
            session: controlSession,
            createKey: () => `web-agent-configure-${browserOpaqueId()}`,
          }),
        };
      }
      const navigationIntent = navigationGeneration.current;
      const result = await agentConfigureCommand.current.save(input);
      if (navigationGeneration.current !== navigationIntent) return;
      setAgentCatalog((current) =>
        current.map((agent) =>
          agent.definition.agentDefinitionId ===
          result.agent.definition.agentDefinitionId
            ? result.agent
            : agent,
        ),
      );
      if (result.hostBinding !== undefined) {
        setLocalRuntimes((current) =>
          current.map((runtime) => {
            const bindings = runtime.agentBindings.filter(
              ({ agentDefinitionId }) =>
                agentDefinitionId !== result.agent.definition.agentDefinitionId,
            );
            return runtime.runtimeOfferId === result.hostBinding?.runtimeOfferId
              ? {
                  ...runtime,
                  agentBindings: [
                    ...bindings,
                    {
                      agentDefinitionId:
                        result.agent.definition.agentDefinitionId,
                      handle: result.agent.handle,
                      participantId: result.agent.definition.participantId,
                    },
                  ],
                }
              : { ...runtime, agentBindings: bindings };
          }),
        );
      }
      setAgentManageDetail((current) =>
        current === detail ? undefined : current,
      );
    },
    [
      activeWorkspace,
      agentManageDetail,
      canManageCurrentWorkspaceAgent,
      client,
      consumerPrefix,
    ],
  );

  const changeWorkspaceAgentState = useCallback(
    async (
      agentDefinitionId: string,
      state: "disabled" | "enabled" | "tombstoned",
      idempotencyKey: string,
    ) => {
      const controlRoomId = activeWorkspace?.controlRoomId;
      if (!canManageCurrentWorkspaceAgent || controlRoomId === undefined) {
        throw new Error("当前 Agent 设置上下文不可写");
      }
      const controlSession = roomSessionFor(
        sessions.current,
        client,
        consumerPrefix,
        controlRoomId,
      );
      const result = await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("agent.manage", {
            action: "set_state",
            agentDefinitionId,
            basedOnRoomSeq,
            idempotencyKey,
            state,
          }),
        session: controlSession,
      });
      setAgentCatalog((current) =>
        state === "tombstoned"
          ? current.filter(
              ({ definition }) =>
                definition.agentDefinitionId !==
                result.agent.definition.agentDefinitionId,
            )
          : current.map((agent) =>
              agent.definition.agentDefinitionId ===
              result.agent.definition.agentDefinitionId
                ? result.agent
                : agent,
            ),
      );
      if (state === "tombstoned") {
        setLocalRuntimes((current) =>
          current.map((runtime) => ({
            ...runtime,
            agentBindings: runtime.agentBindings.filter(
              ({ agentDefinitionId }) =>
                agentDefinitionId !== result.agent.definition.agentDefinitionId,
            ),
          })),
        );
      }
    },
    [activeWorkspace, canManageCurrentWorkspaceAgent, client, consumerPrefix],
  );

  const setAgentState = useCallback(
    async (state: "disabled" | "enabled" | "tombstoned") => {
      const id = agentManageDetail?.agent.definition.agentDefinitionId;
      if (!id) throw new Error("当前 Agent 设置上下文不可写");
      await changeWorkspaceAgentState(
        id,
        state,
        `web-agent-state-${browserOpaqueId()}`,
      );
      setAgentManageDetail((current) =>
        current?.agent.definition.agentDefinitionId === id
          ? undefined
          : current,
      );
    },
    [agentManageDetail, changeWorkspaceAgentState],
  );

  const resetAgentExecution = useCallback(
    async (
      agentDefinitionId: string,
      mode: "restart" | "session" | "full",
      idempotencyKey: string,
    ) => {
      const controlRoomId = activeWorkspace?.controlRoomId;
      if (
        !canManageCurrentWorkspaceAgent ||
        health?.capabilities.agentExecutionReset !== true ||
        controlRoomId === undefined
      ) {
        throw new Error("当前 daemon 未开放 Agent 重启 / 重置");
      }
      await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("agent.execution.reset", {
            agentDefinitionId,
            basedOnRoomSeq,
            idempotencyKey,
            mode,
          }),
        session: roomSessionFor(
          sessions.current,
          client,
          consumerPrefix,
          controlRoomId,
        ),
      });
      const latest = await client.request("agent.get", {
        agentDefinitionId,
      });
      setAgentCatalog((current) =>
        current.map((entry) =>
          entry.definition.agentDefinitionId === agentDefinitionId
            ? latest.agent
            : entry,
        ),
      );
    },
    [
      activeWorkspace,
      canManageCurrentWorkspaceAgent,
      client,
      consumerPrefix,
      health?.capabilities.agentExecutionReset,
    ],
  );

  const changeWorkspaceHumanRole = useCallback(
    async (principalId: string, role: MembershipRole) => {
      const controlRoomId = activeWorkspace?.controlRoomId;
      if (!canChangeCurrentWorkspaceHumanRole || controlRoomId === undefined) {
        throw new Error("当前账号不能修改 Workspace Human 角色");
      }
      await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("room.member.role", {
            basedOnRoomSeq,
            idempotencyKey: `web-workspace-human-role-${browserOpaqueId()}`,
            principalId,
            role,
            roomId: controlRoomId,
          }),
        session: roomSessionFor(
          sessions.current,
          client,
          consumerPrefix,
          controlRoomId,
        ),
      });
      setReload((value) => value + 1);
    },
    [
      activeWorkspace?.controlRoomId,
      canChangeCurrentWorkspaceHumanRole,
      client,
      consumerPrefix,
    ],
  );

  const agentDetailProps = {
    launchSettingsRefresh: reload,
    initialHumanPrincipalId:
      agentRoute.view === "human" ? agentRoute.humanPrincipalId : undefined,
    initialAgentDefinitionId: agentRoute.agentDefinitionId,
    initialTab: agentRoute.tab,
    initialView: agentRoute.view,
    onSaveProfile: saveAgentProfile,
    agents: agentDirectory,
    canCreate: canCreateCurrentWorkspaceAgent,
    canManage: canManageCurrentWorkspaceAgent,
    canMessage:
      health?.capabilities.roomWrite === true &&
      workspaceMembershipRole !== undefined,
    canChangeHumanRole: canChangeCurrentWorkspaceHumanRole,
    client,
    computerLabel: entities.computer?.displayName,
    computerStatus: computer?.status,
    currentHuman: currentPrincipal,
    humans: entities.humans(),
    humanDirectoryError: humanDirectoryQuery?.error,
    humanDirectoryLoading: humanDirectoryQuery === undefined,
    humansTruncated: humanDirectoryQuery?.data?.truncated === true,
    onRetryHumans: () => setReload((value) => value + 1),
    fullResetEnabled: health?.capabilities.agentExecutionFullReset === true,
    onCreate: () => setAgentCreateOpen(true),
    onManage: (id: string) => void openAgentManagement(id),
    onChangeState: changeWorkspaceAgentState,
    onEditRuntime: (id: string) => void openAgentManagement(id, "runtime"),
    onResetExecution:
      health?.capabilities.agentExecutionReset === true
        ? resetAgentExecution
        : undefined,
    onOpenDirectRoom: async (id: string) => {
      await openDirectRoom(id);
    },
    onOpenMessage: (target: Extract<NavigationTarget, { kind: "message" }>) => {
      void openDiscoveryLocation({
        target,
      });
      setPeekAgentId(undefined);
      setPeekHumanId(undefined);
    },
    onOpenRoom: (roomId: string) => {
      void openDiscoveryLocation({
        target: { kind: "room", roomId },
      });
      setPeekAgentId(undefined);
      setPeekHumanId(undefined);
    },
    onRouteChange: navigateAgentRoute,
    onChangeHumanRole: changeWorkspaceHumanRole,
    runtimes: localRuntimes,
    workspaceId: activeWorkspace?.workspaceId,
  };
  const peekRetained =
    surface === "room" &&
    (peekAgentId !== undefined || peekHumanId !== undefined);
  const conversationLayout = useConversationLayout(roomSidebarWidth);
  const panels = conversationPanels({
    ...panelIntent,
    thread: activeThreadRootMessageId !== undefined && !taskModalOpen,
    profile: peekRetained,
    split: conversationLayout.mode === "split",
  });
  const peekOpen = panels.profile;
  const openMobileHome = useCallback(() => {
    setPeekAgentId(undefined);
    setPeekHumanId(undefined);
    setActiveThreadRootMessageId(undefined);
    setFocusedMessageId(undefined);
    setRoomMembersOpen(false);
    setSurface("room");
    setTab("chat");
    setMobileRoomsOpen(true);
  }, []);
  const workspaceIdentityProps = {
    computerName: computer?.displayName,
    workspace: activeWorkspace,
    workspaces,
    rooms,
    client,
    principalId: currentPrincipal?.principalId ?? "human-unavailable",
    canManage:
      health?.capabilities.roomWrite === true &&
      (workspaceMembershipRole === "owner" ||
        workspaceMembershipRole === "admin"),
    onUpdated: (workspace: Workspace) =>
      setWorkspaces((current) =>
        current.map((entry) =>
          entry.workspaceId === workspace.workspaceId ? workspace : entry,
        ),
      ),
    onSelect: (
      workspace: Workspace,
      rememberedSearch: string | undefined,
      navigationMode: "restore" | "replace-with-home",
    ) => {
      const workspaceRooms = rooms.filter(
        (room) => room.workspaceId === workspace.workspaceId,
      );
      const rememberedRoomId = rememberedSearch
        ? roomSelectionFromSearch(rememberedSearch)
        : undefined;
      const nextRoomId = workspaceRooms.some(
        (room) => room.roomId === rememberedRoomId,
      )
        ? rememberedRoomId
        : workspaceRooms[0]?.roomId;
      setSelectedWorkspaceId(workspace.workspaceId);
      setActiveRoomId(nextRoomId);
      if (rememberedSearch) {
        window.history.pushState(null, "", rememberedSearch);
        setSurface(globalSurfaceFromSearch(rememberedSearch));
        setGlobalTaskDetail(globalTaskDetailFromSearch(rememberedSearch));
        setAgentRoute(agentRouteFromSearch(rememberedSearch));
        setTab(roomTabFromSearch(rememberedSearch));
        setFocusedMessageId(
          new URLSearchParams(rememberedSearch).get("message") ?? undefined,
        );
        setActiveThreadRootMessageId(
          nextRoomId === undefined
            ? undefined
            : threadRootSelectionFromSearch(rememberedSearch, nextRoomId),
        );
      } else if (navigationMode === "replace-with-home") {
        openMobileHome();
      } else {
        setSurface("room");
        setTab("chat");
        setFocusedMessageId(undefined);
        setActiveThreadRootMessageId(undefined);
      }
      setPeekAgentId(undefined);
      setPeekHumanId(undefined);
    },
  };
  return (
    <SidebarPreferencesProvider
      key={`${currentPrincipal?.principalId}:${activeWorkspace?.workspaceId}`}
      disclosureScope={`${currentPrincipal?.principalId}:${activeWorkspace?.workspaceId}`}
      hostInstanceId={inventory?.data?.computer?.instanceId}
      client={client}
      workspaceId={activeWorkspace?.workspaceId}
      enabled={health?.capabilities.sidebarPreferences === true}
    >
      <MessageSocialProvider
        client={client}
        enabled={health?.capabilities.messageSocial === true}
      >
        <DiagnosticNavigationContext.Provider
          value={{
            client,
            rooms: diagnosticRooms,
            onOpen: openDiscoveryLocation,
            navigationEpoch,
            beginNavigation: invalidateNavigation,
            requestGate: diagnosticNavigation.current,
          }}
        >
          <WorkspaceEntityProvider
            entities={entities}
            client={client}
            canManageAgents={canManageCurrentWorkspaceAgent}
            onOpen={(id, origin) =>
              surface === "room"
                ? openAgentPeek(id, origin)
                : openDiscoveryLocation({
                    target: { kind: "agent", agentDefinitionId: id },
                  })
            }
            onPrincipalUpdated={(principal) =>
              setCurrentPrincipal((current) =>
                current?.principalId === principal.principalId
                  ? principal
                  : current,
              )
            }
            onOpenDirect={openDirectRoom}
            onOpenComputer={() => {
              setPeekAgentId(undefined);
              setPeekHumanId(undefined);
              setFocusedMessageId(undefined);
              setActiveThreadRootMessageId(undefined);
              setRoomMembersOpen(false);
              setSurface("computers");
            }}
            onOpenHuman={(humanPrincipalId, origin = "room") => {
              invalidateNavigation();
              setPeekAgentId(undefined);
              setPeekHumanId(undefined);
              if (surface === "room") {
                setPeekHumanId(humanPrincipalId);
                setPanelIntent({ latest: "profile", source: origin });
              } else {
                setSurface("agents");
                navigateAgentRoute({
                  agentDefinitionId: undefined,
                  humanPrincipalId,
                  tab: "profile",
                  view: "human",
                });
              }
              setRoomMembersOpen(false);
            }}
          >
            <InteractivePopover
              open={humanInboxOpen}
              onOpenChange={setHumanInboxOpen}
            >
              <div
                ref={conversationLayout.ref}
                data-conversation-layout={conversationLayout.mode}
                data-profile-source={panels.source}
                className={`app rah-product-shell${globalSurface ? " rah-global-shell" : ""}${taskModalOpen ? " rah-task-modal-open" : ""}${(surface === "search" || surface === "activity") && searchPreview.roomId ? " rah-search-channel-open" : ""}${activeThreadRootMessageId === undefined ? " thread-hidden" : ""}${peekOpen ? " rah-agent-peek-open" : ""}`}
                style={
                  {
                    "--rah-room-sidebar-width": `${roomSidebarWidth}px`,
                    "--thread-w": `${threadPanelWidth}px`,
                    "--rah-search-width": `${searchLayout.width}px`,
                  } as CSSProperties
                }
              >
                <WorkspaceNavigation
                  homeOpen={mobileRoomsOpen}
                  onHome={openMobileHome}
                  identity={<WorkspaceIdentity {...workspaceIdentityProps} />}
                  active={surface}
                  notificationCount={humanInputRequests.length}
                  activityUnread={(unreadSummary?.unreadActivityCount ?? 0) > 0}
                  chatUnread={(unreadSummary?.rooms.length ?? 0) > 0}
                  computerAttention={computer?.status === "offline"}
                  notificationAttention={systemNoticeView.notices.length > 0}
                  notificationsOpen={humanInboxOpen}
                  onTasks={() => {
                    setMobileRoomsOpen(false);
                    setPeekAgentId(undefined);
                    setPeekHumanId(undefined);
                    setActiveThreadRootMessageId(undefined);
                    setRoomMembersOpen(false);
                    setFocusedMessageId(undefined);
                    setSurface("tasks");
                  }}
                  onSelect={(nextSurface) => {
                    if (nextSurface === "room") setTab("chat");
                    setMobileRoomsOpen(false);
                    if (nextSurface === "agents")
                      setAgentRoute(agentDirectoryRootRoute());
                    setPeekAgentId(undefined);
                    setPeekHumanId(undefined);
                    setFocusedMessageId(undefined);
                    setActiveThreadRootMessageId(undefined);
                    setRoomMembersOpen(false);
                    setSurface(nextSurface);
                  }}
                />
                {surface === "search" && searchPreview.roomId ? (
                  <SearchPreviewResizer layout={searchLayout} />
                ) : null}
                {navigationError === undefined ? null : (
                  <div className="rah-navigation-error" role="alert">
                    <span>{navigationError}</span>
                    <button
                      aria-label="关闭导航错误"
                      onClick={() => setNavigationError(undefined)}
                    >
                      ×
                    </button>
                  </div>
                )}
                {humanInboxOpen ? (
                  <HumanInboxCenter
                    error={humanInboxError}
                    loading={humanInboxLoading}
                    onClose={() => setHumanInboxOpen(false)}
                    onOpenRoom={(roomId) => {
                      void openDiscoveryLocation({
                        target: { kind: "room", roomId },
                      }).then((opened) => {
                        if (opened) setHumanInboxOpen(false);
                      });
                    }}
                    onResolve={resolveHumanInputRequest}
                    requests={humanInputRequests}
                    systemNotices={systemNoticeView.notices}
                    onDismissSystem={systemNoticeView.dismiss}
                    onOpenSystem={(target) => {
                      return openDiscoveryLocation({ target }).then(
                        (opened) => {
                          if (opened) setHumanInboxOpen(false);
                        },
                      );
                    }}
                    rooms={rooms}
                  />
                ) : null}
                {surface === "room" || surface === "saved" ? (
                  <SurfaceErrorBoundary surface="Room 列表">
                    <RoomSidebar
                      mobileWorkspaceIdentity={
                        <WorkspaceIdentity {...workspaceIdentityProps} mobile />
                      }
                      savedActive={surface === "saved"}
                      onSaved={
                        health?.capabilities.messageSocial
                          ? () => {
                              setSurface("saved");
                              setPeekAgentId(undefined);
                              setPeekHumanId(undefined);
                              setActiveThreadRootMessageId(undefined);
                              setFocusedMessageId(undefined);
                              setMobileRoomsOpen(false);
                            }
                          : undefined
                      }
                      activeRoomId={activeRoomId}
                      agents={agentDirectory}
                      canMessage={
                        health?.capabilities.roomWrite === true &&
                        workspaceMembershipRole !== undefined
                      }
                      currentHumanId={currentPrincipal?.principalId}
                      onOpenDirectRoom={openDirectRoom}
                      contextControl={{
                        onArchive: sidebarArchive,
                        onUnread: sidebarUnread,
                        onCreate: () => setRoomCreateOpen(true),
                        canCreate: canCreateCurrentWorkspaceRoom,
                        onCloseConversation: (roomId) => {
                          if (roomId === activeRoomId) {
                            setActiveRoomId(
                              rooms.find((room) => room.slug === "all")?.roomId,
                            );
                            setRoomData(undefined);
                          }
                        },
                      }}
                      onSearch={() => {
                        setFocusedMessageId(undefined);
                        setMobileRoomsOpen(false);
                        setSurface("search");
                      }}
                      canCreate={
                        canCreateCurrentWorkspaceRoom &&
                        activeWorkspace?.controlRoomId !== undefined
                      }
                      mobileOpen={mobileRoomsOpen}
                      notificationAttention={
                        systemNoticeView.notices.length > 0
                      }
                      notificationCount={humanInputRequests.length}
                      onActivity={() => {
                        setFocusedMessageId(undefined);
                        setMobileRoomsOpen(false);
                        setSurface("activity");
                      }}
                      onCreate={() => setRoomCreateOpen(true)}
                      rooms={rooms}
                      workspace={activeWorkspace}
                      unreadRooms={unreadSummary?.rooms}
                      onSelect={(roomId) => {
                        setTab("chat");
                        unreadHeld.current.delete(roomId);
                        setPeekAgentId(undefined);
                        setPeekHumanId(undefined);
                        setFocusedMessageId(undefined);
                        setActiveThreadRootMessageId(undefined);
                        setRoomMembersOpen(false);
                        if (roomId !== activeRoomId) {
                          setThreadMessages([]);
                          setRoomData(undefined);
                          consecutivePollFailures.current = 0;
                          setActiveRoomId(roomId);
                        }
                        setSurface("room");
                        setMobileRoomsOpen(false);
                      }}
                    />
                  </SurfaceErrorBoundary>
                ) : null}
                {surface === "room" || surface === "saved" ? (
                  <RoomSidebarResizer
                    onWidthChange={setRoomSidebarWidth}
                    onWidthCommit={commitRoomSidebarWidth}
                    width={roomSidebarWidth}
                  />
                ) : null}
                {mobileRoomsOpen ? (
                  <button
                    aria-label="关闭 Room 列表背景"
                    className="rah-mobile-backdrop"
                    onClick={() => setMobileRoomsOpen(false)}
                  />
                ) : null}
                {globalSurface && activeWorkspace ? (
                  <SurfaceErrorBoundary surface="全局发现" resetKey={surface}>
                    <GlobalDiscoverySurface
                      key={`${surface}:${activeWorkspace.workspaceId}`}
                      client={client}
                      surface={surface as "tasks" | "search" | "activity"}
                      workspaceId={activeWorkspace.workspaceId}
                      taskRefreshVersion={reload}
                      taskFilterMemory={taskFilterMemory.current}
                      rooms={rooms}
                      currentHuman={currentPrincipal}
                      navigationEpoch={navigationEpoch}
                      beginNavigation={invalidateNavigation}
                      onOpen={openDiscoveryLocation}
                      onPerson={openDirectRoom}
                      onClose={() => {
                        setFocusedMessageId(undefined);
                        setSurface("room");
                        setTab("chat");
                        setMobileRoomsOpen(true);
                      }}
                    />
                  </SurfaceErrorBoundary>
                ) : null}
                {(surface === "search" || surface === "activity") &&
                searchPreview.roomId &&
                !previewJoined &&
                activeWorkspace ? (
                  <PublicChannelPreview
                    key={`${activeWorkspace.workspaceId}:${searchPreview.roomId}`}
                    client={client}
                    workspaceId={activeWorkspace.workspaceId}
                    roomId={searchPreview.roomId}
                    messageId={searchPreview.messageId}
                    threadId={searchPreview.threadId}
                    rootMessageId={searchPreview.rootMessageId}
                    onClose={searchPreview.close}
                    onOpen={searchPreview.open}
                    tab={searchPreview.tab}
                    onSelectTab={searchPreview.selectTab}
                    onJoined={(room) => {
                      setRooms((previous) =>
                        previous.some((r) => r.roomId === room.roomId)
                          ? previous
                          : [...previous, room],
                      );
                      setRoomData(undefined);
                      setActiveRoomId(room.roomId);
                      setFocusedMessageId(searchPreview.messageId);
                      setActiveThreadRootMessageId(
                        searchPreview.rootMessageId ??
                          (searchPreview.threadId
                            ? searchPreview.messageId
                            : undefined),
                      );
                      setReload((n) => n + 1);
                      const params = new URLSearchParams(
                        window.location.search,
                      );
                      params.set("room", room.roomId);
                      window.history.replaceState(null, "", `?${params}`);
                    }}
                  />
                ) : null}
                {surface === "saved" && activeWorkspace ? (
                  <SurfaceErrorBoundary surface="收藏消息">
                    <SavedMessagesPane
                      key={activeWorkspace.workspaceId}
                      client={client}
                      workspaceId={activeWorkspace.workspaceId}
                      onOpen={openDiscoveryLocation}
                      onOpenRooms={openMobileHome}
                    />
                  </SurfaceErrorBoundary>
                ) : surface === "settings" ? (
                  <SurfaceErrorBoundary surface="设置">
                    <SettingsSurface
                      archivedRooms={archivedRooms.filter(
                        (room) =>
                          room.workspaceId === activeWorkspace?.workspaceId,
                      )}
                      onOpenRoom={(roomId) =>
                        void openDiscoveryLocation({
                          target: { kind: "room", roomId },
                        })
                      }
                      onUnarchiveRoom={(room) =>
                        unarchiveRoomFromCreate(room, false)
                      }
                      onSystemChannelUpdated={() => {
                        setDirectoryRevision((value) => value + 1);
                        setReload((value) => value + 1);
                      }}
                      membershipRole={workspaceMembershipRole}
                      agents={agentDirectory}
                      canManageWorkspace={
                        health?.capabilities.roomWrite === true &&
                        (workspaceMembershipRole === "owner" ||
                          workspaceMembershipRole === "admin")
                      }
                      client={client}
                      currentPrincipal={currentPrincipal}
                      onPrincipalUpdated={(principal) =>
                        setCurrentPrincipal((current) =>
                          current?.principalId === principal.principalId
                            ? principal
                            : current,
                        )
                      }
                      onWorkspaceUpdated={(workspace) =>
                        setWorkspaces((current) =>
                          current.map((item) =>
                            item.workspaceId === workspace.workspaceId
                              ? workspace
                              : item,
                          ),
                        )
                      }
                      workspace={activeWorkspace}
                    />
                  </SurfaceErrorBoundary>
                ) : surface === "agents" ? (
                  <SurfaceErrorBoundary surface="成员目录">
                    <AgentDirectoryPane {...agentDetailProps} />
                  </SurfaceErrorBoundary>
                ) : surface === "computers" ? (
                  <SurfaceErrorBoundary surface="Computer 运行时">
                    <ComputerRuntimePane
                      onMobileBack={() => setSurface("settings")}
                      onResetAgent={
                        canManageCurrentWorkspaceAgent &&
                        health?.capabilities.agentExecutionReset === true
                          ? resetAgentExecution
                          : undefined
                      }
                      fullResetEnabled={
                        health?.capabilities.agentExecutionFullReset === true
                      }
                      onSetAgentState={
                        canManageCurrentWorkspaceAgent
                          ? changeWorkspaceAgentState
                          : undefined
                      }
                      client={client}
                      onCreateAgent={
                        canCreateCurrentWorkspaceAgent
                          ? () => setAgentCreateOpen(true)
                          : undefined
                      }
                      canEditProfile={
                        health?.capabilities.computerProfileWrite === true
                      }
                      hostId={localRuntimeHostId}
                      computer={computer}
                      agents={agentDirectory}
                      inventoryError={runtimeInventoryError}
                      onOpenAgent={(agentDefinitionId) => {
                        navigateAgentRoute({
                          agentDefinitionId,
                          tab: "profile",
                        });
                        setSurface("agents");
                      }}
                      onUpdateComputerProfile={async (input) => {
                        const result = await client.request(
                          "computer.profile.update",
                          input,
                        );
                        setComputerProfileOverride(result.computer);
                      }}
                      runtimes={localRuntimes}
                    />
                  </SurfaceErrorBoundary>
                ) : !globalSurface ||
                  (previewJoined && activeThreadRootMessageId === undefined) ? (
                  <SurfaceErrorBoundary surface="会话" resetKey={activeRoomId}>
                    <main
                      className="channel"
                      inert={surface === "room" && !panels.room}
                    >
                      <ChannelHeader
                        onCloseSearchPreview={
                          surface === "search" && previewJoined
                            ? closeSearchPreview
                            : undefined
                        }
                        onSearch={() => {
                          const params = new URLSearchParams({
                            surface: "search",
                            ...(activeRoomId
                              ? { room: activeRoomId, channel: activeRoomId }
                              : {}),
                          });
                          window.history.pushState(null, "", `?${params}`);
                          setFocusedMessageId(undefined);
                          setSurface("search");
                        }}
                        directPeer={activeDirectPeer}
                        room={activeRoom}
                        memberCount={roomData?.activeMemberIds.length ?? 0}
                        onManageAgents={() => setRoomMembersOpen(true)}
                        onOpenDirectPeer={(id) => openAgentPeek(id)}
                        onOpenRooms={() => setMobileRoomsOpen(true)}
                      />
                      <ConversationTabs
                        value={tab}
                        onSelect={setTab}
                        canReadMessages={
                          health?.capabilities.messageRead !== false
                        }
                        canReadTasks={health?.capabilities.taskRead !== false}
                      />
                      {roomData?.caughtUp === false ? (
                        <div className="rah-sync-status">
                          正在追赶 Room 历史…
                        </div>
                      ) : null}
                      {error === undefined ? null : (
                        <div className="rah-error">
                          <span>{error}</span>
                          <button onClick={onDisconnect}>重新连接</button>
                        </div>
                      )}
                      {focusedMessageId && locationResult.error && (
                        <div className="rah-error" role="alert">
                          {locationResult.error}
                        </div>
                      )}
                      {tab === "chat" &&
                      health?.capabilities.messageRead === false ? (
                        <UnavailablePane
                          title="Message capability 不可用"
                          detail="当前 daemon 没有开放 Message read；Room ledger 不会由 UI fixture 替代。"
                        />
                      ) : tab === "chat" ? (
                        <ChatPane
                          selectionVisible={
                            !mobileRoomsOpen &&
                            (surface !== "room" || panels.room)
                          }
                          onReturnToLatest={() =>
                            setFocusedMessageId(undefined)
                          }
                          client={client}
                          currentPrincipal={currentPrincipal}
                          canAttachFiles={
                            health?.capabilities.fileShare === true
                          }
                          onReadThrough={
                            activeRoomId &&
                            (!focusedMessageId || messageContext)
                              ? async (throughSeq) => {
                                  if (unreadHeld.current.has(activeRoomId))
                                    return;
                                  const request = client.request(
                                    "activity.mark",
                                    {
                                      roomId: activeRoomId,
                                      throughSeq,
                                      action: "read",
                                    },
                                  );
                                  pendingReads.current.add(request);
                                  try {
                                    await request;
                                  } finally {
                                    pendingReads.current.delete(request);
                                  }
                                }
                              : undefined
                          }
                          focusedMessageId={focusedMessageId}
                          focusHighlightRequest={focusHighlightRequest}
                          focusHighlightQuery={focusHighlightQuery}
                          canCreateTask={
                            health?.capabilities.taskWrite === true &&
                            roomData?.caughtUp === true &&
                            activeRoom?.archivedAt === undefined
                          }
                          canManageAnyTask={
                            currentRoomRole === "owner" ||
                            currentRoomRole === "admin"
                          }
                          canForward={
                            health?.capabilities.messageForward === true &&
                            roomData?.caughtUp === true &&
                            activeRoom?.archivedAt === undefined
                          }
                          canPost={
                            health?.capabilities.messageWrite === true &&
                            roomData?.caughtUp === true &&
                            activeRoom?.archivedAt === undefined
                          }
                          canReadThreads={
                            health?.capabilities.threadRead === true
                          }
                          canWriteThreads={
                            health?.capabilities.threadWrite === true &&
                            roomData?.caughtUp === true &&
                            activeRoom?.archivedAt === undefined
                          }
                          loading={loading && roomData?.roomId !== activeRoomId}
                          messageAgents={agentDirectory}
                          hasEarlierMessages={
                            !messageContext &&
                            roomData?.hasEarlierMessages === true
                          }
                          earlierMessagesLoading={earlierMessagesLoading}
                          messages={view.messages}
                          {...(roomData?.mentionReadStates === undefined
                            ? {}
                            : {
                                mentionReadStates: roomData.mentionReadStates,
                              })}
                          roomEvents={roomData?.roomEvents ?? []}
                          roomMembers={roomData?.members ?? []}
                          agents={roomAgents}
                          tasks={roomData?.tasks ?? []}
                          threadReplyPreviews={threadReplyPreviews}
                          onConvertToTask={convertMessageToTask}
                          onTaskWorkflow={updateMessageTaskWorkflow}
                          onManageAgents={() => setRoomMembersOpen(true)}
                          onLoadEarlier={loadEarlierMessages}
                          onOpenThread={openThread}
                          onOpenTarget={(target) =>
                            void openDiscoveryLocation({ target })
                          }
                          roomName={activeRoom?.name}
                          roomKind={activeRoom?.kind}
                          archived={activeRoom?.archivedAt !== undefined}
                          canUnarchive={canManageCurrentRoomMembers}
                          roomId={activeRoom?.roomId}
                          referenceComputers={messageReferenceComputers}
                          referenceEventsComplete={
                            roomData?.referenceEventsComplete === true
                          }
                          referenceRooms={messageReferenceRooms}
                          onSubmit={submitComposer}
                          threads={roomData?.threads ?? []}
                        />
                      ) : tab === "tasks" &&
                        health?.capabilities.taskRead === false ? (
                        <UnavailablePane
                          title="Task capability 不可用"
                          detail="当前 daemon 没有开放 Task read；看板不会显示推测状态。"
                        />
                      ) : tab === "tasks" ? (
                        <TaskPane
                          key={activeRoomId}
                          agents={agentDirectory.filter(({ participantId }) =>
                            activeMemberIdSet.has(participantId),
                          )}
                          canManageAnyTask={
                            currentRoomRole === "owner" ||
                            currentRoomRole === "admin"
                          }
                          canOpenThread={
                            health?.capabilities.threadRead === true
                          }
                          canWrite={
                            health?.capabilities.taskWrite === true &&
                            activeRoom?.archivedAt === undefined
                          }
                          caughtUp={
                            roomData?.caughtUp === true &&
                            activeRoom?.archivedAt === undefined
                          }
                          client={client}
                          columns={view.taskColumns}
                          currentPrincipalId={currentPrincipal?.principalId}
                          earlierTasksLoading={earlierTasksLoading}
                          hasEarlierTasks={roomData?.taskNextPage !== undefined}
                          loading={loading && roomData?.roomId !== activeRoomId}
                          onChanged={() => setReload((value) => value + 1)}
                          onCreate={() => setTaskCreateOpen(true)}
                          onLoadEarlierTasks={loadEarlierTasks}
                          onOpenTask={openDiscoveryLocation}
                          roomName={activeRoom?.name ?? ""}
                        />
                      ) : health?.capabilities.fileShare !== true ? (
                        <UnavailablePane
                          title="当前 daemon 未开放文件共享"
                          detail="此连接的服务端尚未支持附件合同；不会显示虚构文件或尝试无效上传。"
                        />
                      ) : (
                        <RoomFilesPane
                          roomId={activeRoomId}
                          onSource={(file) =>
                            openDiscoveryLocation({
                              target: {
                                kind: "message",
                                roomId: file.roomId,
                                messageId: file.messageId,
                              },
                            })
                          }
                        />
                      )}
                    </main>
                  </SurfaceErrorBoundary>
                ) : null}
                {peekRetained ? (
                  <SurfaceErrorBoundary
                    surface="成员浮层"
                    resetKey={peekHumanId ?? peekAgentId}
                  >
                    <AgentDirectoryPane
                      key={peekHumanId ?? peekAgentId}
                      {...agentDetailProps}
                      activityRequest={peekActivityRequest}
                      panelActive={peekOpen}
                      panelSizing={{
                        width: threadPanelWidth,
                        setWidth: setThreadPanelWidth,
                        commit: commitThreadPanelWidth,
                      }}
                      initialAgentDefinitionId={peekAgentId}
                      initialTab={peekHumanId ? "profile" : "activity"}
                      initialView={peekHumanId ? "human" : "agent"}
                      initialHumanPrincipalId={peekHumanId}
                      onRouteChange={undefined}
                      panel
                      onClose={() => {
                        invalidateNavigation();
                        setPeekAgentId(undefined);
                        setPeekHumanId(undefined);
                      }}
                    />
                  </SurfaceErrorBoundary>
                ) : null}
                {!taskModalOpen &&
                ((surface !== "room" &&
                  surface !== "activity" &&
                  !(surface === "search" && previewJoined)) ||
                  activeThreadRootMessageId === undefined) ? null : (
                  <SurfaceErrorBoundary
                    surface="话题"
                    resetKey={
                      activeThreadRootMessageId ?? globalTaskDetail?.taskId
                    }
                  >
                    <IdentityOriginContext.Provider value="thread">
                      <TaskThreadPresentation
                        modal={taskModalOpen}
                        task={detailTask}
                        roomName={activeRoom?.name}
                        error={taskDetailResult.error}
                        onClose={closeTaskDetail}
                      >
                        <ThreadPane
                          onConvertToTask={convertMessageToTask}
                          searchPreview={surface === "search" && previewJoined}
                          inactive={
                            !taskModalOpen &&
                            surface === "room" &&
                            !panels.thread
                          }
                          hideHeader={taskModalOpen}
                          parentSlot={
                            taskDetailVisible ? (
                              <TaskDetailMetadata
                                key={globalTaskDetail?.taskId}
                                client={client}
                                task={detailTask}
                                people={roomData?.members ?? []}
                                activeMemberIds={
                                  roomData?.activeMemberIds ?? []
                                }
                                principalId={currentPrincipal?.principalId}
                                agents={agentDirectory.filter(
                                  (agent) =>
                                    agent.state === "enabled" &&
                                    roomData?.members.some(
                                      (member) =>
                                        member.principalId ===
                                        agent.participantId,
                                    ),
                                )}
                                canManage={
                                  currentRoomRole === "owner" ||
                                  currentRoomRole === "admin" ||
                                  detailTask?.creatorId ===
                                    currentPrincipal?.principalId
                                }
                                writeEnabled={
                                  health?.capabilities.taskWrite === true &&
                                  roomData?.caughtUp === true
                                }
                                onChanged={() => {
                                  taskDetailResult.refresh();
                                  setReload((value) => value + 1);
                                }}
                              />
                            ) : undefined
                          }
                          client={client}
                          canManageAnyTask={
                            currentRoomRole === "owner" ||
                            currentRoomRole === "admin"
                          }
                          currentPrincipal={currentPrincipal}
                          messageAgents={agentDirectory}
                          followers={activeThreadFollowerAgents}
                          followerCount={
                            threadFollowers.data?.agentParticipantIds.length
                          }
                          followersCanManage={
                            threadFollowers.data?.canManage === true
                          }
                          followersError={threadFollowers.error}
                          followersLoading={threadFollowers.loading}
                          humanFollowing={
                            activeThreadId === undefined
                              ? activeThreadRootRecord?.actorId ===
                                currentPrincipal?.principalId
                              : threadFollowers.data?.following
                          }
                          onReadThrough={
                            activeRoomId && activeThreadId
                              ? async (throughSeq) => {
                                  await client.request("activity.mark", {
                                    roomId: activeRoomId,
                                    threadId: activeThreadId,
                                    throughSeq,
                                    action: "read",
                                  });
                                }
                              : undefined
                          }
                          focusedMessageId={focusedMessageId}
                          focusHighlightRequest={focusHighlightRequest}
                          focusHighlightQuery={focusHighlightQuery}
                          canReply={
                            health?.capabilities.threadWrite === true &&
                            roomData?.caughtUp === true
                          }
                          canAttachFiles={
                            health?.capabilities.fileShare === true
                          }
                          canForward={
                            health?.capabilities.messageForward === true &&
                            roomData?.caughtUp === true &&
                            activeRoom?.archivedAt === undefined
                          }
                          loading={threadLoading}
                          earlierRepliesLoading={threadEarlierRepliesLoading}
                          hasEarlierReplies={threadHasEarlierReplies}
                          onClose={() => {
                            if (taskModalOpen) {
                              closeTaskDetail();
                              return;
                            }
                            if (surface === "search" && previewJoined) {
                              closeSearchPreview();
                              return;
                            }
                            const rootMessageId = activeThreadRootMessageId;
                            invalidateNavigation();
                            setActiveThreadRootMessageId(undefined);
                            if (messageContext?.message.threadId)
                              setFocusedMessageId(undefined);
                            restoreThreadFocus(rootMessageId);
                          }}
                          onSubmit={submitThreadReply}
                          onTaskWorkflow={updateMessageTaskWorkflow}
                          onFollow={
                            activeRoomId &&
                            activeThreadRootMessageId &&
                            (activeThreadId ||
                              health?.capabilities.threadWrite === true)
                              ? async (following) => {
                                  const { thread } = await ensureActiveThread();
                                  await client.request("activity.follow", {
                                    roomId: activeRoomId,
                                    threadId: thread.threadId,
                                    following,
                                  });
                                  threadFollowers.refresh();
                                }
                              : undefined
                          }
                          onLoadEarlier={loadEarlierThreadMessages}
                          onRefreshFollowers={threadFollowers.refresh}
                          onRemoveFollower={
                            activeRoomId && activeThreadId
                              ? async (participantId) => {
                                  const result = await client.request(
                                    "thread.follower.remove",
                                    {
                                      participantId,
                                      roomId: activeRoomId,
                                      threadId: activeThreadId,
                                    },
                                  );
                                  threadFollowers.refresh();
                                  return result;
                                }
                              : undefined
                          }
                          onRestoreFollower={
                            activeRoomId && activeThreadId
                              ? async ({ participantId, undoToken }) => {
                                  const result = await client.request(
                                    "thread.follower.restore",
                                    {
                                      participantId,
                                      roomId: activeRoomId,
                                      threadId: activeThreadId,
                                      undoToken,
                                    },
                                  );
                                  if (!result.restored)
                                    throw new Error(
                                      "撤销期限已过，请重新提及该 Agent",
                                    );
                                  threadFollowers.refresh();
                                }
                              : undefined
                          }
                          onSearchThread={searchActiveThread}
                          onOpenTarget={(target) =>
                            void openDiscoveryLocation({ target })
                          }
                          onViewInChannel={() => {
                            const rootMessageId = activeThreadRootMessageId;
                            invalidateNavigation();
                            setActiveThreadRootMessageId(undefined);
                            setFocusedMessageId(activeThreadRootMessageId);
                            restoreThreadFocus(rootMessageId);
                          }}
                          replies={threadView.messages}
                          mentionAgentIds={availableAgentIds}
                          mentionReadStates={threadMentionReadStates}
                          referenceComputers={messageReferenceComputers}
                          referenceEventsComplete={
                            roomData?.referenceEventsComplete === true
                          }
                          referenceRooms={messageReferenceRooms}
                          referenceTasks={roomData?.tasks ?? []}
                          roomMembers={roomData?.members ?? []}
                          resizer={
                            taskModalOpen ||
                            (surface === "search" && previewJoined) ? null : (
                              <ThreadPanelResizer
                                onWidthChange={setThreadPanelWidth}
                                onWidthCommit={commitThreadPanelWidth}
                                width={threadPanelWidth}
                              />
                            )
                          }
                          roomEvents={roomData?.roomEvents ?? []}
                          roomId={activeRoomId}
                          roomKind={activeRoom?.kind}
                          roomName={activeRoom?.name}
                          root={activeThreadRoot}
                          {...(activeThreadTask === undefined
                            ? {}
                            : { task: activeThreadTask })}
                          {...(activeThreadTaskAgent === undefined
                            ? {}
                            : { taskAgent: activeThreadTaskAgent })}
                          threadId={activeThreadId}
                        />
                      </TaskThreadPresentation>
                    </IdentityOriginContext.Provider>
                  </SurfaceErrorBoundary>
                )}
                {chatTaskTarget &&
                activeRoom &&
                chatTaskTarget.roomId === activeRoom.roomId ? (
                  <ChatTaskApproval
                    client={client}
                    target={chatTaskTarget}
                    room={activeRoom}
                    people={roomData?.members ?? []}
                    activeMemberIds={roomData?.activeMemberIds ?? []}
                    agents={agentDirectory}
                    principal={currentPrincipal}
                    session={sessions.current.get(activeRoom.roomId)}
                    canManage={
                      currentRoomRole === "owner" || currentRoomRole === "admin"
                    }
                    writeEnabled={
                      health?.capabilities.taskWrite === true &&
                      roomData?.caughtUp === true
                    }
                    canReply={
                      health?.capabilities.threadWrite === true &&
                      roomData?.caughtUp === true
                    }
                    canAttachFiles={health?.capabilities.fileShare === true}
                    canForward={
                      health?.capabilities.messageForward === true &&
                      roomData?.caughtUp === true &&
                      activeRoom.archivedAt === undefined
                    }
                    onTaskWorkflow={updateMessageTaskWorkflow}
                    onChanged={() => setReload((value) => value + 1)}
                    onClose={() => setChatTaskTarget(undefined)}
                  />
                ) : null}
                {roomCreateOpen ? (
                  <RoomCreateDialog
                    agents={agentDirectory.filter(
                      ({ state }) => state === "enabled",
                    )}
                    archivedRooms={archivedRooms.filter(
                      ({ workspaceId }) =>
                        workspaceId === activeWorkspace?.workspaceId,
                    )}
                    canUnarchive={canCreateCurrentWorkspaceRoom}
                    onClose={() => setRoomCreateOpen(false)}
                    onCreate={createRoom}
                    onUnarchive={unarchiveRoomFromCreate}
                  />
                ) : null}
                {taskCreateOpen ? (
                  <TaskCreateDialog
                    onClose={() => setTaskCreateOpen(false)}
                    onCreate={createBoardTask}
                    onDiscard={(clientIds) =>
                      taskCreateCommandLedger.current.discard(clientIds)
                    }
                  />
                ) : null}
                {agentCreateOpen && activeWorkspace !== undefined ? (
                  <AgentCreateDialog
                    client={client}
                    onRefreshModels={async (refreshOfferId) => {
                      const result = await client.request("host.runtime.list", {
                        refreshOfferId,
                      });
                      setLocalRuntimes(result.runtimes);
                    }}
                    computerLabel={
                      computer?.displayName ?? computer?.hostname ?? "本机"
                    }
                    onClose={() => setAgentCreateOpen(false)}
                    onCreate={createAgent}
                    runtimes={localRuntimes}
                  />
                ) : null}
                {agentManageDetail !== undefined ? (
                  agentManageMode === "runtime" ? (
                    <AgentRuntimeDialog
                      onLaunchSaved={() => setReload((value) => value + 1)}
                      client={client}
                      onRefreshModels={async (refreshOfferId) => {
                        const result = await client.request(
                          "host.runtime.list",
                          { refreshOfferId },
                        );
                        setLocalRuntimes(result.runtimes);
                      }}
                      detail={agentManageDetail}
                      onClose={() => setAgentManageDetail(undefined)}
                      onConfigure={configureAgent}
                      runtimes={localRuntimes}
                    />
                  ) : (
                    <AgentManageDialog
                      detail={agentManageDetail}
                      onClose={() => setAgentManageDetail(undefined)}
                      onConfigure={configureAgent}
                      onState={setAgentState}
                      runtimes={localRuntimes}
                    />
                  )
                ) : null}
                {roomMembersOpen ? (
                  <RoomMembersDialog
                    onHideAll={async () => {
                      if (!activeWorkspace) return;
                      await changeSystemChannel(client, activeWorkspace, true);
                      setRoomMembersOpen(false);
                      setDirectoryRevision((value) => value + 1);
                      setActiveRoomId(
                        rooms.find(
                          (r) => r.kind === "channel" && r.slug !== "all",
                        )?.roomId,
                      );
                      setReload((value) => value + 1);
                    }}
                    renderProfile={(target, onBack, onClose) => (
                      <AgentDirectoryPane
                        {...agentDetailProps}
                        key={`${target.kind}:${target.id}`}
                        panel
                        initialView={target.kind}
                        initialTab="profile"
                        initialAgentDefinitionId={
                          target.kind === "agent" ? target.id : undefined
                        }
                        initialHumanPrincipalId={
                          target.kind === "human" ? target.id : undefined
                        }
                        onRouteChange={undefined}
                        onPanelBack={onBack}
                        onClose={onClose}
                      />
                    )}
                    key={`${currentPrincipal?.principalId}:${activeRoom?.roomId}`}
                    canAdd={
                      canOnboardCurrentRoomAgent &&
                      roomData?.caughtUp === true &&
                      activeRoom?.archivedAt === undefined
                    }
                    canLeave={currentRoomLeave.allowed}
                    canDelete={
                      canManageCurrentRoomMembers &&
                      roomData?.caughtUp === true &&
                      activeRoom?.kind === "channel"
                    }
                    canManageRoles={
                      canManageCurrentRoomRoles &&
                      activeRoom?.archivedAt === undefined
                    }
                    canRemove={
                      canManageCurrentRoomMembers &&
                      roomData?.caughtUp === true &&
                      activeRoom?.archivedAt === undefined
                    }
                    canStopAgents={
                      canManageCurrentRoomMembers &&
                      roomData?.caughtUp === true &&
                      activeRoom?.archivedAt === undefined &&
                      health?.capabilities.roomAgentSos === true
                    }
                    canUpdate={
                      canManageCurrentRoomMembers && roomData?.caughtUp === true
                    }
                    candidates={roomMemberCandidates}
                    memberships={roomData?.memberships ?? []}
                    members={(roomData?.members ?? []).filter(
                      ({ principalId }) => activeMemberIdSet.has(principalId),
                    )}
                    onAdd={onboardAgent}
                    onArchive={() => changeRoomArchiveState(true)}
                    onClose={() => setRoomMembersOpen(false)}
                    onDelete={deleteCurrentRoom}
                    onLeave={leaveCurrentRoom}
                    onRemove={removeAgent}
                    onResumeAgents={resumeCurrentRoomAgents}
                    onRole={setRoomMemberRole}
                    onStopAgents={stopCurrentRoomAgents}
                    onUnarchive={() => changeRoomArchiveState(false)}
                    onUpdate={updateRoom}
                    leaveUnavailableReason={currentRoomLeave.reason}
                    room={activeRoom}
                  />
                ) : null}
              </div>
            </InteractivePopover>
          </WorkspaceEntityProvider>
        </DiagnosticNavigationContext.Provider>
      </MessageSocialProvider>
    </SidebarPreferencesProvider>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "RAH OS request failed";
}

function roomSessionFor(
  sessions: Map<string, RoomSession>,
  client: RahClient,
  consumerPrefix: string,
  roomId: string,
): RoomSession {
  return getOrCreateBoundedSession(
    sessions,
    roomId,
    () =>
      new RoomSession({
        client,
        consumerId: `${consumerPrefix}-${roomId}`,
        roomId,
      }),
    8,
  );
}

function browserConsumerId(): string {
  let storage: Storage | undefined;
  try {
    storage = globalThis.sessionStorage;
  } catch {
    storage = undefined;
  }
  return loadOrCreateConsumerId({
    createId: () => `rah-web-${browserOpaqueId()}`,
    ...(storage === undefined ? {} : { storage }),
    storageKey: "rah-os.web.consumer.v1",
  });
}
