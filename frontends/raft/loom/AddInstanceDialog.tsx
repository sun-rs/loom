import MobileFormDialog from "./MobileFormDialog";
import { DialogCommit } from "raft-ui/wip";
import { uiActionProps } from "./ui-action-props.ts";
import { useEffect, useMemo, useState } from "react";
import { DialogFooter, Button, Spinner } from "raft-ui";
import {
  ChannelMemberListShell,
  ChannelMemberRow,
} from "../packages/web/src/components/channel/ChannelMemberList.tsx";
import type { RoleListResponse } from "@rah-os/protocol";
import type { LoomChannelClient } from "./channel-client.ts";
import { LoomInstanceClient } from "./instances.ts";

/** Local Role semantics in the official member-list/dialog presentation. */
export default function AddInstanceDialog({
  target,
  controlRoomId,
  onClose,
}: {
  target: { bridge: LoomChannelClient; name: string };
  controlRoomId: string;
  onClose: () => void;
}) {
  const manager = useMemo(
    () => new LoomInstanceClient(target.bridge.client, target.bridge.room),
    [target.bridge],
  );
  const [state, setState] = useState(manager.writes.state);
  const [catalog, setCatalog] = useState<RoleListResponse>();
  const [roleId, setRoleId] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const stop = manager.writes.onChange(setState);
    return () => {
      stop();
      manager.writes.discard();
    };
  }, [manager]);
  useEffect(() => {
    const abort = new AbortController();
    setCatalog(undefined);
    setError("");
    void target.bridge.client
      .request("role.list", { controlRoomId }, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setCatalog(value);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("角色暂时无法读取，请重试。");
      });
    return () => abort.abort();
  }, [target.bridge, controlRoomId, attempt]);
  const submit = () => {
    if (!roleId || manager.writes.state !== "idle" || !catalog) return;
    setError("");
    void manager
      .add(roleId, (outcome) => {
        if (outcome.kind === "ok") onClose();
        else if (outcome.kind === "rejected")
          setError("添加被拒绝，请检查角色和频道是否仍可用后重试。");
      })
      .catch(() => setError("无法添加实例，请重试。"));
  };
  return (
    <MobileFormDialog
      title={`添加实例 · ${target.name}`}
      testId="loom-add-instance-dialog"
      busy={state !== "idle"}
      onClose={() => {
        if (manager.writes.state === "idle") onClose();
      }}
    >
      <p className="mb-3 text-sm">
        选择角色，为此频道创建一个新实例。同一角色可以添加多次。
      </p>
      {error && <p role="alert">{error}</p>}
      {!catalog ? (
        error ? (
          <Button
            {...uiActionProps.recovery}
            onClick={() => setAttempt((n) => n + 1)}
          >
            重新读取角色
          </Button>
        ) : (
          <Spinner aria-label="正在读取角色" />
        )
      ) : !catalog.roles.length ? (
        <p>暂无角色，请先在 Agent 页创建。</p>
      ) : (
        <ChannelMemberListShell>
          {catalog.roles.map((role) => (
            <ChannelMemberRow
              key={role.roleId}
              type="agent"
              name={role.configuration.displayName ?? role.configuration.handle}
              onRowClick={
                state === "idle" ? () => setRoleId(role.roleId) : undefined
              }
              secondary={
                <span>
                  本频道已有{" "}
                  {
                    catalog.instances.filter(
                      (i) =>
                        i.roleId === role.roleId &&
                        i.channelId === target.bridge.roomId,
                    ).length
                  }{" "}
                  个实例
                </span>
              }
              trailing={<span>{roleId === role.roleId ? "已选择" : ""}</span>}
            />
          ))}
        </ChannelMemberListShell>
      )}
      {state === "unknown" && (
        <div role="alert" className="mt-3">
          添加结果未知，请核实原请求。
          <Button
            {...uiActionProps.recovery}
            onClick={() =>
              void manager.writes
                .retry()
                .catch(() => setError("暂时无法核实，请稍后重试。"))
            }
          >
            核实添加结果
          </Button>
        </div>
      )}
      <DialogFooter>
        <DialogCommit
          {...uiActionProps.dialogSave}
          className="mt-3"
          disabled={!catalog || !roleId || state !== "idle"}
          onClick={submit}
        >
          {state === "pending" ? "正在添加…" : "添加到频道"}
        </DialogCommit>
      </DialogFooter>
    </MobileFormDialog>
  );
}
