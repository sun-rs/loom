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
  const [eligibility, setEligibility] = useState<
    "loading" | "clear" | "instances" | "error"
  >("loading");
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
  useEffect(() => {
    let alive = true;
    setEligibility("loading");
    const abort = new AbortController();
    void manager.client
      .request(
        "role.list",
        { controlRoomId: manager.controlRoomId },
        { signal: abort.signal },
      )
      .then((result) => {
        if (alive)
          setEligibility(
            result.instances.some((i) => i.channelId === room.roomId)
              ? "instances"
              : "clear",
          );
      })
      .catch(() => {
        if (alive) setEligibility("error");
      });
    return () => {
      alive = false;
      abort.abort();
    };
  }, [manager, room.roomId]);
  if (room.slug === "all" || room.kind !== "channel") return null;
  const remove = async () => {
    if (
      disabled ||
      basis === undefined ||
      eligibility !== "clear" ||
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
            "频道未删除：频道状态已变化或仍有受保护的实例／工作。请关闭并重新读取；含实例的频道请使用归档。",
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
        disabled={disabled || deleted || eligibility !== "clear"}
        onClick={() => {
          setError("");
          setRejected(false);
          setConfirm(true);
        }}
      >
        <Trash2 size={16} />
        删除频道
      </Button>
      {eligibility === "instances" && (
        <p className="text-caption text-foreground-hint">
          含实例的频道保留历史，请使用归档。
        </p>
      )}
      {eligibility === "error" && (
        <p role="alert" className="text-caption text-foreground-hint">
          无法确认删除条件，请关闭后重试。
        </p>
      )}
      {confirm && (
        <ConfirmDialog
          title="删除频道"
          message={
            <>
              <p>永久删除“{room.name}”及其消息、附件记录？此操作无法撤销。</p>
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
