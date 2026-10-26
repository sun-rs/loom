import { useMemo, useRef, useState, useEffect } from "react";
import { toast } from "raft-ui";
import type { RahClient } from "@rah-os/client-sdk";
import { SidebarResponseSchema } from "@rah-os/protocol";
import { hasUnresolvedIntents } from "@rah-os/client-core/write-intent";
import { ManagementClient } from "./management-client";
import { useManagement } from "./ManagementUi";
import {
  prepareActivityMute,
  changeActivityFollow,
} from "./activity-secondary";
import type { DiscoveryRow } from "./discovery-client";
export function useActivitySecondary(
  client: RahClient,
  workspaceId: string,
  controlRoomId: string | undefined,
  refresh: () => void,
) {
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId ?? ""),
    [client, workspaceId, controlRoomId],
  );
  const operation = useManagement(manager);
  const live = useRef(true);
  const toasts = useRef(new Set<string>());
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      for (const id of toasts.current) toast.dismiss(id);
      toasts.current.clear();
    };
  }, []);
  const lock = useRef(false);
  const [reading, setReading] = useState(false);
  const ready = () =>
    live.current &&
    !!controlRoomId &&
    !lock.current &&
    manager.writes.state === "idle" &&
    !hasUnresolvedIntents();
  const changed = () => {
    window.dispatchEvent(new Event("loom:sidebar-preferences-changed"));
    refresh();
  };
  const mute = async (
    row: DiscoveryRow,
    muted = true,
    expectedVersion?: number,
  ) => {
    if (!ready() || row.activityKind !== "channel") return;
    lock.current = true;
    setReading(true);
    operation.setError("");
    try {
      const request = await prepareActivityMute(
        client,
        workspaceId,
        row.message.roomId,
        muted,
        expectedVersion,
      );
      if (!request || !live.current) return;
      await manager.sidebar(
        request.patch,
        request.expectedVersion,
        (outcome) => {
          if (outcome.kind === "ok") {
            changed();
            if (muted && live.current) {
              const saved = SidebarResponseSchema.parse(outcome.result);
              toasts.current.add(
                toast.success(`已静音 ${row.roomName} 的动态`, {
                  action: {
                    label: "撤销",
                    onClick: () => {
                      void mute(row, false, saved.preferences.version);
                    },
                  },
                }),
              );
            }
          } else if (outcome.kind === "rejected")
            operation.setError(
              "偏好未保存，可能已变化。请重新操作以读取最新状态。",
            );
        },
      );
    } catch (error) {
      operation.setError(
        error instanceof Error
          ? error.message
          : "无法读取或核实偏好；未自动重发。",
      );
    } finally {
      lock.current = false;
      setReading(false);
    }
  };
  const follow = async (row: DiscoveryRow, following = false) => {
    if (!ready() || !row.activityFrontier?.threadId) return;
    lock.current = true;
    setReading(true);
    operation.setError("");
    try {
      const didChange = await changeActivityFollow(
        client,
        row.message.roomId,
        row.activityFrontier.threadId,
        following,
        row.activityFrontier.throughSeq,
        () => live.current,
      );
      if (!live.current) return;
      refresh();
      if (didChange && !following && live.current)
        toasts.current.add(
          toast.success(`已取消关注 ${row.label}`, {
            action: {
              label: "撤销",
              onClick: () => {
                void follow(row, true);
              },
            },
          }),
        );
    } catch (error) {
      operation.setError(
        error instanceof Error
          ? error.message
          : "未确认关注操作结果；不会自动重发。",
      );
      refresh();
    } finally {
      lock.current = false;
      setReading(false);
    }
  };
  return {
    manager,
    error: operation.error,
    busy: reading || operation.state !== "idle",
    enabled: !!controlRoomId,
    mute: (row: DiscoveryRow) => void mute(row),
    unfollow: (row: DiscoveryRow) => void follow(row),
  };
}
