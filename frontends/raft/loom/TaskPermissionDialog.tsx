import { uiActionProps } from "./ui-action-props.ts";
import { RoomSession } from "@rah-os/client-core";
import { useEffect, useState } from "react";
import {
  Button,
  Switch,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogClose,
} from "raft-ui";
import type { LoomChannelClient } from "./channel-client.ts";
import { useRouteIntentOwner } from "./useIntentRoute.ts";
import { saveTaskPermission } from "./product-operations.ts";
export default function TaskPermissionDialog({
  bridge,
  onClose,
}: {
  bridge: LoomChannelClient;
  onClose: () => void;
}) {
  const [view, setView] = useState<
      ReturnType<LoomChannelClient["view"]> & { basis: number }
    >(),
    [enabled, setEnabled] = useState(false),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0),
    [state, setState] = useState(bridge.writes.state);
  useRouteIntentOwner(bridge.writes, "channel-task-permission");
  useEffect(() => bridge.writes.onChange(setState), [bridge]);
  useEffect(() => {
    let alive = true;
    setView(undefined);
    setError("");
    const reader = new RoomSession({
      client: bridge.client,
      roomId: bridge.roomId,
      consumerId: `loom-task-policy:${crypto.randomUUID()}`,
    });
    void reader
      .syncUntilCurrent({ maxPages: 10 })
      .then((result) => {
        if (!result.caughtUp) throw Error("Channel not current");
        if (alive) {
          const v = {
            ...bridge.view(),
            room: result.state.snapshot?.room ?? null,
          };
          setView({ ...v, basis: result.state.latestRoomSeq });
          setEnabled(v.room?.allowInstanceTaskCreation === true);
        }
      })
      .catch(() => {
        if (alive) setError("无法读取频道设置，请重试。");
      });
    return () => {
      alive = false;
    };
  }, [bridge, tick]);
  const busy = state !== "idle";
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>实例任务权限</DialogTitle>
          <DialogClose disabled={busy} aria-label="关闭任务权限" />
        </DialogHeader>
        <DialogBody>
          <p className="mb-4 text-sm text-foreground-muted">
            允许实例自主创建任务。关闭时实例可提出建议，由你创建或转换；已有任务仍可继续执行。开启不会扩大实例的工作授权。
          </p>
          {!view && !error && <p role="status">正在读取设置…</p>}
          {view?.room && (
            <>
              <label className="mb-5 flex items-center justify-between gap-4 text-sm font-bold">
                允许实例自主创建任务
                <Switch
                  aria-label="允许实例自主创建任务"
                  checked={enabled}
                  disabled={busy}
                  onCheckedChange={setEnabled}
                />
              </label>
              <Button
                {...uiActionProps.formSave}
                disabled={
                  busy ||
                  enabled === (view.room.allowInstanceTaskCreation === true)
                }
                onClick={() => {
                  if (!view.room || busy) return;
                  setError("");
                  void saveTaskPermission(
                    bridge.client,
                    bridge.writes,
                    view.room,
                    view.basis,
                    enabled,
                    (outcome) => {
                      if (outcome.kind === "ok") onClose();
                      else
                        setError(
                          outcome.kind === "unknown"
                            ? "结果未知，请核实原操作。"
                            : "设置未保存，频道可能已变化。请重新读取后修改。",
                        );
                    },
                  );
                }}
              >
                保存任务权限
              </Button>
            </>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm">
              {error}
            </p>
          )}
          {error && state === "idle" && (
            <Button
              {...uiActionProps.recovery}
              onClick={() => setTick((v) => v + 1)}
            >
              重新读取设置
            </Button>
          )}
          {state === "unknown" && (
            <div className="mt-3 flex gap-2">
              <Button
                {...uiActionProps.recovery}
                onClick={() => void bridge.writes.retry()}
              >
                核实原操作
              </Button>
              <Button
                {...uiActionProps.recovery}
                onClick={() => {
                  bridge.writes.discard();
                  onClose();
                }}
              >
                放弃核实
              </Button>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
