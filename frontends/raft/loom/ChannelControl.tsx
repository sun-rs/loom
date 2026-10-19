import ChannelSettingsContent from "./ChannelSettingsContent.tsx";
import DiscardChangesDialog from "./DiscardChangesDialog.tsx";
import TaskPermissionDialog from "./TaskPermissionDialog.tsx";
import MemoryPolicyDialog from "./MemoryPolicyDialog.tsx";
import { useRouteIntentOwner } from "./useIntentRoute.ts";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Textarea,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "raft-ui";
import { Brain, CheckSquare, CircleStop, Settings } from "lucide-react";
import type { RoomExecutionReadResponse } from "@rah-os/protocol";
import {
  OverflowMenuTrigger,
  OverflowActionRow,
} from "../packages/web/src/components/ui/OverflowSheet.tsx";
import DialogCard from "../packages/web/src/components/ui/DialogCard.tsx";
import Banner from "../packages/web/src/components/ui/Banner.tsx";
import { ManagementClient } from "./management-client.ts";
import { OperationStatus, useManagement } from "./ManagementUi.tsx";
import { controlChannel } from "./control-actions.ts";
import type { LoomChannelClient } from "./channel-client.ts";
/** ChannelOverflowMenu + SOSDialog structural port; Kernel owns all execution state. */
export default function ChannelControl({
  bridge,
  name,
  workspaceId,
  controlRoomId,
  members,
  readOnly = false,
  onChanged,
}: {
  onChanged: () => Promise<void>;
  readOnly?: boolean;
  members: (close: () => void) => ReactNode;
  bridge: LoomChannelClient;
  name: string;
  workspaceId: string;
  controlRoomId: string;
}) {
  const manager = useMemo(
    () => new ManagementClient(bridge.client, workspaceId, controlRoomId),
    [bridge, workspaceId, controlRoomId],
  );
  useRouteIntentOwner(manager.writes);
  const { state, error, setError } = useManagement(manager);
  const [sheet, setSheet] = useState(false),
    [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const closeSettings = () => {
    if (manager.writes.state !== "idle") return;
    if (dirty) setDiscard(true);
    else setSheet(false);
  };
  const [taskPolicyOpen, setTaskPolicyOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [execution, setExecution] = useState<RoomExecutionReadResponse>();
  const [readError, setReadError] = useState(""),
    [guidance, setGuidance] = useState(""),
    [tick, setTick] = useState(0);
  const trigger = useRef<HTMLDivElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!sheet && !open) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setExecution(undefined);
    const read = async () => {
      try {
        const data = await bridge.client.request(
          "room.execution.read",
          { roomId: bridge.roomId },
          { signal: abort.signal },
        );
        if (!abort.signal.aborted) {
          setExecution(data);
          setReadError("");
        }
      } catch {
        if (!abort.signal.aborted) {
          setExecution(undefined);
          setReadError("无法读取频道执行状态，请稍后重试。");
        }
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(read, 3000);
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [bridge, sheet, open, tick]);
  const stopped = execution?.operation?.state === "stopped",
    stopping = execution?.operation?.state === "stopping";
  useEffect(() => {
    if (stopped && open) textarea.current?.focus({ preventScroll: true });
  }, [stopped, open]);
  const close = () => {
    if (manager.writes.state !== "idle") return;
    setOpen(false);
    requestAnimationFrame(() =>
      trigger.current?.querySelector("button")?.focus(),
    );
  };
  const run = async (action: "stop" | "resume") => {
    setError("");
    await controlChannel(manager, bridge.roomId, action, guidance, (result) => {
      if (result.kind === "ok") {
        setTick((v) => v + 1);
        if (action === "resume") {
          setGuidance("");
          close();
        }
      } else if (result.kind === "rejected") {
        setError(String(result.error));
        setTick((v) => v + 1);
      }
    });
  };
  return (
    <>
      <div ref={trigger}>
        <OverflowMenuTrigger
          labelId="message.chatPanel.overflow.open"
          icon={<Settings size={22} />}
          testId="loom-channel-control-trigger"
          onClick={() => setSheet(true)}
        />
      </div>
      <Drawer
        open={sheet}
        modal
        swipeDirection="right"
        disablePointerDismissal={dirty || state !== "idle"}
        onOpenChange={(next, event) => {
          if (next) setSheet(true);
          else {
            if (
              dirty &&
              (event.reason === "outside-press" || event.reason === "swipe")
            ) {
              event.cancel();
              return;
            }
            closeSettings();
          }
        }}
      >
        <DrawerContent
          data-testid="loom-channel-control-sheet"
          className="inset-y-0 right-0 h-dvh w-full [--drawer-content-height:100dvh] [--drawer-inset:0px] flex-col"
        >
          <DrawerHeader className="flex-row justify-between">
            <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-1.5">
              <p className="col-start-1 row-start-2 text-caption text-foreground-hint">
                频道
              </p>
              <DrawerTitle className="col-span-2 col-start-1 row-start-1 truncate">
                频道设置
              </DrawerTitle>
              <DrawerDescription className="col-start-2 row-start-2 min-w-0 truncate font-mono text-mono-meta text-foreground-hint">
                #{name}
              </DrawerDescription>
            </div>
          </DrawerHeader>
          <ChannelSettingsContent
            bridge={bridge}
            manager={manager}
            busy={state !== "idle"}
            onDirty={setDirty}
            onClose={closeSettings}
            onSaved={() => {
              setDirty(false);
              setSheet(false);
            }}
            onChanged={onChanged}
            members={members(() => setSheet(false))}
          >
            {!readOnly && (
              <>
                <OverflowActionRow
                  disabled={dirty || state !== "idle"}
                  icon={<CheckSquare size={14} />}
                  label="实例任务权限"
                  ariaLabel="实例任务权限"
                  onClick={() => {
                    setSheet(false);
                    setTaskPolicyOpen(true);
                  }}
                />
                <OverflowActionRow
                  disabled={dirty || state !== "idle"}
                  icon={<Brain size={14} />}
                  label="记忆权限"
                  ariaLabel="频道记忆权限"
                  onClick={() => {
                    setSheet(false);
                    setMemoryOpen(true);
                  }}
                />
                {readError && <p role="alert">{readError}</p>}
                <OverflowActionRow
                  disabled={dirty || state !== "idle"}
                  icon={<CircleStop size={14} />}
                  label={
                    stopped
                      ? "恢复频道"
                      : stopping
                        ? "查看急停进度"
                        : "停止频道内所有实例"
                  }
                  ariaLabel="频道急停与恢复"
                  testId="channel-overflow-stop-agents"
                  onClick={() => {
                    setSheet(false);
                    setOpen(true);
                    setError("");
                  }}
                />
              </>
            )}
          </ChannelSettingsContent>
        </DrawerContent>
      </Drawer>
      {discard && (
        <DiscardChangesDialog
          onCancel={() => setDiscard(false)}
          onDiscard={() => {
            setDiscard(false);
            setDirty(false);
            setSheet(false);
          }}
        />
      )}
      {taskPolicyOpen && (
        <TaskPermissionDialog
          bridge={bridge}
          onClose={() => {
            setTaskPolicyOpen(false);
            requestAnimationFrame(() =>
              trigger.current?.querySelector("button")?.focus(),
            );
          }}
        />
      )}
      {memoryOpen && (
        <MemoryPolicyDialog
          bridge={bridge}
          onClose={() => {
            setMemoryOpen(false);
            requestAnimationFrame(() =>
              trigger.current?.querySelector("button")?.focus(),
            );
          }}
        />
      )}
      {open && (
        <DialogCard
          title={
            stopped
              ? "恢复频道"
              : stopping
                ? "频道正在停止"
                : "停止频道内所有实例"
          }
          maxWidthClass="max-w-sm"
          testId="loom-sos-dialog"
          onClose={close}
        >
          {readError && <p role="alert">{readError}</p>}
          {!execution ? (
            <p role="status">正在读取执行状态…</p>
          ) : stopping ? (
            <p
              role="status"
              className="mb-5 text-sm leading-relaxed text-foreground-muted"
            >
              正在等待 {execution.operation?.pendingTargetCount}{" "}
              个执行终止，尚未全部停止。
            </p>
          ) : stopped ? (
            <>
              <Banner intent="success" density="sm" className="mb-3 font-bold">
                频道已停止
              </Banner>
              <p className="mb-2 text-sm">
                填写修正方向后恢复，沿用各实例原会话。
              </p>
              <Textarea
                ref={textarea}
                aria-label="恢复指引"
                value={guidance}
                onChange={(e) => setGuidance(e.target.value)}
                rows={4}
                maxLength={4000}
                className="mb-4 w-full resize-none p-3 text-sm"
                disabled={state !== "idle"}
              />
              <div className="flex justify-end gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={close}
                  disabled={state !== "idle"}
                >
                  保持停止
                </Button>
                <Button
                  size="sm"
                  variant="success"
                  disabled={state !== "idle" || !guidance.trim()}
                  onClick={() => void run("resume")}
                >
                  恢复频道
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-5 text-sm leading-relaxed text-foreground-muted ">
                停止 #{name}{" "}
                的当前执行并暂停后续调度。保留实例、会话和聊天记录；恢复时需要填写指引。
              </p>
              <div className="flex justify-end gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={close}
                  disabled={state !== "idle"}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  variant="warning"
                  disabled={state !== "idle"}
                  onClick={() => void run("stop")}
                >
                  确认急停
                </Button>
              </div>
            </>
          )}
          <OperationStatus manager={manager} error={error} />
        </DialogCard>
      )}
    </>
  );
}
