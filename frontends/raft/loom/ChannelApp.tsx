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
} from "react";
import { useSearchParams } from "react-router-dom";
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
import MessageInput from "../packages/web/src/components/message/MessageInput.tsx";
import { LoomChannelClient, loadChannelDirectory } from "./channel-client.ts";
import type { Room } from "@rah-os/protocol";
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
  bridge,
  onOpenPrivate,
  onAddInstance,
  onBack,
}: {
  onBack: () => void;
  onOpenPrivate: (id: string) => void;
  onAddInstance: (() => void) | undefined;
  channel: Room;
  bridge: LoomChannelClient;
}) {
  const isPrivate = channel.instancePrivateBox !== undefined;
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
        const next = await bridge.refresh();
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
  }, [bridge]);
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
  const older = useCallback(async () => {
    try {
      setView(await bridge.older());
    } catch (failure) {
      setError(String(failure));
    }
  }, [bridge]);
  const send = useCallback(
    async (body: string) => {
      await new Promise<void>((resolve, reject) => {
        // Keep the official composer's submission unresolved while the outcome is
        // unknown. Explicit verification settles this same submission, so it never
        // restores an already committed draft as a new sendable message.
        void bridge
          .send(body, (outcome) => {
            if (outcome.kind === "ok") resolve();
            else if (outcome.kind === "rejected") reject(outcome.error);
          })
          .then((outcome) => {
            if (outcome.kind === "busy")
              reject(new Error("正在处理上一条消息"));
          })
          .catch(reject);
      });
      // Sending success is durable even if the following read is temporarily unavailable.
      void bridge
        .refresh()
        .then(setView)
        .catch((failure) => setError(String(failure)));
    },
    [bridge],
  );
  const verify = async () => {
    const result = await bridge.writes.retry();
    if (result.kind === "ok") {
      setView(await bridge.refresh());
    } else setError("尚未核实发送结果，请稍后再核实。");
  };
  return (
    <ConversationPanelRoot edge="attached" className="relative border-l-0">
      <PanelHeader
        title={isPrivate ? `私聊 · ${channel.name}` : channel.name}
        subtitle={channel.description}
        onMobileBack={onBack}
        mobileBackProps={{ "aria-label": "聊天列表" }}
        icon={isPrivate ? <MessageSquare size={18} /> : <Hash size={18} />}
        actions={
          isPrivate ? undefined : (
            <ChannelMembers
              bridge={bridge}
              onOpenPrivate={onOpenPrivate}
              onAddInstance={channel.archivedAt ? undefined : onAddInstance}
            />
          )
        }
      />
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
        {isPrivate && view.room?.instancePrivateBox?.active === false && (
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
            <Spinner aria-label="正在读取频道" />
          ) : view.messages.length === 0 ? (
            <p className="p-6 text-sm">
              {isPrivate ? "还没有私聊消息" : "频道还没有消息"}
            </p>
          ) : (
            <ChannelTimeline
              roomId={channel.roomId}
              messages={view.messages}
              members={error ? [] : view.members}
              hasOlder={view.hasOlder}
              loading={loading}
              loadOlder={older}
            />
          )}
        </div>
      </ConversationPanelContent>
      {writeState === "unknown" && (
        <div role="alert" className="p-3 text-sm">
          发送结果未知，核实前已暂停发送。
          <Button
            onClick={() =>
              void verify().catch((failure) => setError(String(failure)))
            }
          >
            核实发送
          </Button>
        </div>
      )}
      {/* Official full-chat shell; compact input suppresses unavailable uploads only. */}
      <div
        data-testid="chat-composer-shell"
        className="relative flex min-w-0 w-full items-center border-t border-line-muted bg-layer-panel px-3 pt-3 safe-bottom theme-brutal:border-t-2 theme-brutal:border-black theme-brutal:bg-white"
      >
        <MessageInput
          channelId={channel.roomId}
          channelName={channel.name}
          variant="compact"
          loadMentionMembers={!loading}
          mentionScopeChannelType="private"
          showTaskButton={false}
          onSendOverride={send}
          submitDisabled={
            loading ||
            Boolean(error) ||
            Boolean(channel.archivedAt) ||
            writeState !== "idle" ||
            (isPrivate && view.room?.instancePrivateBox?.active !== true)
          }
          submitDisabledReason={
            isPrivate && view.room?.instancePrivateBox?.active === false
              ? "此私聊已停用"
              : undefined
          }
          placeholder={
            isPrivate ? `私聊 ${channel.name}` : `发送到 #${channel.name}`
          }
        />
      </div>
    </ConversationPanelRoot>
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
  const [params, setParams] = useSearchParams();
  const destination = params.get("view") ?? "channels";
  const selectDestination = (id: Destination) => {
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
  const mobileList = !requested || params.get("chat") === "list";
  const showChatList = () =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("chat", "list");
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
    <>
      {bootstrapping && (
        <div
          role="status"
          data-testid="loom-bootstrap-loading"
          className="fixed inset-0 z-[100] flex min-h-0 flex-1 items-center justify-center bg-brutal-cream font-display safe-top"
        >
          <div className="text-xl font-bold">正在加载…</div>
        </div>
      )}
      <AppShellRoot
        inert={bootstrapping ? true : undefined}
        className={`h-dvh min-h-screen overflow-hidden font-display ${bootstrapping ? "invisible" : ""}`}
        data-testid="loom-channel-app"
      >
        {instanceTarget && directory?.workspace.controlRoomId && (
          <AddInstanceDialog
            target={instanceTarget}
            controlRoomId={directory.workspace.controlRoomId}
            onClose={() => setInstanceTarget(undefined)}
          />
        )}
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
                  selected={selected?.roomId ?? null}
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
              {!selected && (
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
              ) : selected ? (
                <Channel
                  key={selected.roomId}
                  channel={selected}
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
          {directory &&
            (destination === "search" || destination === "activity") && (
              <DiscoveryPage
                client={client}
                workspaceId={directory.workspace.workspaceId}
                mode={destination}
                onOpenRoom={async (id) => {
                  if (hasUnresolvedIntents()) throw Error("仍有未决操作");
                  const next = await loadChannelDirectory(client);
                  if (
                    ![...next.channels, ...next.privateBoxes].some(
                      (room) => room.roomId === id,
                    )
                  )
                    throw Error("对话不可用");
                  setDirectory(next);
                  setParams({ room: id });
                }}
              />
            )}
          {!["channels", "agents", "search", "activity"].includes(
            destination,
          ) && <DestinationPlaceholder active={destination} />}
        </div>
        {(destination !== "channels" || mobileList) && (
          <MobileNavigation active={destination} onSelect={selectDestination} />
        )}
      </AppShellRoot>
    </>
  );
}
