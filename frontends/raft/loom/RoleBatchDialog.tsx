import { useMemo, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { RoleTemplate } from "@rah-os/protocol";
import { ManagementClient, type Instance } from "./management-client.ts";
import {
  OperationStatus,
  SelectField,
  useManagement,
} from "./ManagementUi.tsx";
import ConfirmDialog from "../packages/web/src/components/ConfirmDialog.tsx";
import { runRoleBatch, type BatchRow } from "./role-batch.ts";
export type RoleBatchAction = "stop" | "restart" | "enable";
export default function RoleBatchDialog({
  client,
  workspaceId,
  controlRoomId,
  role,
  instances,
  action,
  onClose,
  onChanged,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
  role: RoleTemplate;
  instances: readonly (Instance & { name: string })[];
  action: RoleBatchAction;
  onClose: () => void;
  onChanged: () => void;
}) {
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId),
    [client, workspaceId, controlRoomId],
  );
  const { state, error } = useManagement(manager);
  const [revision, setRevision] = useState("keep");
  const [rows, setRows] = useState<BatchRow[]>();
  const [running, setRunning] = useState(false);
  const title =
    action === "stop"
      ? "停止所有实例"
      : action === "enable"
        ? "启用所有实例"
        : "重启／重置所有实例";
  const labels: Record<string, string> = {
    ok: "已完成",
    rejected: "被拒绝",
    unknown: "结果未知",
    notSent: "未发送",
    "not-run": "未执行",
    busy: "未执行：操作繁忙",
    stale: "上下文已变化",
  };
  return (
    <ConfirmDialog
      title={title}
      confirmLabel={title}
      confirmVariant={action === "stop" ? "warning" : "primary"}
      plainMessage
      closeOnConfirm={false}
      confirmDisabled={
        running || state !== "idle" || Boolean(rows) || !instances.length
      }
      onClose={() => {
        if (!running && state === "idle") onClose();
      }}
      message={
        <div className="space-y-3">
          <p>
            {action === "stop"
              ? "阻止这些实例的后续调度，并请求终止当前执行；会话、频道历史和记忆保留。"
              : action === "enable"
                ? "恢复这些实例的调度，沿用原会话，不清空上下文。"
                : "为这些实例创建新原生会话，保留频道历史和记忆。近期历史按窗口补入，较早内容按需读取；正在执行或清理未完成的实例会被拒绝。此操作不会自动启用已停止的实例。"}
          </p>
          <p>
            本次操作 {instances.length}{" "}
            个实例。遇到拒绝或结果未知即停止；已成功的操作不会回滚。
          </p>
          {action === "restart" && (
            <SelectField
              label="重启配置"
              value={revision}
              disabled={running || Boolean(rows)}
              onChange={setRevision}
              options={[
                { value: "keep", label: "保留各实例当前名称和配置" },
                {
                  value: role.roleRevisionId,
                  label: "采用当前角色修订（名称、Prompt、CLI、模型）",
                },
              ]}
            />
          )}
          <ul className="space-y-1">
            {instances.map((i) => {
              const row = rows?.find((r) => r.instanceId === i.instanceId);
              return (
                <li key={i.instanceId}>
                  {i.name}
                  {row
                    ? `：${labels[row.status] ?? row.status}${row.detail ? " · " + row.detail : ""}`
                    : ""}
                </li>
              );
            })}
          </ul>
          <OperationStatus manager={manager} error={error} />
        </div>
      }
      onConfirm={async () => {
        if (running || rows) return;
        setRunning(true);
        try {
          await runRoleBatch(
            instances,
            (i) => {
              const settled = (outcome: { kind: string; error?: unknown }) =>
                setRows((current) =>
                  current?.map((row) =>
                    row.instanceId === i.instanceId
                      ? {
                          instanceId: row.instanceId,
                          status: outcome.kind,
                          ...(outcome.error
                            ? {
                                detail:
                                  outcome.error instanceof Error
                                    ? outcome.error.message
                                    : String(outcome.error),
                              }
                            : {}),
                        }
                      : row,
                  ),
                );
              return action === "restart"
                ? manager.instance(
                    "restart",
                    i.channelId,
                    i.instanceId,
                    settled,
                    revision === "keep" ? undefined : revision,
                  )
                : manager.setEnabled(i.agentId, action === "enable", settled);
            },
            setRows,
          );
        } finally {
          setRunning(false);
          onChanged();
        }
      }}
    />
  );
}
