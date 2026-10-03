import { RoleDirectoryPane } from "./components/role-directory-pane.tsx";
import { RoleWrite } from "./role-write.ts";
import { LoadingState } from "@rah-os/ui-web/neo-brutalist/loading-state";
import { runtimeProductName } from "./agent-runtime-presentation.ts";
import { ChatTaskApproval } from "./components/chat-task-approval.tsx";
import { directConversationPeer } from "./direct-conversation-entries.ts";
import { useMobileLayout } from "./use-mobile-layout.ts";
import { WorkspaceNavigation } from "./components/workspace-navigation-shell.tsx";
import { SurfaceErrorBoundary } from "./components/surface-error-boundary.tsx";
import {
  ConversationLayoutShell,
  ConversationLayoutResizer,
} from "./components/conversation-layout-shell.tsx";
import type { conversationLayout } from "./conversation-layout.ts";
import {
  conversationPanels,
  type ConversationPanelIntent,
  type ConversationOrigin,
} from "./conversation-panels.ts";
import { IdentityOriginContext } from "./components/workspace-entity-context.tsx";
import { changeSystemChannel } from "./components/system-channel-settings.tsx";
import { browserOpaqueId } from "./browser-opaque-id.ts";
import { createAgentConfigureCommand } from "./agent-configure-command.ts";
import { useSearchChannelPreview } from "./use-search-channel-preview.ts";
import { PublicChannelPreview } from "./components/public-channel-preview.tsx";
import { InteractivePopover } from "@rah-os/ui-web/neo-brutalist/interactive-popover";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
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
import {
  SidebarPreferencesProvider,
  type SidebarPreferencesHandle,
} from "./components/sidebar-preferences.tsx";
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
import {
  ChannelHeader,
  RoomSidebar,
  type Surface,
  type Tab,
} from "./components/workspace-navigation.tsx";
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
  agentRouteFromSearch,
  agentRouteSearch,
  type AgentRouteSelection,
} from "./agent-route.ts";
import {
  rememberWorkspaceLocation,
  recallWorkspaceSurface,
} from "./workspace-switcher-state.ts";
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
  const [storedRoomData, setRoomData] = useState<RoomData>();
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
  const roomUpdateWrites = useRef(new Map<string, RoleWrite>());
  const roomUpdateWriteFor = (roomId: string) => {
    let write = roomUpdateWrites.current.get(roomId);
    if (!write) {
      write = new RoleWrite();
      roomUpdateWrites.current.set(roomId, write);
    }
    return write;
  };
  const roomCreateWrite = useRef(new RoleWrite());
  const [roomCreateUnknown, setRoomCreateUnknown] = useState(false);
  const taskCreateCommandLedger = useRef(createTaskCreateCommandLedger());
  const [tab, setTab] = useState<Tab>(() =>
    roomTabFromSearch(window.location.search),
  );
  const taskFilterMemory = useRef(new Map<string, string>());
  const navigationGeneration = useRef(0);
  const diagnosticNavigation = useRef(createLatestRequest());
  const searchPreview = useSearchChannelPreview();
  const [surface, setSurfaceState] = useState<Surface>(() =>
    globalSurfaceFromSearch(window.location.search),
  );
  const conversationPreview =
    (surface === "activity" || surface === "search") && !!searchPreview.roomId;
  const roomActivityQuery = useReconciledQuery(
    client,
    "room.agent.activity.list",
    { roomId: activeRoomId ?? "none" },
    !!activeRoomId &&
      health?.capabilities.agentRead === true &&
      (surface === "room" || conversationPreview),
  );
  const roomData = useMemo(
    () =>
      storedRoomData
        ? {
            ...storedRoomData,
            agentActivity:
              roomActivityQuery?.data?.agents ?? storedRoomData.agentActivity,
          }
        : undefined,
    [storedRoomData, roomActivityQuery?.data],
  );
  const previewThreadPrimary = conversationPreview && !!searchPreview.threadId;
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
    async (agentId: string, origin: ConversationOrigin = "room") => {
      const epoch = invalidateNavigation();
      setNavigationError(undefined);
      try {
        const resolved = await client.request("navigation.resolve", {
          target: { agentId, kind: "agent" },
        });
        if (
          navigationGeneration.current !== epoch ||
          resolved.target.kind !== "agent"
        )
          return false;
        setPeekHumanId(undefined);
        setPeekAgentId(resolved.target.agentId);
        setPanelIntent({ latest: "profile", source: origin });
        if (
          peekAgentId !== resolved.target.agentId ||
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
      if (surfaceRef.current === "activity" && next !== "activity")
        searchPreview.reset();
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
  const taskModalOpen =
    taskDetailVisible && surface !== "search" && surface !== "activity";
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
    if (previewThreadPrimary) {
      closeSearchPreview();
      return;
    }
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
          (surface === "room" || surface === "activity") &&
          resolved.target.roomId === activeRoomId
        ) {
          setChatTaskTarget(resolved.target);
          return true;
        }
        if (
          (surface === "activity" || surface === "search") &&
          searchPreview.roomId &&
          !location.surface &&
          "roomId" in resolved.target &&
          resolved.target.roomId === searchPreview.roomId &&
          (resolved.target.kind === "task" ||
            resolved.target.kind === "thread" ||
            (resolved.target.kind === "message" &&
              resolved.target.rootMessageId))
        ) {
          const target = resolved.target;
          const params = new URLSearchParams(window.location.search);
          if (target.kind === "task") {
            params.set("target", "task");
            params.set("task", target.taskId);
          } else {
            params.delete("target");
            params.delete("task");
          }
          if (target.rootMessageId)
            params.set("thread", `${target.roomId}:${target.rootMessageId}`);
          window.history.pushState(null, "", `?${params}`);
          setGlobalTaskDetail(
            globalTaskDetailFromSearch(window.location.search),
          );
          setActiveThreadRootMessageId(target.rootMessageId);
          setFocusedMessageId(
            target.kind === "message" ? target.messageId : target.rootMessageId,
          );
          setPanelIntent({ latest: "thread", source: "room" });
          return true;
        }
        setFocusHighlightQuery(location.highlightQuery?.trim() || undefined);
        if (
          (surface === "search" ||
            (surface === "activity" && location.surface !== "room") ||
            (surface === "saved" &&
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
            "rootMessageId" in resolved.target
              ? resolved.target.rootMessageId
              : undefined,
          );
          setPeekAgentId(undefined);
          setPeekHumanId(undefined);
          setPanelIntent({ latest: "thread", source: "room" });
          if (rooms.some((room) => room.roomId === id)) {
            // Selecting another target in the same Room does not restart the
            // Room read effect. Keep its coherent data instead of waiting for polling.
            setRoomData((current) =>
              current?.roomId === id ? current : undefined,
            );
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
        if (presentation.agentId !== undefined) {
          setAgentRoute({
            agentId: presentation.agentId,
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
      searchPreview.roomId,
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
  const [agentCreateChannel, setAgentCreateChannel] = useState<{
    roomId: string;
    name: string;
  }>();
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
  const [settingsIndexRequest, setSettingsIndexRequest] = useState(0);
  useEffect(() => {
    if (
      mobileLayout &&
      surface === "room" &&
      activeRoomId === undefined &&
      !new URLSearchParams(window.location.search).has("room")
    )
      setMobileRoomsOpen(true);
    else if (!mobileLayout) setMobileRoomsOpen(false);
  }, [mobileLayout, surface, activeRoomId]);
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
  const [roomReadTick, setRoomReadTick] = useState(0);
  const [directoryRevision, setDirectoryRevision] = useState(0);
  const sessions = useRef(new Map<string, RoomSession>());
  const messageSessions = useRef(new Map<string, MessageSession>());
  const threadMessageSessions = useRef(new Map<string, MessageSession>());
  const taskWindows = useRef(new Map<string, RoomTaskWindow>());
  const roomDataReads = useRef(createLatestRequest());
  const threadHistoryLoadingKey = useRef<string | undefined>(undefined);
  const activeThreadHistoryKey = useRef<string | undefined>(undefined);
  const sidebarPreferencesRef = useRef<SidebarPreferencesHandle>(null);
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
  const [attentionRevision, setAttentionRevision] = useState(0);
  const attention = useReconciledQuery(
    client,
    "activity.list",
    { workspaceId: activeWorkspace?.workspaceId ?? "none", limit: 1 },
    activeWorkspace !== undefined,
    attentionRevision,
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
            document.visibilityState === "visible" && humanInboxOpen
              ? 5000
              : 15000,
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
  }, [refreshHumanInbox, reload, humanInboxOpen]);

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
    const timeout = setTimeout(() => {
      controller.abort();
      setError("连接超时，请重试");
      setLoading(false);
    }, 15000);
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
          rooms: roomResult.rooms.map((room) =>
            room.kind === "direct"
              ? { ...room, name: runtimeProductName(room.name) }
              : room,
          ),
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
          if (
            requested === undefined &&
            new URLSearchParams(window.location.search).get("surface") ===
              "room"
          )
            return undefined;
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
        clearTimeout(timeout);
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [client, directoryRevision]);

  useEffect(() => {
    if (rooms.length === 0) return;
    const detachedSurface = surface !== "room";
    const current = new URLSearchParams(window.location.search);
    const sameRoom = current.get("room") === activeRoomId;
    const next = new URLSearchParams(
      surface === "agents"
        ? agentRouteSearch(window.location.search, agentRoute)
        : detachedSurface
          ? window.location.search
          : activeRoomId === undefined
            ? "?surface=room"
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
          surface === "search" ||
          (surface === "tasks" && globalTaskDetail !== undefined)) &&
        activeThreadRootMessageId &&
        activeRoomId
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
    rooms.length,
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
      setActiveThreadRootMessageId(
        requested === undefined
          ? undefined
          : threadRootSelectionFromSearch(window.location.search, requested),
      );
      if (
        requested === undefined &&
        new URLSearchParams(window.location.search).get("surface") === "room"
      ) {
        setActiveRoomId(undefined);
        setActiveThreadRootMessageId(undefined);
        setRoomData(undefined);
        return;
      }
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
    {
      controlRoomId: activeWorkspace?.controlRoomId ?? "none",
      includeDeleted: true,
    },
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

  const roomIdentitySources = useRef({ scopedAgentCatalog, localRuntimes });
  roomIdentitySources.current = { scopedAgentCatalog, localRuntimes };
  useEffect(() => {
    if (
      activeRoomId === undefined ||
      health === undefined ||
      (surface !== "room" && !conversationPreview && !taskModalOpen)
    )
      return;
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
        const messageSession = health.capabilities.messageRead
          ? getOrCreateBoundedSession(
              messageSessions.current,
              activeRoomId,
              () => new MessageSession({ client, roomId: activeRoomId }),
              8,
            )
          : undefined;
        // These authenticated reads do not depend on the Room delivery receipt.
        // Keep identity/task/thread facts together; diagnostic activity reconciles separately.
        const [
          roomCatchUp,
          messageResult,
          taskResult,
          threadResult,
          membershipResult,
        ] = await Promise.all([
          session.syncUntilCurrent({
            limit: 500,
            maxPages: 4,
            signal: read.signal,
          }),
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
        for (const entry of roomIdentitySources.current.scopedAgentCatalog) {
          knownPrincipals.set(entry.definition.participantId, {
            handle: entry.handle,
            kind: "agent",
            principalId: entry.definition.participantId,
          });
        }
        for (const runtime of roomIdentitySources.current.localRuntimes) {
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
          agentActivity: [],
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
        // The bounded Room message page is not a navigation authority: a
        // historical Thread root may only exist in its loaded context. Keep
        // the selected Thread until explicit navigation or Room change.
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
            () => setRoomReadTick((value) => value + 1),
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
    reload,
    roomReadTick,
    surface,
    conversationPreview,
    taskModalOpen,
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
    currentPresence?.map((value) => [value.agentId, value]),
  );
  const historicalAgentDirectory = workspaceAgentDirectory({
    agents: scopedAgentCatalog,
    runtimes: localRuntimes,
  }).map((agent) => {
    const presence = presenceById.get(agent.agentId);
    return {
      ...agent,
      ...(presence ? { presence } : {}),
      connectionStatus: computer?.status ?? ("unknown" as const),
    };
  });
  const agentDirectory = historicalAgentDirectory.filter(
    (agent) => agent.state !== "tombstoned",
  );
  const entities = createWorkspaceEntities({
    workspaceId: activeWorkspace?.workspaceId,
    actorId: currentPrincipal?.principalId,
    human: currentPrincipal,
    humans: humanDirectoryQuery?.data?.humans ?? [],
    hostId: localRuntimeHostId,
    computer,
    agents: historicalAgentDirectory,
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
  const activeDirectPeer = directConversationPeer(
    historicalAgentDirectory,
    activeRoom,
    currentPrincipal?.principalId,
  );
  const activeConversationName =
    activeRoom?.kind === "direct"
      ? activeDirectPeer?.displayName ||
        activeRoom.directParticipantIds
          ?.filter((id) => id !== currentPrincipal?.principalId)
          .map((id) => entities.person(id)?.displayName)
          .find(Boolean) ||
        activeRoom.name
      : activeRoom?.name;
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
      (member) =>
        [
          member.principalId,
          entities.resolvePerson(member).displayName || member.handle,
        ] as const,
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
  // Context bodies must not render before their Room identities/tasks/threads.
  // A focused navigation also waits for its bounded context, avoiding a tail flash.
  const conversationReady =
    activeRoomId !== undefined &&
    roomData?.roomId === activeRoomId &&
    (!focusedMessageId || messageContext !== undefined);
  const view = createRoomViewModel({
    members: (roomData?.members ?? []).map((member) =>
      entities.resolvePerson(member),
    ),
    messages: !conversationReady
      ? []
      : messageContext?.message.threadId === undefined &&
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
    members: (roomData?.members ?? []).map((member) =>
      entities.resolvePerson(member),
    ),
    messages: !conversationReady
      ? []
      : visibleThreadMessages.length > 0
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
            recipientIds: mentionedRoomAgentIds({ agents: roomAgents, body }),
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
      roomAgents,
      client,
      ensureActiveThread,
      focusedMessageId,
      health,
      roomData,
    ],
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
      steerEnabled?: boolean;
      allowInstanceTaskCreation?: boolean;
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
      const result = await roomUpdateWriteFor(activeRoom.roomId).run(
        { ...input, roomId: activeRoom.roomId },
        async () => {
          const synced = await session.syncUntilCurrent({ maxPages: 10 });
          if (!synced.caughtUp) throw new Error("频道尚未同步完成");
          return synced.state.latestRoomSeq;
        },
        (request) => client.request("room.update", request),
      );
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
      additionalDirectories?: string[];
      steerEnabled?: boolean;
      allowInstanceTaskCreation?: boolean;
      description?: string;
      initialAgentParticipantIds: string[];
      name: string;
      slug: string;
      visibility: "private" | "public";
    }) => {
      if (roomCreateWrite.current.state === "pending")
        throw new Error("频道创建正在进行");
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
      const navigationIntent = invalidateNavigation();
      let result;
      try {
        result = await roomCreateWrite.current.run(
          {
            ...input,
            workspaceId: workspace.workspaceId,
            kind: "channel" as const,
          },
          async () => {
            const synced = await controlSession.syncUntilCurrent({
              maxPages: 10,
            });
            if (!synced.caughtUp) throw new Error("工作区尚未同步完成");
            return synced.state.latestRoomSeq;
          },
          ({ basedOnRoomSeq, ...request }) =>
            client.request("room.create", {
              ...request,
              basedOnControlRoomSeq: basedOnRoomSeq,
            }),
        );
      } finally {
        setRoomCreateUnknown(roomCreateWrite.current.unknown);
      }
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
      await sidebarPreferencesRef.current?.refresh();
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
      if (surfaceRef.current === "activity") searchPreview.open(room.roomId);
      else setSurface("room");
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

  const roleCreateWrite = useRef(new RoleWrite());
  const roleJoinWrite = useRef(new RoleWrite());
  // Keep unresolved instance intents across SPA navigation, scoped to workspace.
  const roleInstanceWrites = useRef(new Map<string, RoleWrite>());
  const roleRevisionWrites = useRef(new Map<string, RoleWrite>());
  const roleScope = activeWorkspace?.controlRoomId ?? "unselected";
  if (!roleRevisionWrites.current.has(roleScope))
    roleRevisionWrites.current.set(roleScope, new RoleWrite());
  if (!roleInstanceWrites.current.has(roleScope))
    roleInstanceWrites.current.set(roleScope, new RoleWrite());
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        [
          roomCreateWrite.current,
          ...roomUpdateWrites.current.values(),
          roleCreateWrite.current,
          roleJoinWrite.current,
          ...roleInstanceWrites.current.values(),
          ...roleRevisionWrites.current.values(),
        ].some((write) => write.state !== "idle")
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const [roleWriteUnknown, setRoleWriteUnknown] = useState(false);
  const readRoleHead = useCallback(
    async (roomId: string) => {
      const session = roomSessionFor(
        sessions.current,
        client,
        consumerPrefix,
        roomId,
      );
      const synced = await session.syncUntilCurrent({ maxPages: 10 });
      if (!synced.caughtUp) throw new Error("频道尚未同步完成");
      return synced.state.latestRoomSeq;
    },
    [client, consumerPrefix],
  );
  const createAgent = useCallback(
    async (configuration: AgentCreateInput) => {
      const controlRoomId = activeWorkspace?.controlRoomId;
      if (!canCreateCurrentWorkspaceAgent || !controlRoomId)
        throw new Error("当前工作区不允许创建 Role");
      try {
        const result = await roleCreateWrite.current.run(
          { controlRoomId, configuration },
          () => readRoleHead(controlRoomId),
          (request) => client.request("role.create", request),
        );
        setReload((value) => value + 1);
        return result.role.roleId;
      } finally {
        setRoleWriteUnknown(roleCreateWrite.current.unknown);
      }
    },
    [activeWorkspace, canCreateCurrentWorkspaceAgent, client, readRoleHead],
  );

  const openAgentManagement = useCallback(
    async (agentId: string, mode: "all" | "runtime" = "all") => {
      if (!canManageCurrentWorkspaceAgent) {
        setError("需要 Workspace 管理员权限才能设置 Agent");
        return;
      }
      try {
        setAgentManageMode(mode);
        setAgentManageDetail(await client.request("agent.get", { agentId }));
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
            agent.definition.agentId === entry.definition.agentId &&
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
                agentId: input.agentId,
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
          agent.definition.agentId === result.agent.definition.agentId
            ? result.agent
            : agent,
        ),
      );
      if (result.hostBinding !== undefined) {
        setLocalRuntimes((current) =>
          current.map((runtime) => {
            const bindings = runtime.agentBindings.filter(
              ({ agentId }) => agentId !== result.agent.definition.agentId,
            );
            return runtime.runtimeOfferId === result.hostBinding?.runtimeOfferId
              ? {
                  ...runtime,
                  agentBindings: [
                    ...bindings,
                    {
                      agentId: result.agent.definition.agentId,
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
      agentId: string,
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
            agentId,
            basedOnRoomSeq,
            idempotencyKey,
            state,
          }),
        session: controlSession,
      });
      setAgentCatalog((current) =>
        current.map((agent) =>
          agent.definition.agentId === result.agent.definition.agentId
            ? result.agent
            : agent,
        ),
      );
      if (state === "tombstoned") {
        setLocalRuntimes((current) =>
          current.map((runtime) => ({
            ...runtime,
            agentBindings: runtime.agentBindings.filter(
              ({ agentId }) => agentId !== result.agent.definition.agentId,
            ),
          })),
        );
      }
    },
    [activeWorkspace, canManageCurrentWorkspaceAgent, client, consumerPrefix],
  );

  const setAgentState = useCallback(
    async (state: "disabled" | "enabled" | "tombstoned") => {
      const id = agentManageDetail?.agent.definition.agentId;
      if (!id) throw new Error("当前 Agent 设置上下文不可写");
      await changeWorkspaceAgentState(
        id,
        state,
        `web-agent-state-${browserOpaqueId()}`,
      );
      setAgentManageDetail((current) =>
        current?.agent.definition.agentId === id ? undefined : current,
      );
    },
    [agentManageDetail, changeWorkspaceAgentState],
  );

  const resetAgentExecution = useCallback(
    async (
      agentId: string,
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
            agentId,
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
        agentId,
      });
      setAgentCatalog((current) =>
        current.map((entry) =>
          entry.definition.agentId === agentId ? latest.agent : entry,
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
    initialAgentDefinitionId: agentRoute.agentId,
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
  const renderTaskProfile = (
    target: { kind: "agent" | "human"; id: string },
    onBack: () => void,
    onClose: () => void,
  ) => (
    <AgentDirectoryPane
      {...agentDetailProps}
      key={`${target.kind}:${target.id}`}
      panel
      panelResizer={<></>}
      initialView={target.kind}
      initialTab={target.kind === "human" ? "profile" : "activity"}
      initialAgentDefinitionId={target.kind === "agent" ? target.id : undefined}
      initialHumanPrincipalId={target.kind === "human" ? target.id : undefined}
      onRouteChange={undefined}
      onPanelBack={onBack}
      panelBackLabel="返回审批"
      panelCloseLabel="关闭任务详情"
      onClose={onClose}
    />
  );
  const peekRetained =
    (surface === "room" || conversationPreview) &&
    (peekAgentId !== undefined || peekHumanId !== undefined);
  const [layoutMode, setLayoutMode] =
    useState<ReturnType<typeof conversationLayout>>("replace");
  const panels = conversationPanels({
    ...panelIntent,
    thread: activeThreadRootMessageId !== undefined && !taskModalOpen,
    profile: peekRetained,
    split: layoutMode === "split",
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
    if (surfaceRef.current !== "room" && activeWorkspace && currentPrincipal) {
      const remembered = recallWorkspaceSurface(
        window.localStorage,
        currentPrincipal.principalId,
        activeWorkspace.workspaceId,
        "room",
      );
      const destination = remembered
        ? globalSurfaceFromSearch(remembered)
        : "room";
      setSurface(destination);
      const id = remembered
        ? roomSelectionFromSearch(remembered)
        : activeRoomId;
      const next = rooms.some((room) => room.roomId === id) ? id : undefined;
      setActiveRoomId(next);
      setMobileRoomsOpen(destination === "room" && next === undefined);
    } else setMobileRoomsOpen(true);
  }, [activeWorkspace, currentPrincipal, activeRoomId, rooms, setSurface]);
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
  useEffect(() => {
    if (health !== undefined || error)
      document.documentElement.removeAttribute("data-rah-boot");
  }, [health, error]);
  if (health === undefined)
    return (
      <div className="rah-boot-loading">
        {error ? (
          <div className="rah-inline-error" role="alert">
            <p>{error}</p>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setError(undefined);
                setDirectoryRevision((value) => value + 1);
              }}
            >
              重试
            </button>
          </div>
        ) : (
          <LoadingState />
        )}
      </div>
    );
  return (
    <SidebarPreferencesProvider
      ref={sidebarPreferencesRef}
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
            channels={[...rooms, ...archivedRooms].filter(
              (room) => room.workspaceId === entities.scope?.workspaceId,
            )}
            client={client}
            canManageAgents={canManageCurrentWorkspaceAgent}
            onOpen={(id, origin) => {
              if (entities.agent(id)?.state === "tombstoned") {
                invalidateNavigation();
                setPeekHumanId(undefined);
                setPeekAgentId(id);
                setPanelIntent({ latest: "profile", source: origin ?? "room" });
                return;
              }
              return surface === "room" || conversationPreview
                ? openAgentPeek(id, origin)
                : openDiscoveryLocation({
                    target: { kind: "agent", agentId: id },
                  });
            }}
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
              if (surface === "room" || conversationPreview) {
                setPeekHumanId(humanPrincipalId);
                setPanelIntent({ latest: "profile", source: origin });
              } else {
                setSurface("agents");
                navigateAgentRoute({
                  agentId: undefined,
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
              <ConversationLayoutShell
                panelKind={peekOpen ? "profile" : "thread"}
                scope={
                  conversationPreview
                    ? surface === "search"
                      ? "search"
                      : "activity"
                    : "room"
                }
                compact={
                  (activeThreadRootMessageId !== undefined &&
                    !searchPreview.threadId) ||
                  peekAgentId !== undefined ||
                  peekHumanId !== undefined
                }
                onModeChange={setLayoutMode}
                data-conversation-shell={
                  surface === "room" || conversationPreview ? "true" : undefined
                }
                data-profile-source={panels.source}
                data-activity-primary={previewThreadPrimary ? "thread" : "room"}
                className={`app rah-product-shell${globalSurface && !conversationPreview ? " rah-global-shell" : ""}${conversationPreview ? " rah-activity-preview" : ""}${taskModalOpen ? " rah-task-modal-open" : ""}${surface === "search" && searchPreview.roomId ? " rah-search-channel-open" : ""}${activeThreadRootMessageId === undefined ? " thread-hidden" : ""}${peekOpen ? " rah-agent-peek-open" : ""}`}
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
                    if (
                      nextSurface === surface &&
                      (surface === "search" || surface === "activity")
                    ) {
                      setPeekAgentId(undefined);
                      setPeekHumanId(undefined);
                      closeSearchPreview();
                      return;
                    }
                    let restoredSurface = nextSurface;
                    if (mobileLayout && nextSurface === "agents")
                      navigateAgentRoute({
                        agentId: undefined,
                        tab: "profile",
                      });
                    if (mobileLayout && nextSurface === "settings") {
                      const params = new URLSearchParams(
                        window.location.search,
                      );
                      params.delete("settingsSection");
                      window.history.replaceState(null, "", `?${params}`);
                      setSettingsIndexRequest((value) => value + 1);
                    }
                    if (nextSurface === "room") setTab("chat");
                    setMobileRoomsOpen(false);
                    if (
                      !mobileLayout &&
                      (nextSurface === "agents" || nextSurface === "room") &&
                      activeWorkspace &&
                      currentPrincipal
                    ) {
                      const remembered = recallWorkspaceSurface(
                        window.localStorage,
                        currentPrincipal.principalId,
                        activeWorkspace.workspaceId,
                        nextSurface,
                      );
                      if (remembered) {
                        if (nextSurface === "agents")
                          setAgentRoute(agentRouteFromSearch(remembered));
                        else {
                          restoredSurface = globalSurfaceFromSearch(remembered);
                          const id = roomSelectionFromSearch(remembered);
                          setActiveRoomId(
                            rooms.some((room) => room.roomId === id)
                              ? id
                              : undefined,
                          );
                        }
                      }
                    }
                    setPeekAgentId(undefined);
                    setPeekHumanId(undefined);
                    setFocusedMessageId(undefined);
                    setActiveThreadRootMessageId(undefined);
                    setRoomMembersOpen(false);
                    setSurface(restoredSurface);
                  }}
                />
                {conversationPreview && surface === "activity" ? (
                  <ConversationLayoutResizer kind="activity" />
                ) : null}
                {surface === "search" && searchPreview.roomId ? (
                  <ConversationLayoutResizer kind="search" />
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
                      agents={historicalAgentDirectory}
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
                        void client
                          .request("activity.mark", {
                            roomId,
                            throughSeq: 0,
                            action: "read",
                            source: "channel-list",
                          })
                          .then(() =>
                            setAttentionRevision((revision) => revision + 1),
                          )
                          .catch((caught) =>
                            setNavigationError(errorMessage(caught)),
                          );
                        const deselect =
                          !mobileLayout &&
                          !unreadSummary?.rooms.some(
                            (room) =>
                              room.roomId === roomId && room.unreadCount > 0,
                          ) &&
                          surface === "room" &&
                          roomId === activeRoomId &&
                          activeRoom?.kind === "channel";
                        window.history.pushState(
                          null,
                          "",
                          deselect
                            ? "?surface=room"
                            : roomSelectionSearch(roomId),
                        );
                        setTab("chat");
                        unreadHeld.current.delete(roomId);
                        setPeekAgentId(undefined);
                        setPeekHumanId(undefined);
                        setFocusedMessageId(undefined);
                        setActiveThreadRootMessageId(undefined);
                        setRoomMembersOpen(false);
                        if (roomId !== activeRoomId || deselect) {
                          setThreadMessages([]);
                          setRoomData(undefined);
                          consecutivePollFailures.current = 0;
                          setActiveRoomId(deselect ? undefined : roomId);
                        }
                        setSurface("room");
                        setMobileRoomsOpen(false);
                      }}
                    />
                  </SurfaceErrorBoundary>
                ) : null}
                {surface === "room" || surface === "saved" ? (
                  <ConversationLayoutResizer kind="room" />
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
                      archivedRooms={archivedRooms}
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
                      indexRequest={settingsIndexRequest}
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
                      onDeleteRoom={async (room) => {
                        if (!canCreateCurrentWorkspaceRoom)
                          throw new Error("当前 Human 没有删除频道的权限");
                        const session = roomSessionFor(
                          sessions.current,
                          client,
                          consumerPrefix,
                          room.roomId,
                        );
                        const idempotencyKey = `web-room-delete-${browserOpaqueId()}`;
                        await runRoomMutationAtLatest({
                          session,
                          mutate: (basedOnRoomSeq) =>
                            client.request("room.delete", {
                              roomId: room.roomId,
                              basedOnRoomSeq,
                              idempotencyKey,
                            }),
                        });
                        sessions.current.delete(room.roomId);
                        setArchivedRooms((current) =>
                          current.filter(
                            (entry) => entry.roomId !== room.roomId,
                          ),
                        );
                        setRooms((current) =>
                          current.filter(
                            (entry) => entry.roomId !== room.roomId,
                          ),
                        );
                        setReload((value) => value + 1);
                      }}
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
                  <SurfaceErrorBoundary surface="Role 管理">
                    {agentRoute.agentId || agentRoute.view === "human" ? (
                      <AgentDirectoryPane
                        {...agentDetailProps}
                        onPanelBack={() =>
                          navigateAgentRoute({
                            agentId: undefined,
                            tab: "profile",
                          })
                        }
                      />
                    ) : (
                      <RoleDirectoryPane
                        key={activeWorkspace?.controlRoomId}
                        client={client}
                        write={roleInstanceWrites.current.get(roleScope)!}
                        revisionWrite={roleRevisionWrites.current.get(
                          roleScope,
                        )!}
                        runtimes={localRuntimes}
                        onRefreshModels={async (refreshOfferId) => {
                          const result = await client.request(
                            "host.runtime.list",
                            { refreshOfferId },
                          );
                          setLocalRuntimes(result.runtimes);
                        }}
                        controlRoomId={activeWorkspace?.controlRoomId}
                        rooms={rooms}
                        revision={reload}
                        canCreate={canCreateCurrentWorkspaceAgent}
                        onCreate={() => setAgentCreateOpen(true)}
                        readHead={readRoleHead}
                        onInstantiated={() => setReload((value) => value + 1)}
                        onOpenRoom={(roomId) => {
                          void openDiscoveryLocation({
                            target: { kind: "room", roomId },
                          });
                        }}
                      />
                    )}
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
                      onOpenAgent={(agentId) => {
                        navigateAgentRoute({
                          agentId,
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
                ) : surface === "room" && activeRoomId === undefined ? (
                  <main className="channel rah-channel-empty">
                    <span>选择一个频道</span>
                  </main>
                ) : !globalSurface ||
                  (previewJoined && !previewThreadPrimary) ? (
                  <SurfaceErrorBoundary surface="会话" resetKey={activeRoomId}>
                    <main
                      className="channel"
                      inert={
                        (surface === "room" || conversationPreview) &&
                        !panels.room
                      }
                    >
                      <ChannelHeader
                        previewLabel={
                          surface === "room"
                            ? "聊天"
                            : surface === "activity"
                              ? "动态"
                              : "搜索"
                        }
                        onCloseSearchPreview={
                          (surface === "search" || surface === "activity") &&
                          previewJoined
                            ? closeSearchPreview
                            : () => {
                                openMobileHome();
                                setActiveRoomId(undefined);
                              }
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
                        room={
                          activeRoom && activeConversationName
                            ? { ...activeRoom, name: activeConversationName }
                            : activeRoom
                        }
                        memberCount={roomData?.activeMemberIds.length ?? 0}
                        onManageAgents={() => setRoomMembersOpen(true)}
                        onOpenDirectPeer={(id) => {
                          if (activeDirectPeer?.state === "tombstoned") {
                            invalidateNavigation();
                            setNavigationError(undefined);
                            setPeekHumanId(undefined);
                            setPeekAgentId(id);
                            setPanelIntent({
                              latest: "profile",
                              source: "room",
                            });
                          } else void openAgentPeek(id);
                        }}
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
                            ((surface !== "room" && !conversationPreview) ||
                              panels.room)
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
                                      source: "viewport",
                                    },
                                  );
                                  pendingReads.current.add(request);
                                  try {
                                    return (await request).readThroughSeq;
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
                          loading={
                            !conversationReady &&
                            !error &&
                            !locationResult.error
                          }
                          messageAgents={historicalAgentDirectory}
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
                          roomName={activeConversationName}
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
                          loading={
                            !conversationReady &&
                            !error &&
                            !locationResult.error
                          }
                          onChanged={() => setReload((value) => value + 1)}
                          onCreate={() => setTaskCreateOpen(true)}
                          onLoadEarlierTasks={loadEarlierTasks}
                          onOpenTask={openDiscoveryLocation}
                          roomName={activeConversationName ?? ""}
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
                      panelResizer={
                        <ConversationLayoutResizer kind="profile" />
                      }
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
                        key={globalTaskDetail?.taskId}
                        renderProfile={renderTaskProfile}
                        modal={taskModalOpen}
                        task={detailTask}
                        roomName={activeConversationName}
                        error={taskDetailResult.error}
                        onClose={closeTaskDetail}
                      >
                        <ThreadPane
                          onConvertToTask={convertMessageToTask}
                          searchPreview={
                            surface === "search" &&
                            previewJoined &&
                            previewThreadPrimary
                          }
                          inactive={
                            !taskModalOpen &&
                            (surface === "room" || conversationPreview) &&
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
                          messageAgents={historicalAgentDirectory}
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
                          loading={
                            threadLoading ||
                            (!conversationReady &&
                              !error &&
                              !locationResult.error)
                          }
                          earlierRepliesLoading={threadEarlierRepliesLoading}
                          hasEarlierReplies={threadHasEarlierReplies}
                          onClose={() => {
                            if (
                              taskModalOpen ||
                              (conversationPreview && taskDetailVisible)
                            ) {
                              closeTaskDetail();
                              return;
                            }
                            if (previewThreadPrimary && previewJoined) {
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
                            if (previewThreadPrimary && activeRoomId)
                              searchPreview.open(activeRoomId, rootMessageId);
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
                              <ConversationLayoutResizer kind="thread" />
                            )
                          }
                          roomEvents={roomData?.roomEvents ?? []}
                          roomId={activeRoomId}
                          roomKind={activeRoom?.kind}
                          roomName={activeConversationName}
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
                    key={chatTaskTarget.taskId}
                    renderProfile={renderTaskProfile}
                    client={client}
                    target={chatTaskTarget}
                    room={
                      activeRoom && activeConversationName
                        ? { ...activeRoom, name: activeConversationName }
                        : activeRoom
                    }
                    people={roomData?.members ?? []}
                    activeMemberIds={roomData?.activeMemberIds ?? []}
                    agents={historicalAgentDirectory}
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
                    onChanged={(updated) => {
                      if (updated)
                        setRoomData((current) =>
                          current && updated.roomId === activeRoomId
                            ? {
                                ...current,
                                tasks: current.tasks.map((task) =>
                                  task.taskId === updated.taskId
                                    ? updated
                                    : task,
                                ),
                              }
                            : current,
                        );
                      setReload((value) => value + 1);
                    }}
                    onClose={() => setChatTaskTarget(undefined)}
                  />
                ) : null}
                {roomCreateOpen ? (
                  <RoomCreateDialog
                    agents={[]}
                    roleInstancesOnly
                    resultUnknown={roomCreateUnknown}
                    savedInput={roomCreateWrite.current.payload}
                    onDiscard={() => {
                      if (
                        window.confirm(
                          "放弃核实不会撤销可能已创建的频道；请先查看频道列表。",
                        )
                      ) {
                        roomCreateWrite.current.discard();
                        setRoomCreateUnknown(false);
                        setRoomCreateOpen(false);
                        setReload((value) => value + 1);
                      }
                    }}
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
                    roleConfiguration
                    resultUnknown={roleWriteUnknown}
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
                    autoJoinChannelName={agentCreateChannel?.name}
                    onCreated={
                      agentCreateChannel
                        ? async (roleId) => {
                            const target = agentCreateChannel;
                            try {
                              await roleJoinWrite.current.run(
                                { roleId, channelId: target.roomId },
                                () => readRoleHead(target.roomId),
                                (request) =>
                                  client.request("role.instantiate", request),
                              );
                              setReload((value) => value + 1);
                            } finally {
                              setRoleWriteUnknown(
                                roleJoinWrite.current.unknown,
                              );
                            }
                          }
                        : undefined
                    }
                    onClose={() => {
                      if (
                        (roleCreateWrite.current.unknown ||
                          roleJoinWrite.current.unknown) &&
                        !window.confirm(
                          "结果未知。离开不会撤销可能已保存的 Role 或实例；请先查看列表，避免重复创建。",
                        )
                      )
                        return;
                      roleCreateWrite.current.discard();
                      roleJoinWrite.current.discard();
                      setRoleWriteUnknown(false);
                      setAgentCreateOpen(false);
                      setAgentCreateChannel(undefined);
                    }}
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
                    canAdd={false}
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
                    onArchive={() => changeRoomArchiveState(true)}
                    onClose={() => setRoomMembersOpen(false)}
                    onDelete={deleteCurrentRoom}
                    onLeave={leaveCurrentRoom}
                    onRemove={removeAgent}
                    onResumeAgents={resumeCurrentRoomAgents}
                    onRole={setRoomMemberRole}
                    onStopAgents={stopCurrentRoomAgents}
                    onUnarchive={async () => {
                      await changeRoomArchiveState(false);
                      setTab("chat");
                    }}
                    onUpdate={updateRoom}
                    settingsWrite={
                      activeRoom
                        ? roomUpdateWriteFor(activeRoom.roomId)
                        : undefined
                    }
                    leaveUnavailableReason={currentRoomLeave.reason}
                    room={
                      activeRoom && activeConversationName
                        ? { ...activeRoom, name: activeConversationName }
                        : activeRoom
                    }
                  />
                ) : null}
              </ConversationLayoutShell>
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
