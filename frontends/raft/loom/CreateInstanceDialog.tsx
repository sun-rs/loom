import { useEffect, useMemo, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import MobileFormDialog from "./MobileFormDialog";
import { DialogCommit } from "raft-ui/wip";
import { Button, DialogFooter } from "raft-ui";
import { ManagementClient, type Catalog } from "./management-client.ts";
import {
  SelectField,
  useManagement,
  OperationStatus,
} from "./ManagementUi.tsx";
/** Same explicit Role -> channel instance mutation as AgentPage; no Role save,
 * automatic DM, or new execution owner. Local-computer scope matches inventory. */
export default function CreateInstanceDialog({
  client,
  workspaceId,
  controlRoomId,
  onClose,
  onChanged,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId),
    [client, workspaceId, controlRoomId],
  );
  const { state, error, setError } = useManagement(manager);
  const [catalog, setCatalog] = useState<Catalog>();
  const [roleId, setRoleId] = useState("");
  const [channel, setChannel] = useState("");
  useEffect(() => {
    let alive = true;
    void manager
      .catalog()
      .then((c) => {
        if (alive) setCatalog(c);
      })
      .catch(() => {
        if (alive) setError("无法读取角色和频道，请关闭后重试。");
      });
    return () => {
      alive = false;
    };
  }, [manager, setError]);
  const busy = state !== "idle";
  return (
    <MobileFormDialog
      busy={busy}
      title="新建实例"
      onClose={() => {
        if (!busy) onClose();
      }}
      testId="loom-create-instance"
    >
      <div className="space-y-4">
        <SelectField
          label="角色"
          value={roleId}
          onChange={setRoleId}
          disabled={busy || !catalog}
          options={(catalog?.roles ?? []).map((r) => ({
            value: r.roleId,
            label: r.configuration.displayName,
          }))}
        />
        <SelectField
          label="频道"
          value={channel}
          onChange={setChannel}
          disabled={busy || !catalog}
          options={(catalog?.rooms ?? [])
            .filter((r) => r.kind === "channel" && !r.archivedAt)
            .map((r) => ({ value: r.roomId, label: r.name }))}
        />
        <OperationStatus manager={manager} error={error} />
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <DialogCommit
            disabled={busy || !roleId || !channel}
            onClick={() =>
              void manager.instance("add", channel, roleId, (result) => {
                if (result.kind === "ok") {
                  onChanged();
                  onClose();
                } else if (result.kind === "rejected")
                  setError(`添加实例被拒绝：${String(result.error)}`);
              })
            }
          >
            确认添加
          </DialogCommit>
        </DialogFooter>
      </div>
    </MobileFormDialog>
  );
}
