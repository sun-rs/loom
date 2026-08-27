import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  ensureRoomMembership,
  ensureRoomMembershipRemoved,
  loadOrCreateConsumerId,
  MessageSession,
  RoomSession,
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
import raftIconsUrl from "@rah-os/ui-tokens/icons.svg?url";
import {
  activeMobileNavigation,
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
  roomSlugFromName,
  selectProductRooms,
  taskAssigneeForSelectedAgents,
  workspaceAgentDirectory,
  type RoomAgentTarget,
  type WorkspaceAgentView,
} from "@rah-os/ui-web";

import { useDialogProtocol } from "./dialog-protocol.ts";

type AppProps = { client?: RahClient };
declare const __RAH_DEV_PROXY_AUTH__: boolean;
type Tab = "chat" | "files" | "tasks";
type Surface = "agents" | "computers" | "room";
type AgentMembershipIdentity = Pick<
  WorkspaceAgentView,
  "agentDefinitionId" | "handle" | "participantId"
>;
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
      if (asTask) {
        if (!health.capabilities.taskWrite) {
          throw new Error("daemon 未开放 Task write capability");
        }
        const assigneeId = taskAssigneeForSelectedAgents({
          availableAgents: roomAgents,
          selectedParticipantIds,
        });
        await client.request("task.create", {
          ...(assigneeId === undefined ? {} : { assigneeId }),
          basedOnRoomSeq: roomData.latestRoomSeq,
          dependencyTaskIds: [],
          idempotencyKey: `web-task-${id}`,
          roomId: activeRoom.roomId,
          title: body,
        });
      } else {
        if (!health.capabilities.messageWrite) {
          throw new Error("daemon 未开放 Message write capability");
        }
        await client.request("message.post", {
          basedOnRoomSeq: roomData.latestRoomSeq,
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
          const created = await client.request("thread.create", {
            basedOnRoomSeq: roomData.latestRoomSeq,
            idempotencyKey: `web-thread-${browserOpaqueId()}`,
            recipientIds: availableAgentIds,
            roomId: activeRoom.roomId,
            rootMessageId,
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
      await client.request("thread.reply", {
        basedOnRoomSeq: roomData.latestRoomSeq,
        body,
        idempotencyKey: `web-thread-reply-${browserOpaqueId()}`,
        recipientIds: availableAgentIds,
        roomId: activeRoom.roomId,
        threadId: activeThread.threadId,
      });
      setReload((value) => value + 1);
    },
    [activeRoom, activeThread, availableAgentIds, client, health, roomData],
  );

  const completeTask = useCallback(
    async (task: Task) => {
      if (roomData === undefined || health === undefined) return;
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
      await client.request("task.complete", {
        basedOnRoomSeq: roomData.latestRoomSeq,
        idempotencyKey: `web-task-complete-${browserOpaqueId()}`,
        taskId: task.taskId,
      });
      setReload((value) => value + 1);
    },
    [client, currentPrincipal?.principalId, health, roomData],
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
      const result = await ensureRoomMembership(client, {
        agentDefinitionId: binding.agentDefinitionId,
        basedOnRoomSeq: roomData.latestRoomSeq,
        idempotencyKey: `web-agent-onboard-${browserOpaqueId()}`,
        participantId: binding.participantId,
        roomId: activeRoom.roomId,
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
      const result = await ensureRoomMembershipRemoved(client, {
        basedOnRoomSeq: roomData.latestRoomSeq,
        idempotencyKey: `web-agent-remove-${browserOpaqueId()}`,
        participantId: binding.participantId,
        roomId: activeRoom.roomId,
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
      const control = await controlSession.syncUntilCurrent({
        limit: 500,
        maxPages: 4,
      });
      if (!control.caughtUp) {
        throw new Error("Workspace control Room 尚未追赶到最新位置");
      }
      const result = await client.request("room.create", {
        basedOnControlRoomSeq: control.state.latestRoomSeq,
        idempotencyKey: `web-room-create-${browserOpaqueId()}`,
        kind: "channel",
        name: input.name,
        slug: input.slug,
        workspaceId: activeWorkspace.workspaceId,
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

function AgentDirectoryPane({
  agents,
}: {
  agents: readonly WorkspaceAgentView[];
}) {
  return (
    <main className="channel rah-agent-runtime-page">
      <header className="channel-head">
        <div className="channel-id">
          <span className="channel-badge">
            <Icon name="members" />
          </span>
          <div className="channel-title">
            <h1>Agent 与成员</h1>
            <p className="channel-sub">
              {agents.length} 个 Workspace Agent 长期身份
            </p>
          </div>
        </div>
        <div className="head-actions">
          <button
            className="btn btn-pink"
            disabled
            title="AgentDefinition 创建 API 尚未开放"
          >
            创建 Agent
          </button>
        </div>
      </header>
      <section className="rah-runtime-summary">
        <strong>Agent 是长期身份</strong>
        <span>
          这里管理 Workspace Agent；加入或移出某个 Room，请从该 Room
          标题栏的成员面板操作。Runtime 与本机 CLI 位于“计算机”。
        </span>
      </section>
      <section className="rah-runtime-grid rah-scroll-main">
        {agents.length === 0 ? (
          <p className="rah-empty-copy">
            当前没有可见 AgentDefinition；创建能力尚未开放，不会用 Runtime
            探测结果伪造 Agent。
          </p>
        ) : null}
        {agents.map((agent) => (
          <article className="rah-runtime-card" key={agent.agentDefinitionId}>
            <header>
              <span className="rah-runtime-icon">
                {agent.handle.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <h2>{agent.handle}</h2>
                <p>{agent.role}</p>
              </div>
              <span
                className={`rah-runtime-state ${agent.state === "enabled" ? "is-online" : "is-offline"}`}
              >
                {agent.state === "enabled" ? "已启用" : agent.state}
              </span>
            </header>
            <dl>
              <div>
                <dt>Identity</dt>
                <dd>{agent.participantId}</dd>
              </div>
              <div>
                <dt>Definition</dt>
                <dd>{agent.agentDefinitionId}</dd>
              </div>
              <div>
                <dt>Runtime</dt>
                <dd>
                  {agent.runtimeLabels.length === 0
                    ? "未绑定"
                    : agent.runtimeLabels.join(", ")}
                </dd>
              </div>
            </dl>
            <p className="rah-runtime-note">
              {agent.runtimeAvailable
                ? "至少一个已绑定 Runtime 当前可运行。"
                : "当前没有已验证且可用的 Runtime。"}
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}

function ComputerRuntimePane({
  inventoryError,
  runtimes,
}: {
  inventoryError: string | undefined;
  runtimes: readonly LocalRuntimeInventoryEntry[];
}) {
  const configuredCount = runtimes.filter(
    ({ available, configured }) => available && configured,
  ).length;
  return (
    <main className="channel rah-agent-runtime-page">
      <header className="channel-head">
        <div className="channel-id">
          <span className="channel-badge">
            <Icon name="monitor" />
          </span>
          <div className="channel-title">
            <h1>计算机与 Runtime</h1>
            <p className="channel-sub">{configuredCount} 个运行插槽可用</p>
          </div>
        </div>
      </header>
      <section className="rah-runtime-summary">
        <strong>Agent 身份与 CLI 解耦</strong>
        <span>
          daemon 负责探测本机 CLI 并发布 Runtime/Offer 证据。这里不修改任何 Room
          成员；安装或修改 CLI 后需要重启 daemon 才会重新扫描。
        </span>
      </section>
      {inventoryError === undefined ? null : (
        <div className="rah-inline-error">
          本机 Runtime 管理 API 不可用：{inventoryError}
        </div>
      )}
      <section className="rah-runtime-grid rah-scroll-main">
        {runtimes.length === 0 && inventoryError === undefined ? (
          <p className="rah-empty-copy">没有发现本机 Agent CLI。</p>
        ) : null}
        {runtimes.map((runtime, runtimeIndex) => (
          <article
            className="rah-runtime-card"
            key={`${runtime.runtimeProfileId ?? runtime.executable}-${String(runtimeIndex)}`}
          >
            <header>
              <span className="rah-runtime-icon">
                {runtime.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <h2>{runtime.displayName}</h2>
                <p>{runtime.version ?? runtime.executable}</p>
              </div>
              <span
                className={`rah-runtime-state ${runtime.available ? "is-online" : "is-offline"}`}
              >
                {runtime.available
                  ? runtime.configured
                    ? "可运行"
                    : "已安装 / 未启用"
                  : "未发现"}
              </span>
            </header>
            <dl>
              <div>
                <dt>Executable</dt>
                <dd>{runtime.resolvedExecutablePath ?? runtime.executable}</dd>
              </div>
              <div>
                <dt>Runtime Profile</dt>
                <dd>{runtime.runtimeProfileId ?? "未配置"}</dd>
              </div>
              <div>
                <dt>Offer</dt>
                <dd>{runtime.runtimeOfferId ?? "未发布"}</dd>
              </div>
            </dl>
            {runtime.agentBindings.length === 0 ? (
              <p className="rah-runtime-note">
                {runtime.configured
                  ? "该 Runtime 尚未绑定 AgentDefinition。"
                  : "本次 daemon 启动时未启用；重启并纳入本机配置后才能加入 Room。"}
              </p>
            ) : (
              <div className="rah-agent-bindings">
                {runtime.agentBindings.map((binding) => (
                  <div
                    className="rah-agent-binding"
                    key={binding.agentDefinitionId}
                  >
                    <div>
                      <b>{binding.handle}</b>
                      <span>{binding.agentDefinitionId}</span>
                    </div>
                    <span className="rah-runtime-binding-label">已绑定</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}

function RoomCreateDialog({
  onClose,
  onCreate,
  workspace,
}: {
  onClose: () => void;
  onCreate: (input: { name: string; slug: string }) => Promise<void>;
  workspace: Workspace | undefined;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const valid = name.trim().length > 0 && slug.trim().length > 0;
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭新建频道窗口"
        className="rah-dialog-backdrop"
        disabled={pending}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-room-create-title"
        aria-modal="true"
        className="rah-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="rah-room-create-title">新建频道</h2>
            <p>{workspace?.name ?? "Workspace"}</p>
          </div>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={pending}
            onClick={onClose}
          >
            <span className="rah-close-glyph" aria-hidden="true">
              ×
            </span>
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            setPending(true);
            void onCreate({ name: name.trim(), slug: slug.trim() })
              .then(() => setActionError(undefined))
              .catch((caught) => setActionError(errorMessage(caught)))
              .finally(() => setPending(false));
          }}
        >
          <label>
            频道名称
            <input
              autoFocus
              onChange={(event) => {
                const nextName = event.target.value;
                setName(nextName);
                if (!slugEdited) setSlug(roomSlugFromName(nextName));
              }}
              placeholder="Agent Council"
              value={name}
            />
          </label>
          <label>
            Slug
            <input
              onChange={(event) => {
                setSlugEdited(true);
                setSlug(roomSlugFromName(event.target.value));
              }}
              placeholder="agent-council"
              value={slug}
            />
          </label>
          {actionError === undefined ? null : (
            <p className="rah-dialog-error">{actionError}</p>
          )}
          <footer>
            <button
              className="btn"
              disabled={pending}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button className="btn btn-pink" disabled={pending || !valid}>
              {pending ? "正在创建…" : "创建频道"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function RoomMembersDialog({
  canAdd,
  canRemove,
  candidates,
  members,
  onAdd,
  onClose,
  onRemove,
  room,
}: {
  canAdd: boolean;
  canRemove: boolean;
  candidates: readonly ReturnType<typeof roomAgentCandidates>[number][];
  members: readonly Principal[];
  onAdd: (agent: AgentMembershipIdentity) => Promise<void>;
  onClose: () => void;
  onRemove: (agent: AgentMembershipIdentity) => Promise<void>;
  room: Room | undefined;
}) {
  const [pendingAgentId, setPendingAgentId] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const dialogRef = useDialogProtocol({
    blocked: pendingAgentId !== undefined,
    onClose,
  });
  const humans = members.filter(({ kind }) => kind === "human");
  const joinedAgents = candidates.filter(({ joined }) => joined);
  const availableAgents = candidates.filter(({ joined }) => !joined);
  const mutate = (agent: AgentMembershipIdentity, joined: boolean) => {
    setPendingAgentId(agent.participantId);
    void (joined ? onRemove(agent) : onAdd(agent))
      .then(() => setActionError(undefined))
      .catch((caught) => setActionError(errorMessage(caught)))
      .finally(() => setPendingAgentId(undefined));
  };
  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭 Room 成员窗口"
        className="rah-dialog-backdrop"
        disabled={pendingAgentId !== undefined}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-room-members-title"
        aria-modal="true"
        className="rah-dialog rah-members-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="rah-room-members-title">#{room?.name ?? "Room"} 成员</h2>
            <p>
              {humans.length + joinedAgents.length} 位成员 · membership
              决定消息投递
            </p>
          </div>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={pendingAgentId !== undefined}
            onClick={onClose}
          >
            <span className="rah-close-glyph" aria-hidden="true">
              ×
            </span>
          </button>
        </header>
        {actionError === undefined ? null : (
          <p className="rah-dialog-error">{actionError}</p>
        )}
        <div className="rah-members-scroll">
          <h3>当前 Human</h3>
          {humans.length === 0 ? (
            <p className="rah-members-empty">没有可见 Human。</p>
          ) : (
            humans.map((member) => (
              <div className="rah-member-row" key={member.principalId}>
                <span className="rah-runtime-icon">
                  {member.handle.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <b>{member.handle}</b>
                  <span>Human · {member.principalId}</span>
                </div>
                <span className="rah-runtime-state is-online">成员</span>
              </div>
            ))
          )}
          <h3>当前 Agents</h3>
          {joinedAgents.length === 0 ? (
            <p className="rah-members-empty">当前 Room 尚未添加 Agent。</p>
          ) : (
            joinedAgents.map((agent) => (
              <RoomAgentMembershipRow
                agent={agent}
                canManage={canRemove}
                joined
                key={agent.participantId}
                onMutate={mutate}
                pending={pendingAgentId === agent.participantId}
              />
            ))
          )}
          <h3>添加 Workspace Agent</h3>
          {availableAgents.length === 0 ? (
            <p className="rah-members-empty">没有其他可添加的 Agent。</p>
          ) : (
            availableAgents.map((agent) => (
              <RoomAgentMembershipRow
                agent={agent}
                canManage={canAdd && agent.state === "enabled"}
                joined={false}
                key={agent.participantId}
                onMutate={mutate}
                pending={pendingAgentId === agent.participantId}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function RoomAgentMembershipRow({
  agent,
  canManage,
  joined,
  onMutate,
  pending,
}: {
  agent: ReturnType<typeof roomAgentCandidates>[number];
  canManage: boolean;
  joined: boolean;
  onMutate: (agent: AgentMembershipIdentity, joined: boolean) => void;
  pending: boolean;
}) {
  return (
    <div className="rah-member-row">
      <span className="rah-runtime-icon">
        {agent.handle.slice(0, 1).toUpperCase()}
      </span>
      <div>
        <b>{agent.handle}</b>
        <span>
          {agent.role} ·{" "}
          {agent.runtimeAvailable ? "Runtime 可用" : "Runtime 不可用"}
        </span>
      </div>
      <button
        className={joined ? "btn" : "btn btn-pink"}
        disabled={!canManage || pending}
        onClick={() => onMutate(agent, joined)}
      >
        {pending ? "处理中…" : joined ? "移出 Room" : "加入 Room"}
      </button>
    </div>
  );
}

function Rail({
  active = "room",
  onSelect,
  onTasks,
}: {
  active?: Surface;
  onSelect?: (surface: Surface) => void;
  onTasks?: () => void;
}) {
  return (
    <nav className="rail" aria-label="主导航">
      <div className="rail-head">
        <span className="rail-logo">R</span>
      </div>
      <div className="rail-primary">
        <RailButton disabled icon="search" label="搜索（待接入）" />
        <RailButton
          active={active === "room"}
          icon="chat"
          label="聊天"
          onClick={() => onSelect?.("room")}
        />
        <RailButton disabled icon="pulse" label="动态（待 Inbox）" />
        <RailButton
          icon="task"
          label="任务"
          {...(onTasks === undefined ? {} : { onClick: onTasks })}
        />
        <RailButton
          active={active === "agents"}
          icon="members"
          label="Agent 与成员"
          onClick={() => onSelect?.("agents")}
        />
        <RailButton
          active={active === "computers"}
          icon="monitor"
          label="计算机"
          onClick={() => onSelect?.("computers")}
        />
      </div>
      <div className="rail-footer-item">
        <RailButton disabled icon="bell" label="通知（待接入）" />
      </div>
      <div className="rail-footer-item">
        <RailButton disabled icon="gear" label="设置（待接入）" />
      </div>
    </nav>
  );
}

function RailButton({
  active = false,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      className={`rail-btn${active ? " is-active" : ""}`}
      disabled={disabled || onClick === undefined}
      onClick={onClick}
      title={label}
    >
      <Icon name={icon} />
    </button>
  );
}

function RoomSidebar({
  activeRoomId,
  canCreate,
  mobileOpen,
  onClose,
  onCreate,
  onSelect,
  rooms,
  workspace,
}: {
  activeRoomId: string | undefined;
  canCreate: boolean;
  mobileOpen: boolean;
  onClose: () => void;
  onCreate: () => void;
  onSelect: (roomId: string) => void;
  rooms: Room[];
  workspace: Workspace | undefined;
}) {
  return (
    <aside
      aria-label="Room 列表"
      className={`sidebar rah-room-sidebar${mobileOpen ? " is-open" : ""}`}
    >
      <header className="sidebar-head">
        <span className="sidebar-title">聊天</span>
        <button
          aria-label="关闭 Room 列表"
          className="sq-btn rah-mobile-only"
          onClick={onClose}
        >
          <span className="rah-close-glyph" aria-hidden="true">
            ×
          </span>
        </button>
      </header>
      <div className="sidebar-body">
        <section className="side-section">
          <button className="sidebar-bookmarks" disabled title="收藏尚未接入">
            <Icon name="bookmark" />
            <span>已收藏</span>
          </button>
        </section>
        <section className="side-section">
          <div className="side-title">
            <Icon name="chevron" />
            <span>Workspace</span>
            <span className="count">{rooms.length}</span>
          </div>
          <p className="side-hint">
            {workspace?.name ?? "没有可访问的 Workspace"}
          </p>
        </section>
        <section className="side-section">
          <div className="side-title">
            <Icon name="chevron" />
            <span>频道</span>
            <span className="count">{rooms.length}</span>
            <button
              aria-label="新建频道"
              className="rah-side-create"
              disabled={!canCreate}
              onClick={onCreate}
              title={canCreate ? "新建频道" : "当前 Workspace 不允许创建频道"}
            >
              +
            </button>
          </div>
          {rooms.map((room) => (
            <button
              key={room.roomId}
              className={`channel-row${room.roomId === activeRoomId ? " is-selected" : ""}`}
              onClick={() => onSelect(room.roomId)}
            >
              <span className="hash">#</span>
              {room.name}
            </button>
          ))}
        </section>
      </div>
    </aside>
  );
}

function ChannelHeader({
  memberCount,
  onManageAgents,
  onOpenRooms,
  room,
}: {
  memberCount: number;
  onManageAgents: () => void;
  onOpenRooms: () => void;
  room: Room | undefined;
}) {
  return (
    <header className="channel-head">
      <button
        aria-label="打开 Room 列表"
        className="sq-btn rah-mobile-only"
        onClick={onOpenRooms}
      >
        <Icon name="menu" />
      </button>
      <div className="channel-id">
        <span className="channel-badge">
          <Icon name="hash" />
        </span>
        <div className="channel-title">
          <h1>{room?.name ?? "选择一个 Room"}</h1>
          <p className="channel-sub">RAH OS canonical Room</p>
        </div>
      </div>
      <div className="head-actions">
        <button className="sq-btn" disabled title="搜索尚未接入">
          <Icon name="search" />
        </button>
        <button
          className="sq-btn members"
          onClick={onManageAgents}
          title="查看和设置当前 Room 成员"
        >
          <Icon name="members" />
          <b>{memberCount}</b>
        </button>
      </div>
    </header>
  );
}

function MobileNavigation({
  activeSurface,
  activeTab,
  onAgents,
  onChat,
  onRooms,
  onTasks,
  roomsOpen,
}: {
  activeSurface: Surface;
  activeTab: Tab;
  onAgents: () => void;
  onChat: () => void;
  onRooms: () => void;
  onTasks: () => void;
  roomsOpen: boolean;
}) {
  const activeDestination = activeMobileNavigation({
    activeSurface,
    activeTab,
    roomsOpen,
  });
  return (
    <nav className="rah-mobile-nav" aria-label="移动端主导航">
      <MobileNavigationButton
        active={activeDestination === "rooms"}
        icon="menu"
        label="Rooms"
        onClick={onRooms}
      />
      <MobileNavigationButton
        active={activeDestination === "chat"}
        icon="chat"
        label="聊天"
        onClick={onChat}
      />
      <MobileNavigationButton
        active={activeDestination === "tasks"}
        icon="task"
        label="任务"
        onClick={onTasks}
      />
      <MobileNavigationButton
        active={activeDestination === "agents"}
        icon="members"
        label="Agents"
        onClick={onAgents}
      />
    </nav>
  );
}

function MobileNavigationButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "is-active" : undefined}
      onClick={onClick}
      type="button"
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}

function TabButton({
  active,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`tab${active ? " is-active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      role="tab"
      aria-selected={active}
    >
      <Icon name={icon} />
      {label}
    </button>
  );
}

function ChatPane({
  agentActivity,
  agents,
  canCreateTask,
  canPost,
  canReadThreads,
  canWriteThreads,
  loading,
  messages,
  onManageAgents,
  onOpenThread,
  onSelectedAgentIdsChange,
  onSubmit,
  roomName,
  selectedAgentIds,
  threads,
}: {
  agentActivity: readonly RoomAgentActivity[];
  agents: readonly RoomAgentTarget[];
  canCreateTask: boolean;
  canPost: boolean;
  canReadThreads: boolean;
  canWriteThreads: boolean;
  loading: boolean;
  messages: ReturnType<typeof createRoomViewModel>["messages"];
  onManageAgents: () => void;
  onOpenThread: (rootMessageId: string) => Promise<void>;
  onSelectedAgentIdsChange: (participantIds: readonly string[]) => void;
  onSubmit: (
    body: string,
    asTask: boolean,
    selectedParticipantIds: readonly string[],
  ) => Promise<void>;
  roomName: string | undefined;
  selectedAgentIds: readonly string[];
  threads: readonly Thread[];
}) {
  const [body, setBody] = useState("");
  const [asTask, setAsTask] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  let taskTargetIssue: string | undefined;
  if (asTask) {
    try {
      taskAssigneeForSelectedAgents({
        availableAgents: agents,
        selectedParticipantIds: selectedAgentIds,
      });
    } catch (caught) {
      taskTargetIssue = errorMessage(caught);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = body.trim();
    if (value === "" || pending) return;
    setPending(true);
    try {
      await onSubmit(value, asTask, selectedAgentIds);
      setBody("");
      setSubmitError(undefined);
    } catch (caught) {
      setSubmitError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="chan-pane">
      <section className="messages rah-scroll-main">
        {loading && messages.length === 0 ? (
          <p className="rah-empty-copy">正在同步 Room…</p>
        ) : null}
        {!loading && messages.length === 0 ? (
          <p className="rah-empty-copy">这个 Room 还没有消息。</p>
        ) : null}
        {messages.map((message) => {
          const thread = threads.find(
            ({ rootMessageId }) => rootMessageId === message.messageId,
          );
          return (
            <MessageArticle
              key={message.messageId}
              message={message}
              {...(canReadThreads && (thread !== undefined || canWriteThreads)
                ? {
                    threadAction: {
                      label:
                        thread === undefined
                          ? "开始 Thread"
                          : `${String(thread.replyCount)} 条回复`,
                      onClick: () => void onOpenThread(message.messageId),
                    },
                  }
                : {})}
            />
          );
        })}
      </section>
      {asTask ? (
        <AgentTargetSelector
          agents={agents}
          asTask={asTask}
          onChange={onSelectedAgentIdsChange}
          onManageAgents={onManageAgents}
          selectedAgentIds={selectedAgentIds}
          taskTargetIssue={taskTargetIssue}
        />
      ) : (
        <RoomAgentDeliverySummary
          activity={agentActivity}
          agents={agents}
          body={body}
          onManageAgents={onManageAgents}
        />
      )}
      {submitError === undefined ? null : (
        <div className="rah-inline-error">{submitError}</div>
      )}
      <form className="composer" onSubmit={submit}>
        <div className="composer-box">
          <textarea
            aria-label="消息输入框"
            disabled={!canPost && !canCreateTask}
            onChange={(event) => setBody(event.target.value)}
            placeholder={`发送消息至 #${roomName ?? "room"}`}
            rows={3}
            value={body}
          />
          <div className="composer-bar">
            <button
              className="sq-btn"
              disabled
              title="附件将在 Artifact slice 接入"
              type="button"
            >
              <Icon name="clip" />
            </button>
            <span className="composer-spacer" />
            {canCreateTask ? (
              <label className="task-check">
                <input
                  checked={asTask}
                  onChange={(event) => setAsTask(event.target.checked)}
                  type="checkbox"
                />
                <span className="box" />
                作为任务
              </label>
            ) : null}
            <button
              className="send-btn"
              disabled={
                body.trim() === "" ||
                pending ||
                taskTargetIssue !== undefined ||
                (asTask ? !canCreateTask : !canPost)
              }
              title="发送"
            >
              <Icon name="send" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function AgentTargetSelector({
  agents,
  asTask,
  onChange,
  onManageAgents,
  selectedAgentIds,
  taskTargetIssue,
}: {
  agents: readonly RoomAgentTarget[];
  asTask: boolean;
  onChange: (participantIds: readonly string[]) => void;
  onManageAgents: () => void;
  selectedAgentIds: readonly string[];
  taskTargetIssue: string | undefined;
}) {
  const selected = new Set(selectedAgentIds);
  let summary = `唤醒 ${String(selected.size)}/${String(agents.length)} 个 Room Agents`;
  if (asTask && selected.size === 1) {
    summary = `指派任务给 ${agents.find(({ participantId }) => selected.has(participantId))?.handle ?? "Agent"}`;
  } else if (asTask && agents.length > 0 && agents.length === selected.size) {
    summary = "开放任务：全部 Room Agents 可竞争认领";
  } else if (asTask && agents.length === 0) {
    summary = "创建未指派任务（当前 Room 无 Agent）";
  } else if (!asTask && selected.size === 0) {
    summary = "仅记录消息，不唤醒 Agent";
  }
  return (
    <section className="rah-agent-targets" aria-label="任务目标 Agents">
      <header>
        <span>
          <Icon name="members" />
          任务负责人
        </span>
        {agents.length === 0 ? (
          <button className="rah-target-link" onClick={onManageAgents}>
            添加本机 Agent
          </button>
        ) : (
          <span className="rah-target-actions">
            <button
              onClick={() =>
                onChange(agents.map(({ participantId }) => participantId))
              }
              type="button"
            >
              全选
            </button>
            <button onClick={() => onChange([])} type="button">
              清空
            </button>
          </span>
        )}
      </header>
      {agents.length === 0 ? (
        <p>当前 Room 尚未设置 Agent；消息会保留，但不会拉起任何 CLI。</p>
      ) : (
        <div className="rah-agent-target-list">
          {agents.map((agent) => (
            <label
              className={selected.has(agent.participantId) ? "is-selected" : ""}
              key={agent.participantId}
            >
              <input
                checked={selected.has(agent.participantId)}
                onChange={() => {
                  const next = new Set(selected);
                  if (next.has(agent.participantId)) {
                    next.delete(agent.participantId);
                  } else {
                    next.add(agent.participantId);
                  }
                  onChange([...next]);
                }}
                type="checkbox"
              />
              <span>{agent.handle}</span>
            </label>
          ))}
        </div>
      )}
      <p className={taskTargetIssue === undefined ? undefined : "is-error"}>
        {taskTargetIssue ?? summary}
      </p>
    </section>
  );
}

function RoomAgentDeliverySummary({
  activity,
  agents,
  body,
  onManageAgents,
}: {
  activity: readonly RoomAgentActivity[];
  agents: readonly RoomAgentTarget[];
  body: string;
  onManageAgents: () => void;
}) {
  const mentioned = new Set(mentionedRoomAgentIds({ agents, body }));
  const stateByParticipantId = new Map(
    activity.map((entry) => [entry.participantId, entry] as const),
  );
  return (
    <section className="rah-agent-targets" aria-label="Room Agent 投递状态">
      <header>
        <span>
          <Icon name="members" />
          Room Agents
        </span>
        <button className="rah-target-link" onClick={onManageAgents}>
          {agents.length === 0 ? "添加 Agent" : "管理"}
        </button>
      </header>
      {agents.length === 0 ? (
        <p>当前 Room 没有 Agent；消息仍会保留，但不会拉起 CLI。</p>
      ) : (
        <div className="rah-agent-target-list">
          {agents.map((agent) => (
            <span
              className={`rah-agent-state-${stateByParticipantId.get(agent.participantId)?.state ?? "idle"}${mentioned.has(agent.participantId) ? " is-selected" : ""}`}
              key={agent.participantId}
              title={stateByParticipantId.get(agent.participantId)?.lastError}
            >
              <i aria-hidden="true" className="rah-agent-state-dot" />
              {agent.handle}
              {` · ${roomAgentStateLabel(
                stateByParticipantId.get(agent.participantId)?.state ?? "idle",
              )}`}
              {mentioned.has(agent.participantId) ? " · mentioned" : ""}
            </span>
          ))}
        </div>
      )}
      <p>
        {agents.length === 0
          ? "Room membership 是消息投递范围"
          : `${String(agents.length)} 个 Room Agent 都会收到消息；@mention 只提高注意力`}
      </p>
    </section>
  );
}

function roomAgentStateLabel(state: RoomAgentActivity["state"]): string {
  switch (state) {
    case "waking":
      return "唤醒中";
    case "working":
      return "工作中";
    case "error":
      return "异常";
    default:
      return "空闲";
  }
}

type MessageView = ReturnType<typeof createRoomViewModel>["messages"][number];

function MessageArticle({
  message,
  threadAction,
}: {
  message: MessageView;
  threadAction?: { label: string; onClick: () => void };
}) {
  return (
    <article className="msg">
      <span className="avatar rah-avatar">
        {message.author.slice(0, 1).toUpperCase()}
      </span>
      <div className="msg-body">
        <header className="msg-head">
          <b>{message.author}</b>
          <time>{formatTime(message.createdAt)}</time>
        </header>
        <p>{message.body}</p>
        {threadAction === undefined ? null : (
          <button className="thread-preview" onClick={threadAction.onClick}>
            <span className="tp-toggle">{threadAction.label}</span>
          </button>
        )}
      </div>
    </article>
  );
}

function ThreadPane({
  canReply,
  loading,
  onClose,
  onSubmit,
  replies,
  root,
  thread,
}: {
  canReply: boolean;
  loading: boolean;
  onClose: () => void;
  onSubmit: (body: string) => Promise<void>;
  replies: ReturnType<typeof createRoomViewModel>["messages"];
  root: MessageView | undefined;
  thread: Thread;
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = body.trim();
    if (value === "" || pending || !canReply) return;
    setPending(true);
    try {
      await onSubmit(value);
      setBody("");
      setSubmitError(undefined);
    } catch (caught) {
      setSubmitError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <aside className="thread" aria-label="Thread 讨论">
      <header className="thread-head">
        <h2>
          Thread <span className="thread-sub">{thread.replyCount} replies</span>
        </h2>
        <button className="sq-btn" onClick={onClose} title="关闭 Thread">
          <span className="rah-close-glyph" aria-hidden="true">
            ×
          </span>
        </button>
      </header>
      <section className="messages rah-scroll-main">
        {root === undefined ? (
          <p className="rah-empty-copy">原消息尚未载入。</p>
        ) : (
          <MessageArticle message={root} />
        )}
        <div className="rah-thread-divider">
          {replies.length === 0
            ? "尚无回复"
            : `${String(replies.length)} 条回复`}
        </div>
        {loading && replies.length === 0 ? (
          <p className="rah-empty-copy">正在同步 Thread…</p>
        ) : null}
        {replies.map((message) => (
          <MessageArticle key={message.messageId} message={message} />
        ))}
      </section>
      {submitError === undefined ? null : (
        <div className="rah-inline-error">{submitError}</div>
      )}
      <form className="composer" onSubmit={submit}>
        <div className="composer-box">
          <textarea
            aria-label="Thread 回复输入框"
            disabled={!canReply}
            onChange={(event) => setBody(event.target.value)}
            placeholder={
              canReply ? "回复 Thread" : "Thread write capability 不可用"
            }
            rows={3}
            value={body}
          />
          <div className="composer-bar">
            <span className="composer-spacer" />
            <button
              className="send-btn"
              disabled={!canReply || body.trim() === "" || pending}
              title="回复"
            >
              <Icon name="send" />
            </button>
          </div>
        </div>
      </form>
    </aside>
  );
}

function TaskPane({
  canWrite,
  caughtUp,
  columns,
  currentPrincipalId,
  loading,
  onComplete,
}: {
  canWrite: boolean;
  caughtUp: boolean;
  columns: ReturnType<typeof createRoomViewModel>["taskColumns"];
  currentPrincipalId: string | undefined;
  loading: boolean;
  onComplete: (task: Task) => Promise<void>;
}) {
  const [pendingTaskId, setPendingTaskId] = useState<string>();
  const [actionError, setActionError] = useState<string>();

  async function complete(task: Task) {
    if (pendingTaskId !== undefined) return;
    setPendingTaskId(task.taskId);
    try {
      await onComplete(task);
      setActionError(undefined);
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setPendingTaskId(undefined);
    }
  }

  return (
    <div className="chan-pane">
      <div className="board-toolbar">
        <span className="rah-toolbar-title">Room Tasks</span>
        <span className="toolbar-spacer" />
        <span className="view-toggle">
          <span className="sq-btn is-active" title="当前为看板视图">
            <Icon name="kanban" />
          </span>
        </span>
      </div>
      {actionError === undefined ? null : (
        <div className="rah-inline-error">{actionError}</div>
      )}
      <div className="kanban">
        {columns.map((column) => (
          <section className="kcol" key={column.id}>
            <header className={`kcol-head chip-${column.tone}`}>
              <span>{column.label}</span>
              <span className="count">{column.tasks.length}</span>
            </header>
            <div className="kcol-body">
              {column.tasks.map((task) => (
                <article className="kcard" key={task.taskId}>
                  <span className="kcard-no">#{task.taskId.slice(-6)}</span>
                  <p className="kcard-title">{task.title}</p>
                  {task.assigneeLabel === undefined ? null : (
                    <p className="rah-task-agent">
                      Agent · {task.assigneeLabel}
                    </p>
                  )}
                  {task.lastProgress === undefined ? null : (
                    <p className="rah-task-evidence">{task.lastProgress}</p>
                  )}
                  {task.submissionSummary === undefined ? null : (
                    <p className="rah-task-evidence">
                      结果：{task.submissionSummary}
                    </p>
                  )}
                  <footer className="kcard-foot">
                    <span className={`chip chip-${column.tone}`}>
                      {task.state}
                    </span>
                    {canHumanCompleteTask({
                      caughtUp,
                      currentPrincipalId,
                      task,
                      taskWrite: canWrite,
                    }) ? (
                      <button
                        className="rah-task-complete"
                        disabled={pendingTaskId !== undefined}
                        onClick={() => void complete(task)}
                      >
                        {pendingTaskId === task.taskId ? "确认中…" : "确认完成"}
                      </button>
                    ) : null}
                  </footer>
                </article>
              ))}
              {!loading && column.tasks.length === 0 ? (
                <div className="kcol-empty">暂无任务</div>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function UnavailablePane({ detail, title }: { detail: string; title: string }) {
  return (
    <div className="chan-pane rah-unavailable">
      <Icon name="doc" />
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

function Icon({ name }: { name: string }) {
  const mappedName =
    {
      chat: "message-square",
      chevron: "chevron-right",
      clip: "paperclip",
      doc: "code-xml",
      gear: "settings",
      kanban: "list-todo",
      listcheck: "list-todo",
      menu: "list-todo",
      members: "users",
      pulse: "activity",
      task: "square-check-big",
    }[name] ?? name;
  return (
    <svg aria-hidden="true">
      <use href={`${raftIconsUrl}#raft-icon-${mappedName}`} />
    </svg>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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
