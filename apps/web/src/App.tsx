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
import { AgentMessageContext } from "./components/agent-message-identity.tsx";
import type {
  AgentCatalogEntry,
  ClientAgentGetResponse,
  ClientHealthResponse,
  InputRequest,
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
  TaskReview,
  TaskSubmission,
  Thread,
  Workspace,
} from "@rah-os/protocol";
import {
  canCreateWorkspaceRoom,
  canHumanCancelTask,
  canHumanCompleteTask,
  canHumanForceReassignTask,
  canHumanReopenTask,
  canHumanSetTaskAssignee,
  canManageRoomMembers,
  canOnboardWorkspaceAgent,
  createRoomViewModel,
  foundationCapabilityIssue,
  mentionedRoomAgentIds,
  opaqueIdFromBytes,
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
import { HumanInboxCenter } from "./components/human-inbox.tsx";
import { RoomSidebarResizer } from "./components/room-sidebar-resizer.tsx";
import {
  ChannelHeader,
  MobileNavigation,
  Rail,
  RoomSidebar,
  TabButton,
  type Surface,
  type Tab,
} from "./components/workspace-navigation.tsx";
import { useRoomSidebarWidth } from "./use-room-sidebar-width.ts";
import { pendingInputRequestsForHuman } from "./human-inbox-projection.ts";
import { useReconciledQuery } from "./use-reconciled-query.ts";
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

type AppProps = { client?: RahClient };
declare const __RAH_TRUSTED_PROXY_AUTH__: boolean;
type RoomData = {
  activeMemberIds: string[];
  agentActivity: RoomAgentActivity[];
  caughtUp: boolean;
  hasEarlierMessages: boolean;
  latestRoomSeq: number;
  members: Principal[];
  memberships: RoomMembership[];
  messages: Message[];
  roomEvents: RoomEvent[];
  reviews: TaskReview[];
  submissions: TaskSubmission[];
  tasks: Task[];
  threads: Thread[];
};

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
          onDisconnect={() => setClient(undefined)}
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
  const [health, setHealth] = useState<ClientHealthResponse>();
  const [currentPrincipal, setCurrentPrincipal] = useState<Principal>();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [peekAgentId, setPeekAgentId] = useState<string>();
  const [rooms, setRooms] = useState<Room[]>([]);
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
  const [threadLoading, setThreadLoading] = useState(false);
  const [earlierMessagesLoading, setEarlierMessagesLoading] = useState(false);
  const [tab, setTab] = useState<Tab>(() =>
    roomTabFromSearch(window.location.search),
  );
  const navigationGeneration = useRef(0);
  const diagnosticNavigation = useRef(createLatestRequest());
  const [surface, setSurfaceState] = useState<Surface>(() =>
    globalSurfaceFromSearch(window.location.search),
  );
  const [agentRoute, setAgentRoute] = useState<AgentRouteSelection>(() =>
    agentRouteFromSearch(window.location.search),
  );
  const invalidateNavigation = useCallback(() => {
    diagnosticNavigation.current.cancel();
    return ++navigationGeneration.current;
  }, []);
  const openAgentPeek = useCallback(
    (agentDefinitionId: string) => {
      invalidateNavigation();
      setPeekAgentId(agentDefinitionId);
    },
    [invalidateNavigation],
  );
  const setSurface = useCallback(
    (next: Surface) => {
      invalidateNavigation();
      setSurfaceState(next);
    },
    [invalidateNavigation],
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
  const [focusedMessageId, setFocusedMessageId] = useState<string | undefined>(
    () =>
      new URLSearchParams(window.location.search).get("message") ?? undefined,
  );
  const locationResult = useDiscoveryQuery(
    client,
    "message.context",
    { messageId: focusedMessageId ?? "none" },
    (surface === "room" || surface === "activity") &&
      focusedMessageId !== undefined,
  );
  const messageContext =
    focusedMessageId !== undefined &&
    locationResult.data?.message.messageId === focusedMessageId &&
    locationResult.data.message.roomId === activeRoomId
      ? locationResult.data
      : undefined;
  const [navigationError, setNavigationError] = useState<string>();
  useEffect(() => {
    if (
      focusedMessageId !== undefined &&
      messageContext?.message.threadId !== undefined &&
      activeThreadRootMessageId === undefined
    ) {
      setActiveThreadRootMessageId(messageContext.rootMessageId);
    }
  }, [activeThreadRootMessageId, focusedMessageId, messageContext]);
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
        setRoomMembersOpen(false);
        setMobileRoomsOpen(false);
        setSurface(presentation.surface);
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
    [client, invalidateNavigation, setSurface],
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
  const [localRuntimes, setLocalRuntimes] = useState<
    LocalRuntimeInventoryEntry[]
  >([]);
  useEffect(() => {
    if (inventory?.data) setLocalRuntimes(inventory.data.runtimes);
  }, [inventory?.data]);
  const localRuntimeHostId = inventory?.data?.hostId;
  const computer = inventory?.error ? undefined : inventory?.data?.computer;
  const runtimeInventoryError = inventory?.error;
  const [agentCatalog, setAgentCatalog] = useState<AgentCatalogEntry[]>([]);
  const [agentCatalogControlRoomId, setAgentCatalogControlRoomId] =
    useState<string>();
  const [workspaceMembershipRole, setWorkspaceMembershipRole] =
    useState<MembershipRole>();
  const [mobileRoomsOpen, setMobileRoomsOpen] = useState(false);
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
  const [humanInboxLoading, setHumanInboxLoading] = useState(false);
  const [humanInboxError, setHumanInboxError] = useState<string>();
  const [humanInputRequests, setHumanInputRequests] = useState<InputRequest[]>(
    [],
  );
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const sessions = useRef(new Map<string, RoomSession>());
  const messageSessions = useRef(new Map<string, MessageSession>());
  const threadMessageSessions = useRef(new Map<string, MessageSession>());
  const directRoomOpenRequests = useRef(new Map<string, Promise<Room>>());
  const consecutivePollFailures = useRef(0);
  const consumerPrefix = useMemo(() => browserConsumerId(), []);
  const activeRoom = rooms.find((room) => room.roomId === activeRoomId);
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
          setLoading(false);
          return;
        }
        const roomResult = await client.request(
          "room.list",
          {},
          { signal: controller.signal },
        );
        const visibleRooms = selectProductRooms({
          rooms: roomResult.rooms,
          workspaces: activeWorkspaces,
        });
        setRooms(visibleRooms);
        setActiveRoomId((current) => {
          if (
            current !== undefined &&
            visibleRooms.some(({ roomId }) => roomId === current)
          ) {
            return current;
          }
          const requested = roomSelectionFromSearch(window.location.search);
          return (
            visibleRooms.find(({ roomId }) => roomId === requested)?.roomId ??
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
  }, [client]);

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
      ]) {
        const value = current.get(key);
        if (value !== null) next.set(key, value);
      }
    }
    if (detachedSurface) {
      next.set("surface", surface);
      if (surface === "activity" && activeThreadRootMessageId) {
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
    surface,
    tab,
  ]);

  useEffect(() => {
    const selectFromHistory = () => {
      setSurface(globalSurfaceFromSearch(window.location.search));
      setAgentRoute(agentRouteFromSearch(window.location.search));
      setTab(roomTabFromSearch(window.location.search));
      setFocusedMessageId(
        new URLSearchParams(window.location.search).get("message") ?? undefined,
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

  useEffect(() => {
    const controlRoomId = activeWorkspace?.controlRoomId;
    if (
      health === undefined ||
      !health.capabilities.agentRead ||
      controlRoomId === undefined
    ) {
      setAgentCatalog([]);
      setAgentCatalogControlRoomId(undefined);
      return;
    }
    const controller = new AbortController();
    void client
      .request("agent.list", { controlRoomId }, { signal: controller.signal })
      .then((catalog) => {
        if (controller.signal.aborted) return;
        setAgentCatalog(catalog.agents);
        setAgentCatalogControlRoomId(controlRoomId);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAgentCatalog([]);
          setAgentCatalogControlRoomId(undefined);
        }
      });
    return () => controller.abort();
  }, [activeWorkspace?.controlRoomId, client, health, reload]);

  useEffect(() => {
    const controlRoomId = activeWorkspace?.controlRoomId;
    if (
      currentPrincipal === undefined ||
      health === undefined ||
      !health.capabilities.memberRead ||
      controlRoomId === undefined
    ) {
      setWorkspaceMembershipRole(undefined);
      return;
    }
    const controller = new AbortController();
    setWorkspaceMembershipRole(undefined);
    void client
      .request(
        "room.member.list",
        { roomId: controlRoomId },
        { signal: controller.signal },
      )
      .then((result) => {
        setWorkspaceMembershipRole(
          result.memberships.find(
            ({ principalId }) => principalId === currentPrincipal.principalId,
          )?.role,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setWorkspaceMembershipRole(undefined);
      });
    return () => controller.abort();
  }, [activeWorkspace?.controlRoomId, client, currentPrincipal, health]);

  useEffect(() => {
    if (activeRoomId === undefined || health === undefined) return;
    const controller = new AbortController();
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
          signal: controller.signal,
        });
        let messageSession = messageSessions.current.get(activeRoomId);
        if (messageSession === undefined && health.capabilities.messageRead) {
          messageSession = new MessageSession({
            client,
            roomId: activeRoomId,
          });
          messageSessions.current.set(activeRoomId, messageSession);
        }
        const [
          messageResult,
          taskResult,
          threadResult,
          membershipResult,
          agentActivityResult,
          reviewEvidenceResult,
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
                signal: controller.signal,
              }),
          health.capabilities.taskRead
            ? client.request(
                "task.list",
                { roomId: activeRoomId },
                { signal: controller.signal },
              )
            : Promise.resolve({ tasks: [] as Task[] }),
          health.capabilities.threadRead
            ? client.request(
                "thread.list",
                { roomId: activeRoomId },
                { signal: controller.signal },
              )
            : Promise.resolve({ threads: [] as Thread[] }),
          health.capabilities.memberRead
            ? client.request(
                "room.member.list",
                { roomId: activeRoomId },
                { signal: controller.signal },
              )
            : Promise.resolve({
                memberships: [] as RoomMembership[],
              }),
          health.capabilities.agentRead
            ? client.request(
                "room.agent.activity.list",
                { roomId: activeRoomId },
                { signal: controller.signal },
              )
            : Promise.resolve({ agents: [] as RoomAgentActivity[] }),
          health.capabilities.taskRead
            ? client.request(
                "task.review.list",
                { roomId: activeRoomId },
                { signal: controller.signal },
              )
            : Promise.resolve({
                reviews: [] as TaskReview[],
                submissions: [] as TaskSubmission[],
              }),
        ]);
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
          memberships: membershipResult.memberships,
          messages: [...messageResult.messages],
          roomEvents: [...roomCatchUp.state.events],
          reviews: reviewEvidenceResult.reviews,
          submissions: reviewEvidenceResult.submissions,
          tasks: taskResult.tasks,
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
        if (!controller.signal.aborted) {
          consecutivePollFailures.current += 1;
          setError(errorMessage(caught));
        }
      } finally {
        if (!controller.signal.aborted) {
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
      controller.abort();
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
  const canManageCurrentWorkspaceAgent =
    health?.capabilities.agentWrite === true &&
    (workspaceMembershipRole === "owner" ||
      workspaceMembershipRole === "admin");
  const canManageManagedMcp =
    health?.capabilities.managedMcpWrite === true &&
    (workspaceMembershipRole === "owner" ||
      workspaceMembershipRole === "admin");
  const canReadManagedMcp =
    health?.capabilities.managedMcpRead === true &&
    (workspaceMembershipRole === "owner" ||
      workspaceMembershipRole === "admin");
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
  const activeThreadId = activeThread?.threadId;
  const activeThreadRoot = view.messages.find(
    (message) => message.messageId === activeThreadRootMessageId,
  );
  const threadView = createRoomViewModel({
    members: roomData?.members ?? [],
    messages:
      activeThreadId === undefined
        ? []
        : messageContext?.message.threadId === activeThreadId &&
            messageContext !== undefined
          ? messageContext.messages
          : threadMessages.filter(
              (message) => message.threadId === activeThreadId,
            ),
    tasks: [],
  });
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

  const createBoardTask = useCallback(
    async (input: TaskCreateInput) => {
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
      const id = browserOpaqueId();
      await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("task.create", {
            ...(input.assigneeId === undefined
              ? {}
              : { assigneeId: input.assigneeId }),
            basedOnRoomSeq,
            collaboratorIds: input.collaboratorIds,
            dependencyTaskIds: [],
            ...(input.description === undefined
              ? {}
              : { description: input.description }),
            idempotencyKey: `web-board-task-${id}`,
            reviewerIds: input.reviewerIds,
            roomId: activeRoom.roomId,
            title: input.title,
          }),
        session,
      });
      setReload((value) => value + 1);
    },
    [activeRoom, client, health, roomData],
  );

  const openThread = useCallback(
    async (rootMessageId: string) => {
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
        setThreadMessages([]);
        invalidateNavigation();
        setActiveThreadRootMessageId(rootMessageId);
        setError(undefined);
      } catch (caught) {
        setError(errorMessage(caught));
        setReload((value) => value + 1);
      }
    },
    [activeRoom, health, roomData, view.messages, invalidateNavigation],
  );

  useEffect(() => {
    if (
      activeRoomId === undefined ||
      activeThreadId === undefined ||
      health === undefined ||
      !health.capabilities.threadRead
    ) {
      setThreadMessages([]);
      setThreadLoading(false);
      return;
    }
    const controller = new AbortController();
    setThreadLoading(true);
    void (async () => {
      try {
        const sessionKey = `${activeRoomId}:${activeThreadId}`;
        let session = threadMessageSessions.current.get(sessionKey);
        if (session === undefined) {
          session = new MessageSession({
            client,
            roomId: activeRoomId,
            threadId: activeThreadId,
          });
          threadMessageSessions.current.set(sessionKey, session);
        }
        const result = await session.syncUntilCurrent({
          limit: RAFT_MESSAGE_PAGE_SIZE,
          maxPages: 4,
          signal: controller.signal,
        });
        setThreadMessages([...result.messages]);
      } catch (caught) {
        if (!controller.signal.aborted) setError(errorMessage(caught));
      } finally {
        if (!controller.signal.aborted) setThreadLoading(false);
      }
    })();
    return () => controller.abort();
  }, [activeRoomId, activeThreadId, client, health, reload]);

  const loadEarlierMessages = useCallback(async () => {
    if (activeRoomId === undefined || earlierMessagesLoading) return;
    const session = messageSessions.current.get(activeRoomId);
    if (session === undefined || !session.state.hasEarlier) return;
    setEarlierMessagesLoading(true);
    try {
      const result = await session.loadEarlier({
        limit: RAFT_MESSAGE_PAGE_SIZE,
      });
      setRoomData((current) =>
        current === undefined
          ? current
          : {
              ...current,
              hasEarlierMessages: result.hasEarlier,
              messages: [...result.messages],
            },
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setEarlierMessagesLoading(false);
    }
  }, [activeRoomId, earlierMessagesLoading]);

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
      const session = sessions.current.get(activeRoom.roomId);
      if (session === undefined) {
        throw new Error("当前 Room 尚未建立 canonical session");
      }
      let thread = activeThread;
      let createdRoomSeq = 0;
      if (thread === undefined) {
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
        thread = created.thread;
        createdRoomSeq = created.event.roomSeq;
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
      }
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
      setReload((value) => value + 1);
    },
    [
      activeRoom,
      activeThread,
      activeThreadRootMessageId,
      availableAgentIds,
      client,
      focusedMessageId,
      health,
      roomData,
    ],
  );

  const completeTask = useCallback(
    async (task: Task) => {
      if (
        activeRoom === undefined ||
        roomData === undefined ||
        health === undefined
      )
        return;
      if (
        !canHumanCompleteTask({
          caughtUp: roomData.caughtUp,
          currentPrincipalId: currentPrincipal?.principalId,
          reviews: roomData.reviews,
          submissions: roomData.submissions,
          task,
          taskWrite: health.capabilities.taskWrite,
        })
      ) {
        throw new Error("Task 尚未进入可验收状态，或 Room 未追赶到最新位置");
      }
      const session = sessions.current.get(activeRoom.roomId);
      if (session === undefined) {
        throw new Error("当前 Room 尚未建立 canonical session");
      }
      const idempotencyKey = `web-task-complete-${browserOpaqueId()}`;
      await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("task.complete", {
            basedOnRoomSeq,
            idempotencyKey,
            taskId: task.taskId,
          }),
        session,
      });
      setReload((value) => value + 1);
    },
    [activeRoom, client, currentPrincipal?.principalId, health, roomData],
  );

  const cancelTask = useCallback(
    async (task: Task, reason: string) => {
      if (
        activeRoom === undefined ||
        roomData === undefined ||
        health === undefined
      )
        return;
      if (
        !canHumanCancelTask({
          caughtUp: roomData.caughtUp,
          currentPrincipalId: currentPrincipal?.principalId,
          task,
          taskWrite: health.capabilities.taskWrite,
        })
      ) {
        throw new Error("当前 Task 状态或 Room 游标不允许关闭");
      }
      const session = sessions.current.get(activeRoom.roomId);
      if (session === undefined) {
        throw new Error("当前 Room 尚未建立 canonical session");
      }
      const idempotencyKey = `web-task-cancel-${browserOpaqueId()}`;
      await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("task.cancel", {
            basedOnRoomSeq,
            idempotencyKey,
            reason,
            taskId: task.taskId,
          }),
        session,
      });
      setReload((value) => value + 1);
    },
    [activeRoom, client, currentPrincipal?.principalId, health, roomData],
  );

  const reopenTask = useCallback(
    async (task: Task) => {
      if (
        activeRoom === undefined ||
        roomData === undefined ||
        health === undefined
      )
        return;
      if (
        !canHumanReopenTask({
          caughtUp: roomData.caughtUp,
          currentPrincipalId: currentPrincipal?.principalId,
          task,
          taskWrite: health.capabilities.taskWrite,
        })
      ) {
        throw new Error("当前 Task 尚未关闭，或 Room 未追赶到最新位置");
      }
      const session = sessions.current.get(activeRoom.roomId);
      if (session === undefined) {
        throw new Error("当前 Room 尚未建立 canonical session");
      }
      const idempotencyKey = `web-task-reopen-${browserOpaqueId()}`;
      await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("task.reopen", {
            basedOnRoomSeq,
            idempotencyKey,
            taskId: task.taskId,
          }),
        session,
      });
      setReload((value) => value + 1);
    },
    [activeRoom, client, currentPrincipal?.principalId, health, roomData],
  );

  const setTaskAssignee = useCallback(
    async (task: Task, assigneeId: string | undefined) => {
      if (
        activeRoom === undefined ||
        roomData === undefined ||
        health === undefined
      )
        return;
      if (
        !canHumanSetTaskAssignee({
          caughtUp: roomData.caughtUp,
          currentPrincipalId: currentPrincipal?.principalId,
          task,
          taskWrite: health.capabilities.taskWrite,
        })
      ) {
        throw new Error(
          "Task 已被领取、不是待办状态，或当前 Human 无权设置负责人",
        );
      }
      if (task.assigneeId === assigneeId) return;
      const session = sessions.current.get(activeRoom.roomId);
      if (session === undefined) {
        throw new Error("当前 Room 尚未建立 canonical session");
      }
      const idempotencyKey = `web-task-assignee-${browserOpaqueId()}`;
      await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          assigneeId === undefined
            ? client.request("task.unassign", {
                basedOnRoomSeq,
                idempotencyKey,
                taskId: task.taskId,
              })
            : client.request("task.assign", {
                assigneeId,
                basedOnRoomSeq,
                idempotencyKey,
                taskId: task.taskId,
              }),
        session,
      });
      setReload((value) => value + 1);
    },
    [activeRoom, client, currentPrincipal?.principalId, health, roomData],
  );

  const reassignTask = useCallback(
    async (task: Task, assigneeId: string, reason: string) => {
      if (
        activeRoom === undefined ||
        roomData === undefined ||
        health === undefined
      )
        return;
      if (
        !canHumanForceReassignTask({
          caughtUp: roomData.caughtUp,
          currentPrincipalId: currentPrincipal?.principalId,
          task,
          taskReassignment: health.capabilities.taskReassignment === true,
          taskWrite: health.capabilities.taskWrite,
        })
      ) {
        throw new Error(
          "Task 不是执行中状态、当前 Human 无权改派，或 daemon 未开放安全改派",
        );
      }
      if (task.assigneeId === assigneeId) return;
      const session = sessions.current.get(activeRoom.roomId);
      if (session === undefined) {
        throw new Error("当前 Room 尚未建立 canonical session");
      }
      const idempotencyKey = `web-task-reassign-${browserOpaqueId()}`;
      await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("task.reassign", {
            assigneeId,
            basedOnRoomSeq,
            idempotencyKey,
            reason,
            taskId: task.taskId,
          }),
        session,
      });
      setReload((value) => value + 1);
    },
    [activeRoom, client, currentPrincipal?.principalId, health, roomData],
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
      setAgentCreateOpen(false);
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
      const result = await runRoomMutationAtLatest({
        mutate: async (basedOnRoomSeq) => {
          const latest = await client.request("agent.get", {
            agentDefinitionId: detail.agent.definition.agentDefinitionId,
          });
          if (
            latest.agent.currentRevision.revision !==
            detail.agent.currentRevision.revision
          ) {
            throw new Error(
              "Agent 配置已在其他页面修改。请关闭并重新打开编辑窗口后再保存，本次未覆盖。",
            );
          }
          return client.request("agent.manage", {
            ...input,
            action: "configure",
            agentDefinitionId: detail.agent.definition.agentDefinitionId,
            basedOnRoomSeq,
            idempotencyKey: `web-agent-configure-${browserOpaqueId()}`,
          });
        },
        session: controlSession,
      });
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
      setAgentManageDetail(undefined);
    },
    [
      activeWorkspace,
      agentManageDetail,
      canManageCurrentWorkspaceAgent,
      client,
      consumerPrefix,
    ],
  );

  const setAgentState = useCallback(
    async (state: "disabled" | "enabled" | "tombstoned") => {
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
      const result = await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("agent.manage", {
            action: "set_state",
            agentDefinitionId: detail.agent.definition.agentDefinitionId,
            basedOnRoomSeq,
            idempotencyKey: `web-agent-state-${browserOpaqueId()}`,
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
      setAgentManageDetail(undefined);
    },
    [
      activeWorkspace,
      agentManageDetail,
      canManageCurrentWorkspaceAgent,
      client,
      consumerPrefix,
    ],
  );

  const resetAgentExecution = useCallback(
    async (agentDefinitionId: string, mode: "restart" | "session") => {
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
            idempotencyKey: `web-agent-execution-reset-${browserOpaqueId()}`,
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

  const agentDetailProps = {
    initialAgentDefinitionId: agentRoute.agentDefinitionId,
    initialTab: agentRoute.tab,
    onSaveProfile: saveAgentProfile,
    agents: agentDirectory,
    canCreate: canCreateCurrentWorkspaceAgent,
    canManage: canManageCurrentWorkspaceAgent,
    canMessage:
      health?.capabilities.roomWrite === true &&
      workspaceMembershipRole !== undefined,
    canReadManagedMcp,
    client,
    computerLabel: localRuntimeHostId,
    computerStatus: computer?.status,
    controlRoomId: activeWorkspace?.controlRoomId,
    currentHuman: currentPrincipal,
    onCreate: () => setAgentCreateOpen(true),
    onManage: (id: string) => void openAgentManagement(id),
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
    },
    onOpenRoom: (roomId: string) => {
      void openDiscoveryLocation({
        target: { kind: "room", roomId },
      });
      setPeekAgentId(undefined);
    },
    onRouteChange: navigateAgentRoute,
    runtimes: localRuntimes,
  };
  const peekOpen = surface === "room" && peekAgentId !== undefined;
  return (
    <SidebarPreferencesProvider
      key={`${currentPrincipal?.principalId}:${activeWorkspace?.workspaceId}`}
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
          <AgentMessageContext.Provider
            value={{
              client,
              runtimes: localRuntimes,
              computerLabel: computer?.displayName ?? localRuntimeHostId,
              onOpen: openAgentPeek,
            }}
          >
            <div
              className={`app rah-product-shell${globalSurface ? " rah-global-shell" : ""}${activeThreadRootMessageId === undefined ? " thread-hidden" : ""}${peekOpen ? " rah-agent-peek-open" : ""}`}
              style={
                {
                  "--rah-room-sidebar-width": `${roomSidebarWidth}px`,
                } as CSSProperties
              }
            >
              <Rail
                identity={
                  <WorkspaceIdentity
                    computerName={computer?.displayName}
                    workspace={activeWorkspace}
                    workspaces={workspaces}
                    client={client}
                    canManage={
                      health?.capabilities.roomWrite === true &&
                      (workspaceMembershipRole === "owner" ||
                        workspaceMembershipRole === "admin")
                    }
                    onUpdated={(workspace) =>
                      setWorkspaces((current) =>
                        current.map((w) =>
                          w.workspaceId === workspace.workspaceId
                            ? workspace
                            : w,
                        ),
                      )
                    }
                    onSelect={(workspace) => {
                      setSelectedWorkspaceId(workspace.workspaceId);
                      setActiveRoomId(
                        rooms.find(
                          (room) => room.workspaceId === workspace.workspaceId,
                        )?.roomId,
                      );
                      setSurface("room");
                      setPeekAgentId(undefined);
                      setActiveThreadRootMessageId(undefined);
                    }}
                  />
                }
                active={surface}
                notificationCount={humanInputRequests.length}
                activityUnread={(unreadSummary?.unreadActivityCount ?? 0) > 0}
                chatUnread={(unreadSummary?.rooms.length ?? 0) > 0}
                computerAttention={computer?.status === "offline"}
                notificationAttention={systemNoticeView.notices.length > 0}
                notificationsOpen={humanInboxOpen}
                onNotifications={() => setHumanInboxOpen((open) => !open)}
                onTasks={() => {
                  setActiveThreadRootMessageId(undefined);
                  setRoomMembersOpen(false);
                  setFocusedMessageId(undefined);
                  setSurface("tasks");
                }}
                onSelect={(nextSurface) => {
                  setPeekAgentId(undefined);
                  setFocusedMessageId(undefined);
                  setActiveThreadRootMessageId(undefined);
                  setRoomMembersOpen(false);
                  setSurface(nextSurface);
                }}
              />
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
                    return openDiscoveryLocation({ target }).then((opened) => {
                      if (opened) setHumanInboxOpen(false);
                    });
                  }}
                  rooms={rooms}
                />
              ) : null}
              {surface === "room" || surface === "saved" ? (
                <RoomSidebar
                  savedActive={surface === "saved"}
                  onSaved={
                    health?.capabilities.messageSocial
                      ? () => {
                          setSurface("saved");
                          setPeekAgentId(undefined);
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
                  canCreate={
                    canCreateCurrentWorkspaceRoom &&
                    activeWorkspace?.controlRoomId !== undefined
                  }
                  mobileOpen={mobileRoomsOpen}
                  onClose={() => setMobileRoomsOpen(false)}
                  onCreate={() => setRoomCreateOpen(true)}
                  onEditRoom={(roomId) => {
                    invalidateNavigation();
                    setFocusedMessageId(undefined);
                    setActiveThreadRootMessageId(undefined);
                    setThreadMessages([]);
                    if (roomId !== activeRoomId) {
                      setRoomData(undefined);
                      consecutivePollFailures.current = 0;
                      setActiveRoomId(roomId);
                    }
                    setMobileRoomsOpen(false);
                    setRoomMembersOpen(true);
                  }}
                  rooms={rooms}
                  workspace={activeWorkspace}
                  unreadRooms={unreadSummary?.rooms}
                  onSelect={(roomId) => {
                    setPeekAgentId(undefined);
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
              {surface === "saved" && activeWorkspace ? (
                <SavedMessagesPane
                  key={activeWorkspace.workspaceId}
                  client={client}
                  workspaceId={activeWorkspace.workspaceId}
                  onOpen={openDiscoveryLocation}
                  onOpenRooms={() => setMobileRoomsOpen(true)}
                />
              ) : globalSurface && activeWorkspace ? (
                <GlobalDiscoverySurface
                  key={`${surface}:${activeWorkspace.workspaceId}`}
                  client={client}
                  surface={surface as "tasks" | "search" | "activity"}
                  workspaceId={activeWorkspace.workspaceId}
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
                  }}
                />
              ) : surface === "settings" ? (
                <SettingsSurface
                  agents={agentDirectory}
                  canManageWorkspace={
                    health?.capabilities.roomWrite === true &&
                    (workspaceMembershipRole === "owner" ||
                      workspaceMembershipRole === "admin")
                  }
                  canReadManagedMcp={canReadManagedMcp}
                  canWriteManagedMcp={canManageManagedMcp}
                  client={client}
                  consumerPrefix={consumerPrefix}
                  controlRoomId={activeWorkspace?.controlRoomId}
                  currentPrincipal={currentPrincipal}
                  onPrincipalUpdated={setCurrentPrincipal}
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
              ) : surface === "agents" ? (
                <AgentDirectoryPane {...agentDetailProps} />
              ) : surface === "computers" ? (
                <ComputerRuntimePane
                  hostId={localRuntimeHostId}
                  computer={computer}
                  agents={agentDirectory}
                  inventoryError={runtimeInventoryError}
                  runtimes={localRuntimes}
                />
              ) : (
                <main className="channel">
                  <ChannelHeader
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
                    onManageAgents={() => {
                      setActiveThreadRootMessageId(undefined);
                      setRoomMembersOpen(true);
                    }}
                    onOpenDirectPeer={(id) => openAgentPeek(id)}
                    onOpenRooms={() => setMobileRoomsOpen(true)}
                  />
                  <div className="tabs" role="tablist">
                    <TabButton
                      active={tab === "chat"}
                      disabled={health?.capabilities.messageRead === false}
                      icon="chat"
                      label="聊天"
                      onClick={() => setTab("chat")}
                    />
                    <TabButton
                      active={tab === "tasks"}
                      disabled={health?.capabilities.taskRead === false}
                      icon="listcheck"
                      label="任务"
                      onClick={() => setTab("tasks")}
                    />
                    <TabButton
                      active={tab === "files"}
                      icon="clip"
                      label="文件"
                      onClick={() => setTab("files")}
                    />
                  </div>
                  {roomData?.caughtUp === false ? (
                    <div className="rah-sync-status">正在追赶 Room 历史…</div>
                  ) : null}
                  {error === undefined ? null : (
                    <div className="rah-error">
                      <span>{error}</span>
                      <button onClick={onDisconnect}>重新连接</button>
                    </div>
                  )}
                  {focusedMessageId && (
                    <div className="rah-message-location" role="status">
                      {locationResult.error ??
                        (locationResult.loading
                          ? "正在定位消息…"
                          : "已定位原消息及前后文")}
                      <button
                        className="tasks-clear"
                        onClick={() => setFocusedMessageId(undefined)}
                      >
                        返回最新消息
                      </button>
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
                      canAttachFiles={health?.capabilities.fileShare === true}
                      onReadThrough={
                        activeRoomId && (!focusedMessageId || messageContext)
                          ? async (throughSeq) => {
                              await client.request("activity.mark", {
                                roomId: activeRoomId,
                                throughSeq,
                                action: "read",
                              });
                            }
                          : undefined
                      }
                      focusedMessageId={focusedMessageId}
                      canCreateTask={
                        health?.capabilities.taskWrite === true &&
                        roomData?.caughtUp === true
                      }
                      canPost={
                        health?.capabilities.messageWrite === true &&
                        roomData?.caughtUp === true
                      }
                      canReadThreads={health?.capabilities.threadRead === true}
                      canWriteThreads={
                        health?.capabilities.threadWrite === true &&
                        roomData?.caughtUp === true
                      }
                      loading={loading}
                      messageAgents={agentDirectory}
                      hasEarlierMessages={
                        !messageContext && roomData?.hasEarlierMessages === true
                      }
                      earlierMessagesLoading={earlierMessagesLoading}
                      messages={view.messages}
                      roomEvents={roomData?.roomEvents ?? []}
                      roomMembers={roomData?.members ?? []}
                      agents={roomAgents}
                      tasks={roomData?.tasks ?? []}
                      threadReplyPreviews={threadReplyPreviews}
                      onConvertToTask={convertMessageToTask}
                      onManageAgents={() => setRoomMembersOpen(true)}
                      onLoadEarlier={loadEarlierMessages}
                      onOpenThread={openThread}
                      onOpenTarget={(target) =>
                        void openDiscoveryLocation({ target })
                      }
                      roomName={activeRoom?.name}
                      roomKind={activeRoom?.kind}
                      roomId={activeRoom?.roomId}
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
                      agents={roomAgents}
                      canOpenThread={health?.capabilities.threadRead === true}
                      canReassign={
                        health?.capabilities.taskReassignment === true
                      }
                      canWrite={health?.capabilities.taskWrite === true}
                      caughtUp={roomData?.caughtUp === true}
                      columns={view.taskColumns}
                      currentPrincipalId={currentPrincipal?.principalId}
                      loading={loading}
                      onCreate={() => setTaskCreateOpen(true)}
                      onCancel={cancelTask}
                      onComplete={completeTask}
                      onOpenThread={(task) => openThread(task.sourceMessageId)}
                      onReopen={reopenTask}
                      onReassign={reassignTask}
                      onSetAssignee={setTaskAssignee}
                      reviews={roomData?.reviews ?? []}
                      submissions={roomData?.submissions ?? []}
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
              )}
              {peekOpen ? (
                <AgentDirectoryPane
                  key={peekAgentId}
                  {...agentDetailProps}
                  initialAgentDefinitionId={peekAgentId}
                  initialTab="activity"
                  onRouteChange={undefined}
                  panel
                  onClose={() => {
                    invalidateNavigation();
                    setPeekAgentId(undefined);
                  }}
                />
              ) : null}
              {(surface !== "room" && surface !== "activity") ||
              activeThreadRootMessageId === undefined ? null : (
                <ThreadPane
                  messageAgents={agentDirectory}
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
                  canReply={
                    health?.capabilities.threadWrite === true &&
                    roomData?.caughtUp === true
                  }
                  canAttachFiles={health?.capabilities.fileShare === true}
                  loading={threadLoading}
                  onClose={() => {
                    invalidateNavigation();
                    setActiveThreadRootMessageId(undefined);
                    if (messageContext?.message.threadId)
                      setFocusedMessageId(undefined);
                  }}
                  onSubmit={submitThreadReply}
                  onFollow={
                    activeRoomId && activeThreadId
                      ? async (following) => {
                          await client.request("activity.follow", {
                            roomId: activeRoomId,
                            threadId: activeThreadId,
                            following,
                          });
                        }
                      : undefined
                  }
                  onOpenTarget={(target) =>
                    void openDiscoveryLocation({ target })
                  }
                  replies={threadView.messages}
                  roomEvents={roomData?.roomEvents ?? []}
                  roomId={activeRoomId}
                  roomKind={activeRoom?.kind}
                  roomName={activeRoom?.name}
                  root={activeThreadRoot}
                  threadId={activeThreadId}
                />
              )}
              {roomCreateOpen ? (
                <RoomCreateDialog
                  agents={agentDirectory.filter(
                    ({ state }) => state === "enabled",
                  )}
                  onClose={() => setRoomCreateOpen(false)}
                  onCreate={createRoom}
                />
              ) : null}
              {taskCreateOpen ? (
                <TaskCreateDialog
                  agents={roomAgents}
                  onClose={() => setTaskCreateOpen(false)}
                  onCreate={createBoardTask}
                  roomName={activeRoom?.name}
                />
              ) : null}
              {agentCreateOpen && activeWorkspace !== undefined ? (
                <AgentCreateDialog
                  computerLabel={localRuntimeHostId}
                  onClose={() => setAgentCreateOpen(false)}
                  onCreate={createAgent}
                  runtimes={localRuntimes}
                />
              ) : null}
              {agentManageDetail !== undefined ? (
                agentManageMode === "runtime" ? (
                  <AgentRuntimeDialog
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
                  canAdd={
                    canOnboardCurrentRoomAgent && roomData?.caughtUp === true
                  }
                  canRemove={
                    canManageCurrentRoomMembers && roomData?.caughtUp === true
                  }
                  canUpdate={
                    canManageCurrentRoomMembers && roomData?.caughtUp === true
                  }
                  candidates={roomMemberCandidates}
                  memberships={roomData?.memberships ?? []}
                  members={(roomData?.members ?? []).filter(({ principalId }) =>
                    activeMemberIdSet.has(principalId),
                  )}
                  onAdd={onboardAgent}
                  onClose={() => setRoomMembersOpen(false)}
                  onRemove={removeAgent}
                  onUpdate={updateRoom}
                  room={activeRoom}
                />
              ) : null}
              <MobileNavigation
                onSearch={() => {
                  setFocusedMessageId(undefined);
                  setSurface("search");
                }}
                onActivity={() => {
                  setFocusedMessageId(undefined);
                  setSurface("activity");
                }}
                activeSurface={surface}
                activeTab={tab}
                notificationCount={humanInputRequests.length}
                notificationsOpen={humanInboxOpen}
                notificationAttention={systemNoticeView.notices.length > 0}
                onAgents={() => {
                  setActiveThreadRootMessageId(undefined);
                  setMobileRoomsOpen(false);
                  setRoomMembersOpen(false);
                  setSurface("agents");
                }}
                onChat={() => {
                  setMobileRoomsOpen(false);
                  setRoomMembersOpen(false);
                  setSurface("room");
                  setTab("chat");
                }}
                onNotifications={() => {
                  setMobileRoomsOpen(false);
                  setRoomMembersOpen(false);
                  setHumanInboxOpen((open) => !open);
                }}
                onRooms={() => setMobileRoomsOpen((open) => !open)}
                onSettings={() => {
                  setActiveThreadRootMessageId(undefined);
                  setMobileRoomsOpen(false);
                  setRoomMembersOpen(false);
                  setSurface("settings");
                }}
                onTasks={() => {
                  setMobileRoomsOpen(false);
                  setRoomMembersOpen(false);
                  setFocusedMessageId(undefined);
                  setSurface("tasks");
                }}
                roomsOpen={mobileRoomsOpen}
              />
            </div>
          </AgentMessageContext.Provider>
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
  const existing = sessions.get(roomId);
  if (existing !== undefined) return existing;
  const session = new RoomSession({
    client,
    consumerId: `${consumerPrefix}-${roomId}`,
    roomId,
  });
  sessions.set(roomId, session);
  return session;
}

function browserOpaqueId(): string {
  return opaqueIdFromBytes(
    globalThis.crypto.getRandomValues(new Uint8Array(16)),
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
