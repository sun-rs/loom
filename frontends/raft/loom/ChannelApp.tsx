import { showToast } from "../packages/web/src/components/toastBridge.ts";
import SavedPanel from "./SavedPanel.tsx";
import { MessageReactionsProvider } from "./MessageReactions.tsx";
import { SystemNotificationsProvider } from "./SystemNotifications.tsx";
import ChannelTabs from "./ChannelTabs.tsx";
import { useRecordSearchVisit } from "./SearchRecent.tsx";
import { useSearchDestination } from "./useSearchDestination.ts";
import TopBarSearch from "./TopBarSearch.tsx";
import { searchBackground } from "./useSearchPresentation.ts";
import { useLocation, Routes, Route } from "react-router-dom";
import {
  AppearanceRuntimeProvider,
  LoomLiveActivity,
} from "./AppearanceRuntime.tsx";
import { ChannelTasksContext, useChannelTasks } from "./ChannelTasks.tsx";
import TasksPage from "./TasksPage.tsx";
import ThreadContentSlot from "./ThreadContentSlot.tsx";
import ThreadWorkspace from "./ThreadWorkspace.tsx";
import SettingsPage from "./SettingsPage.tsx";
import ChannelControl from "./ChannelControl.tsx";
import InstanceInspector from "./InstanceInspector.tsx";
import { bindMemberRoster } from "./member-roster.ts";
import { notifyChannelMembersChanged } from "../packages/web/src/store/channelMemberEvents.ts";
import ChannelTimeline from "./ChannelTimeline.tsx";
import { useResizablePanel } from "../packages/web/src/hooks/useResizablePanel.ts";
import { SIDEBAR_PANEL_BOUNDS } from "../packages/web/src/lib/panelBounds.ts";
import PanelResizeHandle from "../packages/web/src/components/ui/PanelResizeHandle.tsx";
import DiscoveryPage from "./DiscoveryPage.tsx";
import {
  DesktopNavigation,
  MobileNavigation,
  DestinationPlaceholder,
  type Destination,
} from "./Navigation.tsx";
import AddInstanceDialog from "./AddInstanceDialog.tsx";
import { LoomPrivateBoxClient } from "./private-box.ts";
import ChannelMembers from "./ChannelMembers.tsx";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { useIntentRoute, hasRouteBoundIntent } from "./useIntentRoute.ts";
import {
  AppShellRoot,
  AppShellSidebarSlot,
  AppShellMainSlot,
  ConversationPanelRoot,
  ConversationPanelContent,
  Button,
  Spinner,
} from "raft-ui";
import { Hash, MessageSquare } from "lucide-react";
import { HttpRahClient } from "@rah-os/client-sdk";
import { hasUnresolvedIntents } from "@rah-os/client-core/write-intent";
import { loadOrCreateConsumerId } from "@rah-os/client-core";
import ChannelSidebar from "./ChannelSidebar.tsx";
import ChatSidebarFrame from "./ChatSidebarFrame.tsx";
import AgentPage from "./AgentPage.tsx";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader.tsx";
import MessageInput from "./ComposerFiles.tsx";
import { LoomChannelClient, loadChannelDirectory } from "./channel-client.ts";
import type { Principal, Room } from "@rah-os/protocol";
const client = new HttpRahClient({
  baseUrl: "",
  accessToken: () => "trusted-proxy-auth",
});
function consumer() {
  let storage: Storage | undefined;
  try {
    storage = sessionStorage;
  } catch {
    /* Memory-only identity when storage is unavailable. */
  }
  return loadOrCreateConsumerId({
    storage,
    storageKey: "loom-official-consumer",
    createId: () => `loom-web-${crypto.randomUUID()}`,
  });
}
const consumerId = consumer();

function Channel({
  channel,
  controlRoomId,
  bridge,
  onOpenPrivate,
  onAddInstance,
  onBack,
  threadRootId,
  focusId,
  onThread,
  onProfileVisibilityChange,
}: {
  onProfileVisibilityChange?: (open: boolean) => void;
  threadRootId?: string;
  focusId?: string;
  onThread: (id?: string) => void;
  onBack: () => void;
  onOpenPrivate: (id: string) => void;
  onAddInstance: (() => void) | undefined;
  channel: Room;
  controlRoomId: string | undefined;
  bridge: LoomChannelClient;
}) {
  const isPrivate = channel.instancePrivateBox !== undefined;
  const [panelParams, setPanelParams] = useIntentRoute();
  const taskTab = !isPrivate && panelParams.get("chatTab") === "tasks";
  const profileSnapshot = useRef<Principal | undefined>(undefined);
  const [profileId, setProfileId] = useState<string>();
  const [profileSource, setProfileSource] = useState<"channel" | "thread">(
    "channel",
  );
  const opener = useRef<HTMLElement | null>(null);
  const closeProfile = useCallback(() => {
    if (hasUnresolvedIntents()) return;
    setProfileId(undefined);
    profileSnapshot.current = undefined;
    requestAnimationFrame(() => {
      if (opener.current?.isConnected)
        opener.current.focus({ preventScroll: true });
    });
  }, []);

  const [view, setView] = useState(() => bridge.view());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [writeState, setWriteState] = useState(bridge.writes.state);
  useEffect(() => bridge.writes.onChange(setWriteState), [bridge]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await bridge.refresh(threadRootId ? undefined : focusId);
        if (!disposed) {
          setView(next);
          setError("");
        }
      } catch (failure) {
        if (!disposed) setError(String(failure));
      } finally {
        if (!disposed) {
          setLoading(false);
          timer = setTimeout(poll, document.hidden ? 15000 : 3000);
        }
      }
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [bridge, focusId, threadRootId]);
  useLayoutEffect(() => {
    const release =
      !loading && !error
        ? bindMemberRoster(channel.roomId, () => view.members)
        : undefined;
    notifyChannelMembersChanged(channel.roomId);
    return () => {
      release?.();
    };
  }, [channel.roomId, view.members, loading, error]);
  const currentProfileMember =
    !error && !loading
      ? view.members.find(
          (m) => m.kind === "agent" && m.principalId === profileId,
        )
      : undefined;
  // Keep the write-intent owner mounted through transient conversation failure.
  // This is only the selected identity; diagnostic reads still clear on denial.
  const profileMember =
    currentProfileMember ??
    (hasUnresolvedIntents() ? profileSnapshot.current : undefined);
  useEffect(() => {
    if (profileId && !profileMember) closeProfile();
  }, [profileId, profileMember, closeProfile]);
  useEffect(() => {
    onProfileVisibilityChange?.(!!profileMember);
    return () => onProfileVisibilityChange?.(false);
  }, [!!profileMember, onProfileVisibilityChange]);
  const older = useCallback(async () => {
    try {
      setView(await bridge.older());
    } catch (failure) {
      setError(String(failure));
    }
  }, [bridge]);
  const tasks = useChannelTasks(
    bridge,
    !isPrivate && !loading && !error && !channel.archivedAt,
    () => {
      void bridge
        .refresh()
        .then(setView)
        .catch((failure) => setError(String(failure)));
    },
    (id) => {
      if (!hasUnresolvedIntents()) {
        closeProfile();
        onThread(id);
      }
    },
  );
  const send = useCallback(
    async (
      body: string,
      _mentions?: unknown,
      asTask?: boolean,
      attachmentIds: string[] = [],
    ) => {
      await new Promise<void>((resolve, reject) => {
        // Keep the official composer's submission unresolved while the outcome is
        // unknown. Explicit verification settles this same submission, so it never
        // restores an already committed draft as a new sendable message.
        const deliver = asTask
          ? (
              body: string,
              settled: Parameters<typeof bridge.send>[1],
              _ids: string[],
            ) =>
              tasks.facade.create(
                body,
                settled as Parameters<typeof tasks.facade.create>[1],
              )
          : bridge.send.bind(bridge);
        void deliver(
          body,
          (outcome) => {
            if (outcome.kind === "ok") resolve();
            else if (outcome.kind === "rejected") reject(outcome.error);
          },
          attachmentIds,
        )
          .then((outcome) => {
            if (outcome.kind === "busy")
              reject(new Error("正在处理上一条消息"));
          })
          .catch(reject);
      });
      if (asTask) tasks.changed();
      // Sending success is durable even if the following read is temporarily unavailable.
      void bridge
        .refresh()
        .then(setView)
        .catch((failure) => setError(String(failure)));
    },
    [bridge, tasks.facade],
  );
  const verify = async () => {
    const result = await bridge.writes.retry();
    if (result.kind === "ok") {
      setView(await bridge.refresh());
    } else setError("尚未核实发送结果，请稍后再核实。");
  };
  return (
    <MessageReactionsProvider bridge={bridge} messages={view.messages}>
      <ChannelTasksContext.Provider value={tasks.context}>
        <div className="thread-layout-container relative flex min-h-0 min-w-0 flex-1">
          <ConversationPanelRoot
            edge="attached"
            className="thread-main-column relative border-l-0"
          >
            <PanelHeader
              title={isPrivate ? `私聊 · ${channel.name}` : channel.name}
              subtitle={channel.description}
              onMobileBack={onBack}
              mobileBackProps={{ "aria-label": "聊天列表" }}
              icon={
                isPrivate ? <MessageSquare size={18} /> : <Hash size={18} />
              }
              actions={
                isPrivate ? undefined : (
                  <>
                    <ChannelMembers
                      bridge={bridge}
                      onOpenPrivate={onOpenPrivate}
                      onOpenProfile={
                        loading || error || !controlRoomId
                          ? undefined
                          : (id) => {
                              if (
                                hasUnresolvedIntents() ||
                                error ||
                                !controlRoomId
                              )
                                return;
                              const member = view.members.find(
                                (m) =>
                                  m.kind === "agent" && m.principalId === id,
                              );
                              if (!member) return;
                              opener.current =
                                document.querySelector<HTMLElement>(
                                  '[aria-label="频道成员与状态"]',
                                );
                              profileSnapshot.current = member;
                              setProfileSource("channel");
                              setProfileId(id);
                            }
                      }
                      onAddInstance={
                        channel.archivedAt ? undefined : onAddInstance
                      }
                    />
                    {controlRoomId && !channel.archivedAt && (
                      <ChannelControl
                        bridge={bridge}
                        name={channel.name}
                        workspaceId={channel.workspaceId}
                        controlRoomId={controlRoomId}
                      />
                    )}
                  </>
                )
              }
            />
            {!isPrivate && (
              <ChannelTabs
                value={taskTab ? "tasks" : "chat"}
                onChange={(tab) => {
                  if (hasUnresolvedIntents()) return;
                  setPanelParams(
                    (previous) => {
                      const next = new URLSearchParams(previous);
                      if (tab === "tasks") next.set("chatTab", tab);
                      else next.delete("chatTab");
                      return next;
                    },
                    { replace: true },
                  );
                }}
              />
            )}
            {taskTab && (
              <TasksPage
                client={bridge.client}
                workspaceId={channel.workspaceId}
                rooms={[channel]}
                channelTasks={tasks.facade}
              />
            )}
            <div
              className="flex min-h-0 flex-1 flex-col"
              style={taskTab ? { display: "none" } : undefined}
            >
              <ConversationPanelContent>
                {channel.archivedAt && (
                  <p role="status" className="px-3 py-2 text-sm">
                    频道已归档，历史只读。
                  </p>
                )}
                {isPrivate && (
                  <p className="px-3 py-2 text-xs text-foreground-muted">
                    仅你与此实例可见；沿用实例会话，忙时排队。私聊中写入的记忆属于频道共享记忆。
                  </p>
                )}
                {isPrivate &&
                  view.room?.instancePrivateBox?.active === false && (
                    <p role="status" className="px-3 py-2 text-sm">
                      此私聊已停用，历史只读。
                    </p>
                  )}
                {error && (
                  <div role="alert" className="m-3 text-sm">
                    {error}
                  </div>
                )}
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  {loading ? (
                    <div
                      className="flex-1 flex items-center justify-center py-4"
                      role="status"
                      aria-label="正在读取频道"
                    >
                      <div className="text-center text-foreground-muted font-mono text-sm">
                        加载中…
                      </div>
                    </div>
                  ) : view.messages.length === 0 ? (
                    <p className="p-6 text-sm">
                      {isPrivate ? "还没有私聊消息" : "频道还没有消息"}
                    </p>
                  ) : (
                    <ChannelTimeline
                      key={focusId ?? "latest"}
                      focusId={threadRootId ? undefined : focusId}
                      hasNewer={view.hasNewer}
                      loadNewer={async () => {
                        setView(await bridge.newer());
                      }}
                      roomId={channel.roomId}
                      messages={view.messages}
                      members={error ? [] : view.members}
                      threads={view.threads}
                      onOpenThread={
                        isPrivate || error
                          ? undefined
                          : (id) => {
                              if (hasUnresolvedIntents()) return;
                              closeProfile();
                              onThread(id);
                            }
                      }
                      hasOlder={view.hasOlder}
                      loading={loading}
                      loadOlder={older}
                      onOpenProfile={(type, id) => {
                        if (
                          type === "agent" &&
                          controlRoomId &&
                          !error &&
                          view.members.some(
                            (m) => m.kind === "agent" && m.principalId === id,
                          )
                        ) {
                          opener.current =
                            document.activeElement instanceof HTMLElement
                              ? document.activeElement
                              : null;
                          profileSnapshot.current = view.members.find(
                            (m) => m.principalId === id,
                          );
                          setProfileSource("channel");
                          setProfileId(id);
                        }
                      }}
                    />
                  )}
                </div>
              </ConversationPanelContent>
              {tasks.error && (
                <div role="alert" className="p-3 text-sm">
                  {tasks.error}
                </div>
              )}
              {writeState === "unknown" && (
                <div role="alert" className="p-3 text-sm">
                  {bridge.writes.current?.action === "message-reaction"
                    ? "表情结果未知，核实前暂停操作。"
                    : "发送结果未知，核实前已暂停发送。"}
                  <Button
                    onClick={() =>
                      void verify().catch((failure) =>
                        setError(String(failure)),
                      )
                    }
                  >
                    {bridge.writes.current?.action === "message-reaction"
                      ? "核实表情结果"
                      : bridge.writes.current?.action === "message-save"
                        ? "核实收藏结果"
                        : "核实发送"}
                  </Button>
                </div>
              )}
              {/* Official full-chat shell; compact input suppresses unavailable uploads only. */}
              <div
                data-testid="chat-composer-shell"
                className="relative flex min-w-0 w-full items-center border-t border-line-muted bg-layer-panel px-3 pt-3 safe-bottom theme-brutal:border-t-2 theme-brutal:border-black theme-brutal:bg-white"
              >
                <MessageInput
                  client={client}
                  roomId={channel.roomId}
                  channelId={channel.roomId}
                  channelName={channel.name}
                  variant="compact"
                  loadMentionMembers={!loading}
                  mentionScopeChannelType="private"
                  showTaskButton={!isPrivate && !channel.archivedAt}
                  onSendOverride={send}
                  submitDisabled={
                    loading ||
                    Boolean(error) ||
                    Boolean(channel.archivedAt) ||
                    writeState !== "idle" ||
                    (isPrivate &&
                      view.room?.instancePrivateBox?.active !== true)
                  }
                  submitDisabledReason={
                    isPrivate && view.room?.instancePrivateBox?.active === false
                      ? "此私聊已停用"
                      : undefined
                  }
                  placeholder={
                    isPrivate
                      ? `私聊 ${channel.name}`
                      : `发送到 #${channel.name}`
                  }
                />
              </div>
            </div>
          </ConversationPanelRoot>
          {!isPrivate && threadRootId && (
            <ThreadWorkspace
              key={`${threadRootId}:${focusId ?? "latest"}`}
              client={bridge.client}
              room={channel}
              rootMessageId={threadRootId}
              covered={!!profileMember}
              onOpenProfile={(member) => {
                if (hasUnresolvedIntents()) return;
                opener.current =
                  document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null;
                profileSnapshot.current = member;
                setProfileSource("thread");
                setProfileId(member.principalId);
              }}
              focusId={focusId}
              onClose={() => onThread(undefined)}
              onChanged={() => {
                void bridge
                  .refresh()
                  .then(setView)
                  .catch((failure) => setError(String(failure)));
              }}
            />
          )}
          {profileMember && controlRoomId && (
            <div
              className="thread-profile-side-column contents"
              data-collapse-channel={
                profileSource === "thread" ? "true" : "false"
              }
              data-collapse-thread={
                threadRootId && profileSource === "channel" ? "true" : "false"
              }
            >
              <InstanceInspector
                key={`${channel.roomId}:${profileMember.principalId}`}
                client={bridge.client}
                controlRoomId={controlRoomId}
                room={channel}
                member={profileMember}
                onClose={closeProfile}
              />
            </div>
          )}
          {tasks.detail}
        </div>
      </ChannelTasksContext.Provider>
    </MessageReactionsProvider>
  );
}

export default function ChannelApp() {
  const [sidebarReady, setSidebarReady] = useState(false);
  const onSidebarReady = useCallback(() => setSidebarReady(true), []);
  const sidebarPanel = useResizablePanel({
    storageKey: "loom:chatSidebarWidth",
    ...SIDEBAR_PANEL_BOUNDS,
  });
  const [directory, setDirectory] =
    useState<Awaited<ReturnType<typeof loadChannelDirectory>>>();
  const [error, setError] = useState("");
  const [routeParams, setParams] = useIntentRoute();
  const location = useLocation();
  const background = searchBackground(location.search, location.state);
  const params = useMemo(
    () => (background !== null ? new URLSearchParams(background) : routeParams),
    [background, routeParams],
  );
  const destination = params.get("view") ?? "channels";
  const activityNavigation = useRef(0);
  const [discoveryProfileOpen, setDiscoveryProfileOpen] = useState(false);
  const selectDestination = (id: Destination) => {
    if (hasRouteBoundIntent()) return;
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (id === "channels") {
        next.delete("view");
        if (window.matchMedia("(max-width: 767.98px)").matches)
          next.set("chat", "list");
      } else next.set("view", id);
      return next;
    });
  };
  const [bridges] = useState(() => new Map<string, LoomChannelClient>());
  useEffect(
    () => () => {
      for (const bridge of bridges.values()) bridge.writes.discard();
    },
    [bridges],
  );
  useEffect(() => {
    let disposed = false;
    void loadChannelDirectory(client)
      .then((value) => {
        if (!disposed) setDirectory(value);
      })
      .catch((failure) => {
        if (!disposed) setError(String(failure));
      });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (hasUnresolvedIntents()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const boxes = useMemo(
    () =>
      directory?.workspace.controlRoomId
        ? new LoomPrivateBoxClient(
            client,
            directory.workspace.workspaceId,
            directory.workspace.controlRoomId,
            consumerId,
          )
        : undefined,
    [directory?.workspace.workspaceId, directory?.workspace.controlRoomId],
  );
  const openSearchEntity = useSearchDestination(
    client,
    boxes,
    setDirectory,
    setParams,
  );
  const [instanceTarget, setInstanceTarget] = useState<{
    bridge: LoomChannelClient;
    name: string;
  }>();
  const [boxState, setBoxState] = useState("idle");
  const [boxError, setBoxError] = useState("");
  useEffect(() => {
    if (!boxes) return;
    const stop = boxes.writes.onChange(setBoxState);
    return () => {
      stop();
      boxes.writes.discard();
    };
  }, [boxes]);
  const openPrivate = (id: string) => {
    if (!boxes || hasUnresolvedIntents()) return;
    setBoxError("");
    void boxes
      .open(id, (outcome) => {
        if (outcome.kind === "ok") {
          const room = outcome.result.room;
          setDirectory((previous) =>
            previous
              ? {
                  ...previous,
                  privateBoxes: [
                    ...previous.privateBoxes.filter(
                      (item) => item.roomId !== room.roomId,
                    ),
                    room,
                  ],
                }
              : previous,
          );
          setParams({ room: room.roomId });
          setBoxError("");
        } else if (outcome.kind === "rejected")
          setBoxError("打开私聊被拒绝，请刷新成员列表后重试。");
      })
      .catch(() => setBoxError("无法打开私聊"));
  };
  const requested = params.get("room");
  // Presentation route only: retain the selected room and its mounted composer
  // when popping to the mobile list. No delivery/read/write state lives here.
  const savedOpen = params.get("saved") === "1";
  const mobileList =
    !savedOpen && (!requested || params.get("chat") === "list");
  const showChatList = () =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("chat", "list");
      next.delete("saved");
      return next;
    });
  const selected =
    [
      ...(directory?.channels ?? []),
      ...(directory?.archivedChannels ?? []),
      ...(directory?.privateBoxes ?? []),
    ].find((room) => room.roomId === requested) ??
    (!requested && params.get("chat") !== "list"
      ? directory?.channels[0]
      : undefined);
  useRecordSearchVisit(
    directory?.workspace.workspaceId,
    directory?.principal.principalId,
    requested && selected ? selected.roomId : undefined,
  );
  const bridge = useMemo(() => {
    if (!selected) return undefined;
    let current = bridges.get(selected.roomId);
    if (!current) {
      current = new LoomChannelClient(client, selected.roomId, consumerId);
      bridges.set(selected.roomId, current);
    }
    // Keep unresolved writes across history navigation; release inactive idle projections.
    for (const [id, previous] of bridges)
      if (
        id !== selected.roomId &&
        id !== instanceTarget?.bridge.roomId &&
        previous.writes.state === "idle"
      ) {
        previous.writes.discard();
        bridges.delete(id);
      }
    return current;
  }, [selected, bridges, instanceTarget]);
  const select = useCallback(
    (id: string) => {
      if (hasUnresolvedIntents() && bridges.get(id)?.writes.state !== "unknown")
        return false;
      setParams({ room: id });
      return true;
    },
    [setParams, bridges],
  );
  const privateNotice = (
    <>
      {boxState === "pending" && (
        <p role="status" className="p-3 text-sm">
          正在打开私聊…
        </p>
      )}
      {boxState === "unknown" && (
        <div role="alert" className="p-3 text-sm">
          打开私聊结果未知。
          <Button
            onClick={() =>
              void boxes?.writes
                .retry()
                .catch(() => setBoxError("暂时无法核实，请稍后重试。"))
            }
          >
            核实打开私聊
          </Button>
        </div>
      )}
      {boxError && (
        <p role="alert" className="p-3 text-sm">
          {boxError}
        </p>
      )}
    </>
  );
  const bootstrapping =
    !error &&
    (!directory ||
      (Boolean(directory.workspace.controlRoomId) && !sidebarReady));
  return (
    <AppearanceRuntimeProvider
      client={client}
      controlRoomId={directory?.workspace.controlRoomId}
      roomId={selected?.roomId}
    >
      {bootstrapping && (
        <div
          role="status"
          data-testid="loom-bootstrap-loading"
          className="fixed inset-0 z-[100] flex min-h-0 flex-1 items-center justify-center bg-layer-canvas text-foreground-strong theme-brutal:bg-brutal-cream font-display safe-top"
        >
          <div className="text-xl font-bold">正在加载…</div>
        </div>
      )}

      <SystemNotificationsProvider
        client={client}
        workspaceId={directory?.workspace.workspaceId}
      >
        <AppShellRoot
          inert={bootstrapping ? true : undefined}
          className={`flex-col h-dvh min-h-screen overflow-hidden font-display ${bootstrapping ? "invisible" : ""}`}
          data-testid="loom-channel-app"
        >
          {directory && (
            <TopBarSearch
              client={client}
              directory={directory}
              onDirectory={setDirectory}
              onOpenEntity={openSearchEntity}
              notice={privateNotice}
            />
          )}
          {instanceTarget && directory?.workspace.controlRoomId && (
            <AddInstanceDialog
              target={instanceTarget}
              controlRoomId={directory.workspace.controlRoomId}
              onClose={() => setInstanceTarget(undefined)}
            />
          )}
          <Routes
            location={
              background !== null
                ? { ...location, search: background, state: null }
                : location
            }
          >
            <Route
              path="*"
              element={
                <div className="relative flex min-h-0 min-w-0 flex-1">
                  <DesktopNavigation
                    active={destination}
                    onSelect={selectDestination}
                  />
                  <div
                    className={
                      destination === "channels"
                        ? "flex min-h-0 min-w-0 flex-1"
                        : "hidden"
                    }
                  >
                    <AppShellSidebarSlot
                      className={`relative min-w-0 shrink-0 flex-col md:flex md:w-[var(--chat-sidebar-width)] ${mobileList ? "flex w-full" : "hidden"}`}
                      style={
                        {
                          "--chat-sidebar-width": `${sidebarPanel.width}px`,
                        } as React.CSSProperties
                      }
                    >
                      <PanelResizeHandle
                        side="right"
                        visibleFrom="md"
                        data-testid="chat-sidebar-resize"
                        onPointerDown={sidebarPanel.handleResizeStart}
                        onPointerMove={sidebarPanel.handleResizeMove}
                        onPointerUp={sidebarPanel.handleResizeEnd}
                        onPointerCancel={sidebarPanel.handleResizeEnd}
                      />
                      {!directory && error && (
                        <div className="h-full md:hidden">
                          <ChatSidebarFrame
                            title="聊天"
                            testIdPrefix="public-server-channel-sidebar"
                            scrollTestId="public-server-channel-list"
                          >
                            <p role="alert" className="p-6">
                              {error}
                            </p>
                          </ChatSidebarFrame>
                        </div>
                      )}
                      {directory?.workspace.controlRoomId && (
                        <ChannelSidebar
                          client={client}
                          workspaceId={directory.workspace.workspaceId}
                          controlRoomId={directory.workspace.controlRoomId}
                          onReady={onSidebarReady}
                          name={directory.workspace.name}
                          rooms={directory.channels}
                          privateBoxes={directory.privateBoxes}
                          onPrivateClosed={(id) =>
                            setParams((previous) =>
                              previous.get("room") === id
                                ? new URLSearchParams({ chat: "list" })
                                : previous,
                            )
                          }
                          archivedRooms={directory.archivedChannels}
                          onRoomsChanged={async () => {
                            setDirectory(await loadChannelDirectory(client));
                          }}
                          savedSelected={savedOpen}
                          onOpenSaved={() => {
                            if (!hasUnresolvedIntents())
                              setParams({ saved: "1" });
                          }}
                          selected={
                            savedOpen ? null : (selected?.roomId ?? null)
                          }
                          onSelect={select}
                          onCreated={async (room) => {
                            setDirectory(await loadChannelDirectory(client));
                            setParams({ room: room.roomId });
                          }}
                        />
                      )}
                    </AppShellSidebarSlot>
                    <AppShellMainSlot
                      className={`min-w-0 bg-layer-canvas theme-brutal:bg-white md:flex ${mobileList ? "hidden" : "flex"}`}
                    >
                      {!savedOpen && !selected && (
                        <PanelHeader
                          title="聊天"
                          onMobileBack={showChatList}
                          mobileBackProps={{ "aria-label": "聊天列表" }}
                        />
                      )}
                      {privateNotice}
                      {error ? (
                        <p role="alert" className="p-6">
                          {error}
                        </p>
                      ) : !directory ? (
                        <Spinner aria-label="正在连接 Loom" />
                      ) : savedOpen ? (
                        <SavedPanel
                          client={client}
                          workspaceId={directory.workspace.workspaceId}
                          onMobileBack={showChatList}
                          onOpenEntry={(entry) => {
                            if (hasUnresolvedIntents()) return;
                            const expected = params.toString(),
                              ticket = ++activityNavigation.current;
                            void client
                              .request("message.context", {
                                roomId: entry.channelId,
                                messageId: entry.messageId,
                              })
                              .then(async (context) => {
                                const fresh =
                                  await loadChannelDirectory(client);
                                if (ticket !== activityNavigation.current)
                                  return;
                                setDirectory(fresh);
                                setParams((previous) => {
                                  if (
                                    previous.toString() !== expected ||
                                    hasUnresolvedIntents()
                                  )
                                    return previous;
                                  const next = new URLSearchParams({
                                    room: context.message.roomId,
                                    message: context.message.messageId,
                                  });
                                  if (context.rootMessageId)
                                    next.set("thread", context.rootMessageId);
                                  return next;
                                });
                              })
                              .catch(() =>
                                showToast({
                                  title: "无法打开原消息",
                                  type: "error",
                                }),
                              );
                          }}
                        />
                      ) : selected && destination === "channels" ? (
                        <Channel
                          key={`${selected.roomId}:${params.get("message") ?? "latest"}`}
                          focusId={params.get("message") ?? undefined}
                          threadRootId={params.get("thread") ?? undefined}
                          onThread={(id) => {
                            if (hasRouteBoundIntent()) return;
                            setParams((previous) => {
                              const next = new URLSearchParams(previous);
                              next.set("room", selected.roomId);
                              next.delete("message");
                              if (id) next.set("thread", id);
                              else next.delete("thread");
                              return next;
                            });
                          }}
                          channel={selected}
                          controlRoomId={directory.workspace.controlRoomId}
                          onBack={showChatList}
                          bridge={bridge!}
                          onOpenPrivate={openPrivate}
                          onAddInstance={
                            directory.workspace.controlRoomId
                              ? () => {
                                  if (!hasUnresolvedIntents())
                                    setInstanceTarget({
                                      bridge: bridge!,
                                      name: selected.name,
                                    });
                                }
                              : undefined
                          }
                        />
                      ) : (
                        <p className="p-6">
                          {requested
                            ? "此频道不存在或没有访问权限"
                            : "暂无频道，请从频道列表菜单创建"}
                        </p>
                      )}
                    </AppShellMainSlot>
                  </div>
                  {directory?.workspace.controlRoomId && (
                    <AgentPage
                      client={client}
                      workspaceId={directory.workspace.workspaceId}
                      controlRoomId={directory.workspace.controlRoomId}
                      active={destination === "agents"}
                      notice={privateNotice}
                      onOpenChannel={select}
                      onOpenPrivate={openPrivate}
                    />
                  )}
                  {directory && destination === "tasks" && (
                    <TasksPage
                      client={client}
                      workspaceId={directory.workspace.workspaceId}
                      rooms={directory.channels}
                    />
                  )}
                  {directory &&
                    (destination === "search" ||
                      destination === "activity") && (
                      <DiscoveryPage
                        principalId={directory.principal.principalId}
                        controlRoomId={directory.workspace.controlRoomId}
                        onOpenEntity={openSearchEntity}
                        notice={privateNotice}
                        client={client}
                        workspaceId={directory.workspace.workspaceId}
                        mode={destination}
                        onBack={() => setParams({ chat: "list" })}
                        profileOpen={discoveryProfileOpen}
                        onOpenResult={async (row, full) => {
                          if (hasUnresolvedIntents())
                            throw Error("仍有未决操作");
                          const request = ++activityNavigation.current;
                          const expected = params.toString();
                          const context = await client.request(
                            "message.context",
                            {
                              roomId: row.message.roomId,
                              messageId: row.message.messageId,
                            },
                          );
                          if (
                            context.message.roomId !== row.message.roomId ||
                            context.message.messageId !== row.message.messageId
                          )
                            throw Error("消息身份不一致");
                          const next = await loadChannelDirectory(client);
                          if (
                            ![
                              ...next.channels,
                              ...next.archivedChannels,
                              ...next.privateBoxes,
                            ].some((r) => r.roomId === row.message.roomId)
                          )
                            throw Error("对话不可用");
                          if (request !== activityNavigation.current) return;
                          if (
                            context.message.threadId &&
                            !context.rootMessageId
                          )
                            throw Error("消息列根消息缺失");
                          setDirectory(next);
                          setParams((previous) => {
                            if (
                              request !== activityNavigation.current ||
                              previous.toString() !== expected ||
                              hasUnresolvedIntents()
                            )
                              return previous;
                            const target = new URLSearchParams({
                              room: row.message.roomId,
                              message: row.message.messageId,
                            });
                            if (!full) {
                              target.set("view", destination);
                              for (const key of [
                                "af",
                                "q",
                                "scope",
                                "senderId",
                                "channelId",
                                "scopes",
                                "range",
                                "sort",
                              ]) {
                                if (previous.has(key))
                                  target.set(key, previous.get(key)!);
                              }
                            }
                            if (context.message.threadId) {
                              target.set("thread", context.rootMessageId!);
                              if (!full) target.set("detail", "thread");
                            }
                            return target;
                          });
                        }}
                        detail={
                          requested && selected && bridge ? (
                            params.get("detail") === "thread" &&
                            params.get("thread") ? (
                              <ThreadContentSlot
                                controlRoomId={
                                  directory.workspace.controlRoomId!
                                }
                                onProfileVisibilityChange={
                                  setDiscoveryProfileOpen
                                }
                                key={`${selected.roomId}:${params.get("thread")}:${params.get("message")}`}
                                contentSlot
                                client={client}
                                room={selected}
                                rootMessageId={params.get("thread")!}
                                focusId={params.get("message") ?? undefined}
                                onClose={() =>
                                  setParams((previous) => {
                                    const next = new URLSearchParams(previous);
                                    for (const key of [
                                      "room",
                                      "message",
                                      "thread",
                                      "detail",
                                    ])
                                      next.delete(key);
                                    return next;
                                  })
                                }
                                onChanged={() => {}}
                              />
                            ) : (
                              <Channel
                                key={`${selected.roomId}:${params.get("message")}`}
                                channel={selected}
                                onProfileVisibilityChange={
                                  setDiscoveryProfileOpen
                                }
                                bridge={bridge}
                                controlRoomId={
                                  directory.workspace.controlRoomId
                                }
                                focusId={params.get("message") ?? undefined}
                                threadRootId={params.get("thread") ?? undefined}
                                onThread={(id) =>
                                  setParams((previous) => {
                                    const next = new URLSearchParams(previous);
                                    next.delete("message");
                                    if (id) next.set("thread", id);
                                    else next.delete("thread");
                                    return next;
                                  })
                                }
                                onBack={() =>
                                  setParams((previous) => {
                                    const next = new URLSearchParams(previous);
                                    for (const key of [
                                      "room",
                                      "message",
                                      "thread",
                                      "detail",
                                    ])
                                      next.delete(key);
                                    return next;
                                  })
                                }
                                onOpenPrivate={openPrivate}
                                onAddInstance={undefined}
                              />
                            )
                          ) : undefined
                        }
                      />
                    )}
                  {destination === "settings" &&
                    directory?.workspace.controlRoomId && (
                      <SettingsPage
                        tab={params.get("settings")}
                        onTab={(id) => {
                          if (hasRouteBoundIntent()) return;
                          setParams((previous) => {
                            const next = new URLSearchParams(previous);
                            if (id) next.set("settings", id);
                            else next.delete("settings");
                            return next;
                          });
                        }}
                        client={client}
                        workspaceId={directory.workspace.workspaceId}
                        controlRoomId={directory.workspace.controlRoomId}
                      />
                    )}
                  {![
                    "channels",
                    "agents",
                    "search",
                    "activity",
                    "settings",
                    "tasks",
                  ].includes(destination) && (
                    <DestinationPlaceholder active={destination} />
                  )}
                </div>
              }
            />
          </Routes>
          {(destination !== "channels" || mobileList) &&
            destination !== "search" &&
            destination !== "activity" &&
            !params.has("thread") &&
            !(destination === "settings" && params.has("settings")) &&
            !(destination === "tasks" && params.has("task")) && (
              <>
                <div className="pointer-events-auto md:hidden shrink-0">
                  <LoomLiveActivity />
                </div>
                <MobileNavigation
                  active={destination}
                  onSelect={selectDestination}
                />
              </>
            )}
        </AppShellRoot>
      </SystemNotificationsProvider>
    </AppearanceRuntimeProvider>
  );
}
