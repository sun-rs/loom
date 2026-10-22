import { useMemo, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { RoleTemplate } from "@rah-os/protocol";
import { Button, Input } from "raft-ui";
import { RotateCcw } from "lucide-react";
import { ManagementClient } from "./management-client.ts";
import { ActionDialog, useManagement } from "./ManagementUi.tsx";
import FormField from "../packages/web/src/components/ui/FormField.tsx";
export default function RestoreRoleDialog({
  client,
  workspaceId,
  controlRoomId,
  role,
  onClose,
  onRestored,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
  role: RoleTemplate;
  onClose: () => void;
  onRestored: () => void;
}) {
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId),
    [client, workspaceId, controlRoomId],
  );
  const { state, error, setError } = useManagement(manager);
  const [name, setName] = useState(role.configuration.displayName);
  return (
    <ActionDialog
      title="恢复角色"
      manager={manager}
      error={error}
      onClose={onClose}
    >
      <p className="mb-4 text-callout">
        恢复原角色身份并生成新修订。已有实例保持原名称、配置及运行状态。名称已被占用时，请使用新名称；不会合并同名角色。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (state !== "idle" || !name.trim()) return;
          setError("");
          void manager.restoreRole(role, name.trim(), (outcome) => {
            if (outcome.kind === "ok") onRestored();
            else if (outcome.kind === "rejected")
              setError(`恢复被拒绝：${String(outcome.error)}`);
          });
        }}
      >
        <FormField label="名称">
          <Input
            aria-label="恢复后的角色名称"
            value={name}
            disabled={state !== "idle"}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </FormField>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={state !== "idle"}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            variant="accent"
            type="submit"
            disabled={state !== "idle" || !name.trim()}
          >
            <RotateCcw size={16} />
            确认恢复
          </Button>
        </div>
      </form>
    </ActionDialog>
  );
}
