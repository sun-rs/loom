import { useMemo, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { RoomAgentBlockedActivation } from "@rah-os/protocol";
import { Button } from "raft-ui";
import Banner from "../packages/web/src/components/ui/Banner.tsx";
import ConfirmDialog from "../packages/web/src/components/ConfirmDialog.tsx";
import { ManagementClient } from "./management-client.ts";
import { OperationStatus, useManagement } from "./ManagementUi.tsx";
import { abandonInstanceWork } from "./control-actions.ts";
import { useRouteIntentOwner } from "./useIntentRoute.ts";

/** Kernel owns the block; this is an explicit Human withdrawal, never a retry. */
export default function BlockedWorkControl({
  client,
  controlRoomId,
  workspaceId,
  instance,
  blocked,
  onChanged,
}: {
  client: RahClient;
  controlRoomId: string;
  workspaceId: string;
  instance?: { instanceId: string; channelId: string };
  blocked?: RoomAgentBlockedActivation;
  onChanged: () => void;
}) {
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId),
    [client, workspaceId, controlRoomId],
  );
  useRouteIntentOwner(manager.writes);
  const { state, error, setError } = useManagement(manager);
  const [target, setTarget] = useState<{
    instance: { instanceId: string; channelId: string };
    blocked: RoomAgentBlockedActivation;
  }>();
  const [notice, setNotice] = useState("");
  const close = () => {
    if (manager.writes.state === "idle") setTarget(undefined);
  };
  return (
    <>
      {blocked && instance && (
        <div className="px-3 py-2" data-testid="loom-blocked-work">
          <Banner intent="warning" density="sm">
            <p>
              {blocked.holdsLane
                ? "有工作阻塞了此实例的执行通道"
                : "有未完成工作需要处理"}
            </p>
            <p className="whitespace-pre-wrap break-words">{blocked.reason}</p>
            <p>
              {blocked.roomId === instance.channelId
                ? "来源：频道"
                : "来源：此实例私聊"}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={state !== "idle"}
              onClick={() => {
                setError("");
                setNotice("");
                setTarget({ instance, blocked });
              }}
            >
              处理阻塞工作
            </Button>
          </Banner>
        </div>
      )}
      {notice && (
        <p role="status" className="px-3 py-2 text-sm">
          {notice}
        </p>
      )}
      {target && (
        <ConfirmDialog
          title="放弃本次阻塞工作"
          chromeLocale="zh-cn"
          confirmLabel="确认放弃"
          confirmVariant="warning"
          closeOnConfirm={false}
          onClose={close}
          confirmDisabled={
            state !== "idle" ||
            blocked?.activationId !== target.blocked.activationId
          }
          message={
            <>
              <p className="whitespace-pre-wrap break-words">
                {target.blocked.reason}
              </p>
              <p>
                取消这一次工作，不重跑旧回复。保留原会话、聊天和运行记录，Task
                状态不变。处理原因后，请在对话中发送新的请求；仍有执行未终止时，服务端会拒绝。
              </p>
              {blocked?.activationId !== target.blocked.activationId &&
                state === "idle" && (
                  <p role="status">
                    阻塞状态已变化或暂时无法读取，请关闭后重新查看。
                  </p>
                )}
              <OperationStatus manager={manager} error={error} />
            </>
          }
          onConfirm={async () => {
            await abandonInstanceWork(
              manager,
              target.instance,
              target.blocked.activationId,
              (outcome) => {
                if (outcome.kind === "ok") {
                  setTarget(undefined);
                  setNotice(
                    "已放弃本次工作。处理原因后，请发送新的请求；旧回复不会自动重发。",
                  );
                  onChanged();
                } else if (outcome.kind === "rejected") {
                  setError(String(outcome.error));
                  onChanged();
                }
              },
            );
          }}
        />
      )}
    </>
  );
}
