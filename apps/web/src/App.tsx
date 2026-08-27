import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ensureRoomMembership,
  ensureRoomMembershipRemoved,
  loadOrCreateConsumerId,
  MessageSession,
  RoomSession,
  runRoomMutationAtLatest,
} from "@rah-os/client-core";
import { HttpRahClient, type RahClient } from "@rah-os/client-sdk";
import type {
  AgentCatalogEntry,
  ClientHealthResponse,
  LocalRuntimeInventoryEntry,
  MembershipRole,
  Message,
  Principal,
  Room,
  RoomAgentActivity,
  RoomMembership,
  Task,
  Thread,
  Workspace,
} from "@rah-os/protocol";
import {
  canCreateWorkspaceRoom,
  canHumanCompleteTask,
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
  taskAssigneeForSelectedAgents,
  workspaceAgentDirectory,
} from "@rah-os/ui-web";

import {
  ChatPane,
  TaskPane,
  ThreadPane,
  UnavailablePane,
} from "./components/conversation-panes.tsx";
import {
  RoomCreateDialog,
  RoomMembersDialog,
  type AgentMembershipIdentity,
} from "./components/room-dialogs.tsx";
import {
  AgentDirectoryPane,
  ComputerRuntimePane,
} from "./components/workspace-catalog-panes.tsx";
import {
  ChannelHeader,
  MobileNavigation,
  Rail,
  RoomSidebar,
  TabButton,
  type Surface,
  type Tab,
} from "./components/workspace-navigation.tsx";

type AppProps = { client?: RahClient };
declare const __RAH_DEV_PROXY_AUTH__: boolean;
type RoomData = {
  activeMemberIds: string[];
  agentActivity: RoomAgentActivity[];
  caughtUp: boolean;
  latestRoomSeq: number;
  members: Principal[];
  memberships: RoomMembership[];
  messages: Message[];
  tasks: Task[];
  threads: Thread[];
};

export function App({ client: injectedClient }: AppProps) {
  const [client, setClient] = useState<RahClient | undefined>(() =>
    injectedClient === undefined && __RAH_DEV_PROXY_AUTH__
      ? new HttpRahClient({
          accessToken: () => "development-proxy-auth",
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
    <WorkspaceScreen
      client={client}
      onDisconnect={() => setClient(undefined)}
    />
  );
}

function ConnectionScreen({
  onConnect,
}: {
  onConnect: (accessToken: string) => void;
}) {
  const [accessToken, setAccessToken] = useState("");
  return (
    <div className="app thread-hidden rah-product-shell">
      <Rail />
      <aside className="sidebar rah-sidebar-placeholder">
        <header className="sidebar-head">
          <span className="sidebar-title">RAH OS</span>
        </header>
        <div className="sidebar-body">
          <p className="side-hint">Room-first multi-agent workspace</p>
        </div>
      </aside>
      <main className="channel rah-connect-stage">
        <form
          className="rah-connect-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (accessToken.trim().length > 0) onConnect(accessToken.trim());
          }}
        >
          <span className="rah-connect-mark">R</span>
          <h1>连接本机 RAH OS</h1>
          <p>
            浏览器通过同源代理连接 daemon。Human PAT
            只保存在当前页面内存，不写入 Local Storage。
          </p>
          <label>
            Human access token
            <input
              autoComplete="off"
              autoFocus
              onChange={(event) => setAccessToken(event.target.value)}
              type="password"
              value={accessToken}
            />
          </label>
          <button className="btn btn-pink" disabled={accessToken.trim() === ""}>
            进入 Workspace
          </button>
        </form>
      </main>
    </div>
  );
}

function WorkspaceScreen({
  client,
  onDisconnect,
}: {
  client: RahClient;
  onDisconnect: () => void;
}) {
  const [health, setHealth] = useState<ClientHealthResponse>();
  const [currentPrincipal, setCurrentPrincipal] = useState<Principal>();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string>();
  const [roomData, setRoomData] = useState<RoomData>();
  const [activeThreadId, setActiveThreadId] = useState<string>();
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [surface, setSurface] = useState<Surface>("room");
  const [localRuntimes, setLocalRuntimes] = useState<
    LocalRuntimeInventoryEntry[]
  >([]);
  const [agentCatalog, setAgentCatalog] = useState<AgentCatalogEntry[]>([]);
  const [agentCatalogControlRoomId, setAgentCatalogControlRoomId] =
    useState<string>();
  const [workspaceMembershipRole, setWorkspaceMembershipRole] =
    useState<MembershipRole>();
  const [runtimeInventoryError, setRuntimeInventoryError] = useState<string>();
  const [mobileRoomsOpen, setMobileRoomsOpen] = useState(false);
  const [roomCreateOpen, setRoomCreateOpen] = useState(false);
  const [roomMembersOpen, setRoomMembersOpen] = useState(false);
  const [roomAgentSelections, setRoomAgentSelections] = useState<
    Record<string, string[]>
  >({});
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const sessions = useRef(new Map<string, RoomSession>());
  const messageSessions = useRef(new Map<string, MessageSession>());
  const threadMessageSessions = useRef(new Map<string, MessageSession>());
  const consecutivePollFailures = useRef(0);
  const consumerPrefix = useMemo(() => browserConsumerId(), []);
  const activeRoom = rooms.find((room) => room.roomId === activeRoomId);
  const activeWorkspace =
    workspaces.find(
      (workspace) => workspace.workspaceId === activeRoom?.workspaceId,
    ) ?? workspaces[0];
  const scopedAgentCatalog = useMemo(
    () =>
      agentCatalogControlRoomId === activeWorkspace?.controlRoomId
        ? agentCatalog
        : [],
    [activeWorkspace?.controlRoomId, agentCatalog, agentCatalogControlRoomId],
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
        try {
          const runtimeInventory = await client.request(
            "host.runtime.list",
            {},
            { signal: controller.signal },
          );
          setLocalRuntimes(runtimeInventory.runtimes);
          setRuntimeInventoryError(undefined);
        } catch (caught) {
          if (!controller.signal.aborted) {
            setLocalRuntimes([]);
            setRuntimeInventoryError(errorMessage(caught));
          }
        }
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
    const nextSearch = roomSelectionSearch(activeRoomId);
    if (window.location.search !== nextSearch) {
      window.history.replaceState(null, "", nextSearch);
    }
  }, [activeRoomId]);

  useEffect(() => {
    const selectFromHistory = () => {
      const requested = roomSelectionFromSearch(window.location.search);
      if (
        requested !== undefined &&
        rooms.some(({ roomId }) => roomId === requested)
      ) {
        setActiveRoomId(requested);
        setActiveThreadId(undefined);
        setRoomData(undefined);
      }
    };
    window.addEventListener("popstate", selectFromHistory);
    return () => window.removeEventListener("popstate", selectFromHistory);
  }, [rooms]);

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
    setAgentCatalogControlRoomId(undefined);
    void client
      .request("agent.list", { controlRoomId }, { signal: controller.signal })
      .then((catalog) => {
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
  }, [activeWorkspace?.controlRoomId, client, health]);

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
        let session = sessions.current.get(activeRoomId);
        if (session === undefined) {
          session = new RoomSession({
            client,
            consumerId: `${consumerPrefix}-${activeRoomId}`,
            roomId: activeRoomId,
          });
          sessions.current.set(activeRoomId, session);
        }
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
        ] = await Promise.all([
          messageSession === undefined
            ? Promise.resolve({
                complete: true,
                cursorAfter: 0,
                messages: [] as Message[],
                pages: 0,
              })
            : messageSession.syncUntilCurrent({
                limit: 500,
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
          latestRoomSeq: roomCatchUp.state.latestRoomSeq,
          members: [...knownPrincipals.values()],
          memberships: membershipResult.memberships,
          messages: [...messageResult.messages],
          tasks: taskResult.tasks,
          threads: threadResult.threads,
        });
        setActiveThreadId((current) =>
          current !== undefined &&
          threadResult.threads.some(({ threadId }) => threadId === current)
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
  const agentDirectory = workspaceAgentDirectory({
    agents: scopedAgentCatalog,
    runtimes: localRuntimes,
  });
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
  const availableAgentIdSet = new Set(availableAgentIds);
  const selectedAgentIds = (
    activeRoomId === undefined
      ? []
      : (roomAgentSelections[activeRoomId] ?? availableAgentIds)
  ).filter((participantId) => availableAgentIdSet.has(participantId));
  const view = createRoomViewModel({
    members: roomData?.members ?? [],
    messages:
      roomData?.messages.filter((message) => message.threadId === undefined) ??
      [],
    tasks: roomData?.tasks ?? [],
  });
  const activeThread = roomData?.threads.find(
    (thread) => thread.threadId === activeThreadId,
  );
  const activeThreadRoot = view.messages.find(
    (message) => message.messageId === activeThread?.rootMessageId,
  );
  const threadView = createRoomViewModel({
    members: roomData?.members ?? [],
    messages: threadMessages,
    tasks: [],
  });
  const submitComposer = useCallback(
    async (
      body: string,
      asTask: boolean,
      selectedParticipantIds: readonly string[],
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
        const assigneeId = taskAssigneeForSelectedAgents({
          availableAgents: roomAgents,
          selectedParticipantIds,
        });
        await runRoomMutationAtLatest({
          mutate: (basedOnRoomSeq) =>
            client.request("task.create", {
              ...(assigneeId === undefined ? {} : { assigneeId }),
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
              basedOnRoomSeq,
              body,
              idempotencyKey: `web-message-${id}`,
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
      setReload((value) => value + 1);
    },
    [activeRoom, client, health, roomAgents, roomData],
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
        let thread = roomData.threads.find(
          (candidate) => candidate.rootMessageId === rootMessageId,
        );
        if (thread === undefined) {
          if (!roomData.caughtUp) {
            throw new Error("Room 尚未追赶到最新位置，暂不能创建 Thread");
          }
          if (!health.capabilities.threadWrite) {
            throw new Error("daemon 未开放 Thread write capability");
          }
          const session = sessions.current.get(activeRoom.roomId);
          if (session === undefined) {
            throw new Error("当前 Room 尚未建立 canonical session");
          }
          const idempotencyKey = `web-thread-${browserOpaqueId()}`;
          const created = await runRoomMutationAtLatest({
            mutate: (basedOnRoomSeq) =>
              client.request("thread.create", {
                basedOnRoomSeq,
                idempotencyKey,
                recipientIds: availableAgentIds,
                roomId: activeRoom.roomId,
                rootMessageId,
              }),
            session,
          });
          thread = created.thread;
          setRoomData((current) =>
            current === undefined
              ? current
              : {
                  ...current,
                  latestRoomSeq: Math.max(
                    current.latestRoomSeq,
                    created.event.roomSeq,
                  ),
                  threads: [...current.threads, created.thread],
                },
          );
        }
        setThreadMessages([]);
        setActiveThreadId(thread.threadId);
        setError(undefined);
      } catch (caught) {
        setError(errorMessage(caught));
        setReload((value) => value + 1);
      }
    },
    [activeRoom, availableAgentIds, client, health, roomData],
  );

  useEffect(() => {
    if (
      activeRoomId === undefined ||
      activeThreadId === undefined ||
      health === undefined ||
      !health.capabilities.threadRead
    ) {
      setThreadMessages([]);
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
          limit: 500,
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

  const submitThreadReply = useCallback(
    async (body: string) => {
      if (
        activeRoom === undefined ||
        activeThread === undefined ||
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
      const idempotencyKey = `web-thread-reply-${browserOpaqueId()}`;
      await runRoomMutationAtLatest({
        mutate: (basedOnRoomSeq) =>
          client.request("thread.reply", {
            basedOnRoomSeq,
            body,
            idempotencyKey,
            recipientIds: availableAgentIds,
            roomId: activeRoom.roomId,
            threadId: activeThread.threadId,
          }),
        session,
      });
      setReload((value) => value + 1);
    },
    [activeRoom, activeThread, availableAgentIds, client, health, roomData],
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
      setRoomAgentSelections((current) => {
        const existing = current[activeRoom.roomId];
        return existing === undefined
          ? current
          : {
              ...current,
              [activeRoom.roomId]: existing.filter(
                (participantId) => participantId !== binding.participantId,
              ),
            };
      });
      setReload((value) => value + 1);
    },
    [activeRoom, canManageCurrentRoomMembers, client, roomData],
  );

  const createRoom = useCallback(
    async (input: { name: string; slug: string }) => {
      if (!canCreateCurrentWorkspaceRoom) {
        throw new Error("当前 Human 没有在此 Workspace 创建 Room 的权限");
      }
      if (activeWorkspace?.controlRoomId === undefined) {
        throw new Error("当前 Workspace 没有可写 control Room");
      }
      let controlSession = sessions.current.get(activeWorkspace.controlRoomId);
      if (controlSession === undefined) {
        controlSession = new RoomSession({
          client,
          consumerId: `${consumerPrefix}-${activeWorkspace.controlRoomId}`,
          roomId: activeWorkspace.controlRoomId,
        });
        sessions.current.set(activeWorkspace.controlRoomId, controlSession);
      }
      const idempotencyKey = `web-room-create-${browserOpaqueId()}`;
      const result = await runRoomMutationAtLatest({
        mutate: (basedOnControlRoomSeq) =>
          client.request("room.create", {
            basedOnControlRoomSeq,
            idempotencyKey,
            kind: "channel",
            name: input.name,
            slug: input.slug,
            workspaceId: activeWorkspace.workspaceId,
          }),
        session: controlSession,
      });
      setRooms((current) =>
        current.some(({ roomId }) => roomId === result.room.roomId)
          ? current
          : [...current, result.room],
      );
      setActiveThreadId(undefined);
      setThreadMessages([]);
      setRoomData(undefined);
      setActiveRoomId(result.room.roomId);
      setRoomCreateOpen(false);
      setMobileRoomsOpen(false);
      setSurface("room");
      setTab("chat");
    },
    [activeWorkspace, canCreateCurrentWorkspaceRoom, client, consumerPrefix],
  );

  const selectRoomAgents = useCallback(
    (participantIds: readonly string[]) => {
      if (activeRoomId === undefined) return;
      setRoomAgentSelections((current) => ({
        ...current,
        [activeRoomId]: [...participantIds],
      }));
    },
    [activeRoomId],
  );

  return (
    <div
      className={`app rah-product-shell${activeThread === undefined ? " thread-hidden" : ""}`}
    >
      <Rail
        active={surface}
        onTasks={() => {
          setActiveThreadId(undefined);
          setRoomMembersOpen(false);
          setSurface("room");
          setTab("tasks");
        }}
        onSelect={(nextSurface) => {
          setActiveThreadId(undefined);
          setRoomMembersOpen(false);
          setSurface(nextSurface);
        }}
      />
      <RoomSidebar
        activeRoomId={activeRoomId}
        canCreate={
          canCreateCurrentWorkspaceRoom &&
          activeWorkspace?.controlRoomId !== undefined
        }
        mobileOpen={mobileRoomsOpen}
        onClose={() => setMobileRoomsOpen(false)}
        onCreate={() => setRoomCreateOpen(true)}
        rooms={rooms}
        workspace={activeWorkspace}
        onSelect={(roomId) => {
          setActiveThreadId(undefined);
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
      {mobileRoomsOpen ? (
        <button
          aria-label="关闭 Room 列表背景"
          className="rah-mobile-backdrop"
          onClick={() => setMobileRoomsOpen(false)}
        />
      ) : null}
      {surface === "agents" ? (
        <AgentDirectoryPane agents={agentDirectory} />
      ) : surface === "computers" ? (
        <ComputerRuntimePane
          inventoryError={runtimeInventoryError}
          runtimes={localRuntimes}
        />
      ) : (
        <main className="channel">
          <ChannelHeader
            room={activeRoom}
            memberCount={roomData?.activeMemberIds.length ?? 0}
            onManageAgents={() => {
              setActiveThreadId(undefined);
              setRoomMembersOpen(true);
            }}
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
          {tab === "chat" && health?.capabilities.messageRead === false ? (
            <UnavailablePane
              title="Message capability 不可用"
              detail="当前 daemon 没有开放 Message read；Room ledger 不会由 UI fixture 替代。"
            />
          ) : tab === "chat" ? (
            <ChatPane
              agentActivity={roomData?.agentActivity ?? []}
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
              messages={view.messages}
              agents={roomAgents}
              selectedAgentIds={selectedAgentIds}
              onManageAgents={() => setRoomMembersOpen(true)}
              onOpenThread={openThread}
              onSelectedAgentIdsChange={selectRoomAgents}
              roomName={activeRoom?.name}
              onSubmit={submitComposer}
              threads={roomData?.threads ?? []}
            />
          ) : tab === "tasks" && health?.capabilities.taskRead === false ? (
            <UnavailablePane
              title="Task capability 不可用"
              detail="当前 daemon 没有开放 Task read；看板不会显示推测状态。"
            />
          ) : tab === "tasks" ? (
            <TaskPane
              canWrite={health?.capabilities.taskWrite === true}
              caughtUp={roomData?.caughtUp === true}
              columns={view.taskColumns}
              currentPrincipalId={currentPrincipal?.principalId}
              loading={loading}
              onComplete={completeTask}
            />
          ) : (
            <UnavailablePane
              title="Artifact / Review 尚未接入"
              detail="这里保留 Raft 文件页的位置；后端 capability 成立后再映射，不使用 fixture 伪造成功。"
            />
          )}
        </main>
      )}
      {surface !== "room" || activeThread === undefined ? null : (
        <ThreadPane
          canReply={
            health?.capabilities.threadWrite === true &&
            roomData?.caughtUp === true
          }
          loading={threadLoading}
          onClose={() => setActiveThreadId(undefined)}
          onSubmit={submitThreadReply}
          replies={threadView.messages}
          root={activeThreadRoot}
          thread={activeThread}
        />
      )}
      {roomCreateOpen ? (
        <RoomCreateDialog
          onClose={() => setRoomCreateOpen(false)}
          onCreate={createRoom}
          workspace={activeWorkspace}
        />
      ) : null}
      {roomMembersOpen ? (
        <RoomMembersDialog
          canAdd={canOnboardCurrentRoomAgent}
          canRemove={canManageCurrentRoomMembers}
          candidates={roomMemberCandidates}
          members={(roomData?.members ?? []).filter(({ principalId }) =>
            activeMemberIdSet.has(principalId),
          )}
          onAdd={onboardAgent}
          onClose={() => setRoomMembersOpen(false)}
          onRemove={removeAgent}
          room={activeRoom}
        />
      ) : null}
      <MobileNavigation
        activeSurface={surface}
        activeTab={tab}
        onAgents={() => {
          setActiveThreadId(undefined);
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
        onRooms={() => setMobileRoomsOpen((open) => !open)}
        onTasks={() => {
          setMobileRoomsOpen(false);
          setRoomMembersOpen(false);
          setSurface("room");
          setTab("tasks");
        }}
        roomsOpen={mobileRoomsOpen}
      />
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "RAH OS request failed";
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
