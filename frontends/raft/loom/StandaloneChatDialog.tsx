import { useMemo, useRef, useState, useEffect } from "react";
import { Button } from "raft-ui";
import type { RahClient } from "@rah-os/client-sdk";
import type { RoleTemplate } from "@rah-os/protocol";
import { ManagementClient } from "./management-client.ts";
import { ActionDialog, useManagement } from "./ManagementUi.tsx";
import { uiActionProps } from "./ui-action-props.ts";

/** Loom composition over existing room/instance/personal-sidebar commands.
 * Each known receipt advances one stage. Unknown writes remain in WriteIntentSlot;
 * partial channels stay discoverable, never rolled back or silently recreated.
 */
export default function StandaloneChatDialog({
  client,
  workspaceId,
  controlRoomId,
  role,
  onClose,
  onCreated,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
  role: RoleTemplate;
  onClose: () => void;
  onCreated: (roomId: string) => Promise<void>;
}) {
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId),
    [client, workspaceId, controlRoomId],
  );
  const { state, error, setError } = useManagement(manager);
  const progress = useRef<{
    roomId?: string;
    instantiated?: boolean;
    placed?: boolean;
  }>({});
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [running, setRunning] = useState(false);
  const name = role.configuration.displayName ?? role.configuration.handle;
  const fail = (message: string) => {
    if (alive.current) {
      setRunning(false);
      setError(message);
    }
  };
  const advance = async () => {
    if (!alive.current) return;
    setRunning(true);
    setError("");
    try {
      if (!progress.current.roomId) {
        await manager.createChannel(name, [], (outcome) => {
          if (outcome.kind === "ok") {
            progress.current.roomId = outcome.result.room.roomId;
            void advance();
          } else if (outcome.kind === "rejected") fail("创建未成功，请重试。");
        });
      } else if (!progress.current.instantiated) {
        await manager.instance(
          "add",
          progress.current.roomId,
          role.roleId,
          (outcome) => {
            if (outcome.kind === "ok") {
              progress.current.instantiated = true;
              void advance();
            } else if (outcome.kind === "rejected")
              fail(
                "频道已创建，实例未添加。可继续重试；关闭后仍可从频道列表管理。",
              );
          },
        );
      } else if (!progress.current.placed) {
        const { preferences } = await client.request("sidebar.get", {
          workspaceId,
        });
        if (!alive.current) return;
        const key = `room:${progress.current.roomId}`;
        await manager.sidebar(
          {
            dmOrder: [...new Set([...preferences.dmOrder, key])],
            hiddenDms: preferences.hiddenDms.filter((k) => k !== key),
          },
          preferences.version,
          (outcome) => {
            if (outcome.kind === "ok") {
              progress.current.placed = true;
              void advance();
            } else if (outcome.kind === "rejected")
              fail("会话已创建，列表设置发生变化。继续可重新读取并完成分类。");
          },
        );
      } else {
        await onCreated(progress.current.roomId);
      }
    } catch {
      fail("暂时无法完成操作。已确认的步骤保留，继续不会重新创建会话。");
    }
  };
  return (
    <ActionDialog
      title={`独立单聊 · ${name}`}
      manager={manager}
      error={error}
      onClose={() => {
        if (!running || error) onClose();
      }}
    >
      <p className="mb-4 text-sm">
        创建新的实例与独立会话，不继承此角色其他实例的上下文。支持聊天、任务和文件。
      </p>
      <Button
        {...uiActionProps.dialogSave}
        disabled={state !== "idle" || (running && !error)}
        onClick={() => void advance()}
      >
        {progress.current.roomId ? "继续完成" : "开始聊天"}
      </Button>
    </ActionDialog>
  );
}
