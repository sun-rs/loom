import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "raft-ui";
import { Trash2 } from "lucide-react";
import type { Room } from "@rah-os/protocol";
import type { ManagementClient } from "./management-client.ts";
import ConfirmDialog from "./OfficialConfirmation.generated";
import { OperationStatus } from "./ManagementUi.tsx";
import { uiActionProps } from "./ui-action-props.ts";
/** Official Sidebar channel-delete confirmation; existing Kernel fences remain authoritative. */
export function ChannelDeleteAction({
  room,
  manager,
  disabled,
  onChanged,
}: {
  room: Room;
  manager: ManagementClient;
  disabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false),
    [error, setError] = useState(""),
    [rejected, setRejected] = useState(false),
    [deleted, setDeleted] = useState(false);
  const [, setParams] = useSearchParams();
  const [basis, setBasis] = useState<number>();
  useEffect(() => {
    if (!confirm) return;
    let alive = true;
    setBasis(undefined);
    void manager
      .session(room.roomId)
      .syncUntilCurrent({ maxPages: 10 })
      .then((result) => {
        if (!result.caughtUp) throw Error("not current");
        if (alive) setBasis(result.state.latestRoomSeq);
      })
      .catch(() => {
        if (alive) setError("无法读取当前频道状态，请关闭确认框后重试。");
      });
    return () => {
      alive = false;
    };
  }, [confirm, manager, room.roomId]);
  if (room.kind !== "channel") return null;
  const remove = async () => {
    if (
      disabled ||
      basis === undefined ||
      rejected ||
      deleted ||
      manager.writes.state !== "idle"
    )
      return;
    await manager.writes.submitRevisioned({
      action: "channel-delete",
      payload: { roomId: room.roomId, basedOnRoomSeq: basis },
      send: (payload, idempotencyKey) =>
        manager.client.request("room.delete", { ...payload, idempotencyKey }),
      onSettled: (outcome) => {
        if (outcome.kind === "ok") {
          setDeleted(true);
          void onChanged()
            .then(() => {
              setConfirm(false);
              setParams({ chat: "list" });
            })
            .catch(() =>
              setError(
                "频道已删除，但列表刷新失败。请刷新页面；不要重复删除。",
              ),
            );
        } else if (outcome.kind === "rejected") {
          setRejected(true);
          setError(
            "频道未删除：状态已变化或执行尚未确认停止。已发出的停止请求会继续处理；请稍后关闭并重新确认删除。",
          );
        }
      },
    });
  };
  return (
    <>
      <Button
        {...uiActionProps.confirmDelete}
        className="w-full"
        data-testid="channel-delete-trigger"
        disabled={disabled || deleted}
        onClick={() => {
          setError("");
          setRejected(false);
          setConfirm(true);
        }}
      >
        <Trash2 size={16} />
        删除频道
      </Button>
      {confirm && (
        <ConfirmDialog
          title="删除频道"
          message={
            <>
              <p>
                永久删除“{room.name}
                ”及其所有实例、私密会话、消息和附件记录？将停止实例执行，保留可复用的角色配置。此操作无法撤销。
              </p>
              <OperationStatus manager={manager} error={error} />
            </>
          }
          confirmLabel="删除频道"
          loadingLabel="正在删除…"
          confirmIcon={<Trash2 size={16} />}
          confirmTestId="channel-delete-confirm"
          confirmDisabled={
            disabled || rejected || deleted || basis === undefined
          }
          closeOnConfirm={false}
          onConfirm={remove}
          onClose={() => {
            if (manager.writes.state === "idle") setConfirm(false);
          }}
        />
      )}
    </>
  );
}
