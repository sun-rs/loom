import AddInstanceDialog from "./AddInstanceDialog.tsx";
import { LoomPrivateBoxClient } from "./private-box.ts";
import ChannelMembers from "./ChannelMembers.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import PublicServerChannelSidebar from "../packages/web/src/components/server/PublicServerChannelSidebar.tsx";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader.tsx";
import MessageTimeline from "../packages/web/src/components/message/MessageTimeline.tsx";
import MessageItem from "../packages/web/src/components/message/MessageItem.tsx";
import MessageInput from "../packages/web/src/components/message/MessageInput.tsx";
import { LoomChannelClient, loadChannelDirectory } from "./channel-client.ts";
import type { Room } from "@rah-os/protocol";
const client = new HttpRahClient({
  baseUrl: "",
  accessToken: () => "trusted-proxy-auth",
});
const noMentions = new Map();
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
}: {
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
        icon={isPrivate ? <MessageSquare size={18} /> : <Hash size={18} />}
        actions={
          isPrivate ? undefined : (
            <ChannelMembers
              bridge={bridge}
              onOpenPrivate={onOpenPrivate}
              onAddInstance={onAddInstance}
            />
          )
        }
      />
      <ConversationPanelContent>
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
            <MessageTimeline
              source={{
                messages: view.messages,
                hasOlder: view.hasOlder,
                hasNewer: false,
                loading,
                loadOlder: older,
                loadNewer: async () => {},
              }}
              renderItem={(message) => (
                <MessageItem
                  message={message}
                  mentionMap={noMentions}
                  channels={[]}
                  readOnlyProjection
                  readOnlySender={{
                    displayName: message.senderDisplayName ?? "成员",
                    avatarUrl: null,
                    description: null,
                  }}
                  hideThreadActions
                />
              )}
              className="h-full"
              testId="loom-message-timeline"
              persistKey={`loom-channel:${channel.roomId}`}
              sparseAnchor="top"
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
      <MessageInput
        channelId={channel.roomId}
        channelName={channel.name}
        variant="compact"
        loadMentionMembers={false}
        showTaskButton={false}
        onSendOverride={send}
        submitDisabled={
          loading ||
          Boolean(error) ||
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
    </ConversationPanelRoot>
  );
}

export default function ChannelApp() {
  const [directory, setDirectory] =
    useState<Awaited<ReturnType<typeof loadChannelDirectory>>>();
  const [error, setError] = useState("");
  const [params, setParams] = useSearchParams();
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
  const selected =
    [...(directory?.channels ?? []), ...(directory?.privateBoxes ?? [])].find(
      (room) => room.roomId === requested,
    ) ?? (!requested ? directory?.channels[0] : undefined);
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
        return;
      setParams({ room: id });
    },
    [setParams, bridges],
  );
  return (
    <AppShellRoot
      className="h-dvh min-h-screen overflow-hidden font-display"
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
        <AppShellSidebarSlot className="relative flex w-36 shrink-0 flex-col sm:w-[240px]">
          <PublicServerChannelSidebar
            serverName={directory?.workspace.name ?? "Loom"}
            channelsLabel="频道"
            channels={(directory?.channels ?? []).map((room) => ({
              id: room.roomId,
              name: room.name,
            }))}
            selectedChannelId={selected?.roomId ?? null}
            onSelectChannel={select}
          />
        </AppShellSidebarSlot>
        <AppShellMainSlot className="bg-layer-canvas theme-brutal:bg-white">
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
                : "暂无频道，请先通过控制台创建"}
            </p>
          )}
        </AppShellMainSlot>
      </div>
    </AppShellRoot>
  );
}
