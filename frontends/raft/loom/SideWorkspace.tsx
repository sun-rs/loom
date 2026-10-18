import CloseButton from "../packages/web/src/components/ui/CloseButton.tsx";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Room } from "@rah-os/protocol";
import { Button, Spinner, ThreadPanelRoot } from "raft-ui";
import { X } from "lucide-react";
import { useResizablePanel } from "../packages/web/src/hooks/useResizablePanel.ts";
import {
  THREAD_PANEL_MIN_WIDTH,
  THREAD_PANEL_DEFAULT_WIDTH,
  getThreadPanelDynamicMax,
} from "../packages/web/src/lib/panelBounds.ts";
import ConfirmDialog from "../packages/web/src/components/ConfirmDialog.tsx";
import { LoomChannelClient } from "./channel-client.ts";
import { BranchClient } from "./branch-client.ts";
import { useRouteIntentOwner } from "./useIntentRoute.ts";
import { hasUnresolvedIntents } from "@rah-os/client-core/write-intent";
/** Side uses the official thread-side-column composition; its own Room owns all conversation state. */
export default function SideWorkspace({
  client,
  source,
  sideRoomId,
  onClose,
  renderConversation,
}: {
  client: RahClient;
  source: Room;
  sideRoomId: string;
  onClose: () => void;
  renderConversation: (
    room: Room,
    bridge: LoomChannelClient,
    actions: ReactNode,
    unavailable: boolean,
  ) => ReactNode;
}) {
  const bridge = useMemo(
    () => new LoomChannelClient(client, sideRoomId, `loom-side-${sideRoomId}`),
    [client, sideRoomId],
  );
  const owner = useMemo(
    () => new BranchClient(client, sideRoomId, bridge.writes, bridge.room),
    [client, sideRoomId, bridge],
  );
  useRouteIntentOwner(bridge.writes);
  const [state, setState] = useState(bridge.writes.state),
    [room, setRoom] = useState<Room>(),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [tick, setTick] = useState(0);
  const host = useRef<HTMLDivElement>(null),
    [max, setMax] = useState(getThreadPanelDynamicMax);
  const size = useResizablePanel({
    storageKey: "loom:sidePanelWidth",
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
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const { rooms } = await client.request(
          "room.list",
          { workspaceId: source.workspaceId },
          { signal: abort.signal },
        );
        const next = rooms.find(
          (r) =>
            r.roomId === sideRoomId &&
            r.side?.sourceChannelId === source.roomId,
        );
        if (!next) throw Error("此 Side 不属于当前频道，或已无权访问。");
        if (!abort.signal.aborted) {
          setRoom(next);
          setError("");
        }
      } catch (e) {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(read, 3000);
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, source.workspaceId, source.roomId, sideRoomId, tick]);
  const close = () => {
    if (!hasUnresolvedIntents()) onClose();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !document.querySelector('[role="dialog"], [role="menu"]')
      ) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  const actions = (
    <>
      <CloseButton
        data-loom-control="detail-close"
        className="flex size-7 shrink-0 items-center justify-center"
        aria-label="关闭 Side"
        data-testid="thread-close"
        onClick={close}
      >
        <X size={14} />
      </CloseButton>
    </>
  );
  return (
    <div
      ref={host}
      className="thread-side-column flex flex-col bg-layer-card theme-brutal:bg-white"
      data-testid="side-panel"
      style={{ "--thread-panel-width": `${size.width}px` } as CSSProperties}
    >
      <div
        className="thread-side-column-resizer absolute left-0 top-0 bottom-0 w-2 -ml-1 z-10 cursor-col-resize touch-none select-none"
        data-testid="side-resizer"
        onPointerDown={(e) => {
          setMax(getThreadPanelDynamicMax());
          size.handleResizeStart(e);
        }}
        onPointerMove={size.handleResizeMove}
        onPointerUp={size.handleResizeEnd}
        onPointerCancel={size.handleResizeEnd}
      />
      <ThreadPanelRoot className="isolate flex h-full min-h-0 w-full flex-col bg-layer-panel dark:bg-layer-card theme-brutal:bg-white">
        {error && (
          <div role="alert" className="p-3">
            {error}
            <Button onClick={close}>关闭 Side</Button>
          </div>
        )}
        {room ? (
          renderConversation(
            room,
            bridge,
            <>
              {!room.side?.discarded && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={room.side?.discarding || state !== "idle"}
                  onClick={() => setConfirm(true)}
                >
                  {room.side?.discarding ? "等待执行退出" : "丢弃 Side"}
                </Button>
              )}
              {actions}
            </>,
            !!error,
          )
        ) : !error ? (
          <Spinner aria-label="读取 Side" />
        ) : null}
      </ThreadPanelRoot>
      {confirm && room && (
        <ConfirmDialog
          title="丢弃 Side"
          confirmLabel="丢弃 Side"
          confirmVariant="warning"
          closeOnConfirm={false}
          confirmDisabled={
            state !== "idle" ||
            !!room.side?.discarding ||
            !!room.side?.discarded
          }
          onClose={() => {
            if (owner.writes.state === "idle") setConfirm(false);
          }}
          message={
            <>
              <p>
                停止此 Side，确认执行退出后关闭。保留历史；不改变源实例或频道。
              </p>
              {state === "unknown" && (
                <div role="alert">
                  丢弃结果未知。
                  <Button onClick={() => void owner.writes.retry()}>
                    核实丢弃结果
                  </Button>
                  <Button
                    onClick={() => {
                      owner.writes.abandon();
                      setConfirm(false);
                      setTick((v) => v + 1);
                    }}
                  >
                    放弃核实
                  </Button>
                </div>
              )}
              {error && <p role="alert">{error}</p>}
            </>
          }
          onConfirm={async () => {
            await owner.discard(
              room.instancePrivateBox!.instanceId,
              (outcome) => {
                if (outcome.kind === "ok") {
                  setConfirm(false);
                  setTick((v) => v + 1);
                } else if (outcome.kind === "rejected")
                  setError(
                    outcome.error instanceof Error
                      ? outcome.error.message
                      : "丢弃被拒绝",
                  );
              },
            );
          }}
        />
      )}
    </div>
  );
}
