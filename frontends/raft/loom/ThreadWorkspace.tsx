import { MessageReactionsProvider } from "./MessageReactions.tsx";
import ThreadFollowers from "./ThreadFollowers.tsx";
import ThreadFollowMenu from "./ThreadFollowMenu.tsx";
import { useThreadActivity } from "./useThreadActivity.ts";
import {
  useEffect,
  useMemo,
  useState,
  useRef,
  type ComponentType,
  type ReactNode,
  type CSSProperties,
} from "react";
import { MessageProfileMembers } from "./MessageProfile.tsx";
import type { Principal, Room } from "@rah-os/protocol";
import type { RahClient } from "@rah-os/client-sdk";
import { Button, ThreadPanelRoot, ThreadPanelFooter } from "raft-ui";
import ThreadPanel, {
  type ThreadPanelProps,
} from "../packages/web/src/components/message/ThreadPanel.tsx";
import MessageInput from "./ComposerFiles.tsx";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader.tsx";
import { composerHostClassName } from "../packages/web/src/components/message/composerHost.ts";
import { useResizablePanel } from "../packages/web/src/hooks/useResizablePanel.ts";
import {
  THREAD_PANEL_MIN_WIDTH,
  THREAD_PANEL_DEFAULT_WIDTH,
  getThreadPanelDynamicMax,
} from "../packages/web/src/lib/panelBounds.ts";
import { LoomThreadClient } from "./thread-client.ts";
import { toOfficialMessage } from "./channel-client.ts";
import { useRouteIntentOwner } from "./useIntentRoute.ts";
const ControlledThreadPanel = ThreadPanel as ComponentType<
  ThreadPanelProps & {
    loomFooter: ReactNode;
    loomHeaderActions?: ReactNode;
    loomOnOpenProfile?: (kind: "agent" | "human", id: string) => void;
    loomFocusId?: string;
    loomHasNewer?: boolean;
    loomLoadNewer?: () => Promise<void>;
  }
>;
export default function ThreadWorkspace({
  client,
  room,
  rootMessageId,
  focusId,
  onClose,
  onChanged,
  onOpenProfile,
  embedded = false,
  contentSlot = false,
  covered = false,
  taskHead,
  readError,
}: {
  embedded?: boolean;
  contentSlot?: boolean;
  covered?: boolean;
  taskHead?: ReactNode;
  readError?: string;
  client: RahClient;
  room: Room;
  rootMessageId: string;
  focusId?: string;
  onClose: () => void;
  onChanged: () => void;
  onOpenProfile?: (member: Principal) => void;
}) {
  const bridge = useMemo(
    () => new LoomThreadClient(client, room.roomId, rootMessageId),
    [client, room.roomId, rootMessageId],
  );
  useRouteIntentOwner(bridge.writes);
  const [state, setState] = useState(bridge.writes.state);
  const [data, setData] = useState<ReturnType<LoomThreadClient["view"]>>();
  const [localError, setError] = useState("");
  const error = readError || localError;
  const [tick, setTick] = useState(0);
  const [max, setMax] = useState(getThreadPanelDynamicMax);
  const host = useRef<HTMLDivElement>(null);
  const activity = useThreadActivity(
    client,
    room.roomId,
    data?.thread?.threadId,
    data?.messages ?? [],
    host,
    !!data && !error && !covered,
  );
  const size = useResizablePanel({
    storageKey: "loom:threadPanelWidth",
    min: THREAD_PANEL_MIN_WIDTH,
    max,
    defaultWidth: THREAD_PANEL_DEFAULT_WIDTH,
    direction: "left",
    getDragStartWidth: () => host.current?.getBoundingClientRect().width,
  });
  useEffect(() => {
    const stop = bridge.writes.onChange(setState);
    return () => {
      stop();
      bridge.writes.discard();
    };
  }, [bridge]);
  const close = () => {
    if (bridge.writes.state === "idle" && !activity.busy) onClose();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        !covered &&
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !document.querySelector(
          '[role="dialog"], [role="menu"], [role="listbox"]',
        )
      ) {
        e.preventDefault();
        if (bridge.writes.state === "idle") onClose();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [bridge, onClose, covered]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const value = await bridge.refresh(abort.signal, focusId);
        if (!abort.signal.aborted) {
          setData(value);
          setError("");
        }
      } catch {
        if (!abort.signal.aborted) {
          setError("消息列暂时无法读取，请重试。");
        }
      } finally {
        if (!abort.signal.aborted)
          timer = setTimeout(read, document.hidden ? 15000 : 3000);
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [bridge, tick, focusId]);
  const parent = data?.parent
    ? toOfficialMessage(data.parent, data.members)
    : undefined;
  const replies =
    data?.messages.map((m) => toOfficialMessage(m, data.members)) ?? [];
  const footer = (
    <ThreadPanelFooter className={composerHostClassName(false)}>
      {activity.error && (
        <div role="alert" className="p-3 text-sm">
          {activity.error}
          {activity.following === undefined && (
            <Button onClick={activity.reload}>重新读取关注状态</Button>
          )}
        </div>
      )}
      {state === "unknown" && (
        <div role="alert" className="p-3 text-sm">
          {bridge.writes.current?.action === "message-reaction"
            ? "表情结果未知，请核实原请求。"
            : "回复结果未知，请核实原请求。"}
          <Button onClick={() => void bridge.writes.retry()}>
            {bridge.writes.current?.action === "message-reaction"
              ? "核实表情结果"
              : bridge.writes.current?.action === "message-save"
                ? "核实收藏结果"
                : "核实回复结果"}
          </Button>
        </div>
      )}
      <div
        data-loom-composer-shell
        className="relative z-20 shrink-0 min-w-0 w-full flex-1 border-t border-line-muted bg-layer-panel px-3 pt-3 safe-bottom theme-brutal:border-t-2 theme-brutal:border-black theme-brutal:bg-white"
      >
        <MessageInput
          client={client}
          roomId={room.roomId}
          channelId={`loom-thread:${room.roomId}:${rootMessageId}`}
          channelName={room.name}
          mentionChannelId={room.roomId}
          mentionScopeChannelType="private"
          loadMentionMembers={!!data && !error}
          variant="compact"
          showTaskButton={false}
          placeholder="回复此消息列"
          submitDisabled={
            !data ||
            !!error ||
            !!(data?.room?.archivedAt || room.archivedAt) ||
            state !== "idle"
          }
          onSendOverride={async (body, _mentions, _asTask, attachmentIds) => {
            await bridge.send(body, attachmentIds);
            setTick((v) => v + 1);
            onChanged();
          }}
        />
      </div>
    </ThreadPanelFooter>
  );
  return (
    <MessageReactionsProvider
      bridge={bridge}
      messages={parent ? [parent, ...replies] : replies}
    >
      <MessageProfileMembers.Provider value={data?.members ?? []}>
        <div
          ref={host}
          className={
            embedded || contentSlot
              ? "relative flex min-h-0 flex-1 flex-col"
              : "thread-side-column flex flex-col bg-layer-card theme-brutal:bg-white"
          }
          data-testid={
            contentSlot ? "activity-thread-content" : "thread-side-column"
          }
          style={{ "--thread-panel-width": `${size.width}px` } as CSSProperties}
        >
          {!embedded && !contentSlot && (
            <div
              className="thread-side-column-resizer absolute left-0 top-0 bottom-0 w-2 -ml-1 z-10 cursor-col-resize touch-none select-none"
              data-testid="loom-thread-resizer"
              onPointerDown={(e) => {
                setMax(getThreadPanelDynamicMax());
                size.handleResizeStart(e);
              }}
              onPointerMove={size.handleResizeMove}
              onPointerUp={size.handleResizeEnd}
              onPointerCancel={size.handleResizeEnd}
            />
          )}
          {parent && data ? (
            <ControlledThreadPanel
              presentation={embedded ? "modal" : "side"}
              hideHeader={embedded}
              hideParentMessage={embedded}
              parentSlot={taskHead}
              onClose={close}
              readOnlyData={{
                threadChannelId:
                  data.thread?.threadId ?? `draft:${rootMessageId}`,
                parentChannelId: room.roomId,
                parentMessage: parent,
                replies: error ? [] : replies,
                senderByMessageId: new Map(
                  [parent, ...replies].map((m) => [
                    m.id,
                    {
                      displayName: m.senderDisplayName ?? "成员",
                      avatarUrl: null,
                      description: null,
                    },
                  ]),
                ),
                channels: [
                  {
                    id: room.roomId,
                    name: room.name,
                    description: room.description ?? null,
                    type: "channel",
                    createdAt: room.createdAt,
                  },
                ],
                loading: false,
                error,
                hasOlder: !error && data.hasOlder,
                loadOlder: async () => {
                  try {
                    setData(await bridge.older());
                  } catch {
                    setError("更早回复读取失败，请重试。");
                  }
                },
              }}
              key={focusId ?? "latest"}
              loomFocusId={focusId}
              loomHasNewer={data.hasNewer}
              loomLoadNewer={async () => {
                try {
                  setData(await bridge.newer());
                } catch {
                  setError("更新回复读取失败，请重试。");
                }
              }}
              loomOnOpenProfile={(kind, id) => {
                if (kind !== "agent" || error) return;
                const member = data.members.find(
                  (m) => m.kind === "agent" && m.principalId === id,
                );
                if (member) onOpenProfile?.(member);
              }}
              loomHeaderActions={
                data.thread && !error ? (
                  <>
                    <ThreadFollowers
                      client={client}
                      roomId={room.roomId}
                      threadId={data.thread.threadId}
                      members={data.members}
                      onOpenProfile={onOpenProfile}
                    />
                    <ThreadFollowMenu
                      followed={activity.following ?? false}
                      followBusy={
                        activity.busy ||
                        activity.following === undefined ||
                        state !== "idle" ||
                        !!data.room?.archivedAt
                      }
                      onFollow={() => void activity.follow()}
                    />
                  </>
                ) : undefined
              }
              loomFooter={footer}
            />
          ) : (
            <ThreadPanelRoot className="isolate flex h-full min-h-0 w-full flex-col bg-layer-panel dark:bg-layer-card theme-brutal:bg-white">
              <PanelHeader
                title="消息列"
                onMobileBack={close}
                mobileBackProps={{ "data-testid": "thread-mobile-back" }}
                actions={
                  <Button
                    data-testid="thread-close"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="关闭消息列"
                    onClick={close}
                  >
                    ×
                  </Button>
                }
              />
              <div
                role={error ? "alert" : "status"}
                className="flex-1 p-3 text-center text-sm text-foreground-muted"
              >
                <span>{error || "加载中…"}</span>
                {error && (
                  <Button onClick={() => setTick((v) => v + 1)}>
                    重新读取
                  </Button>
                )}
              </div>
              {footer}
            </ThreadPanelRoot>
          )}
        </div>
      </MessageProfileMembers.Provider>
    </MessageReactionsProvider>
  );
}
