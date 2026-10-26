// Official db5e399 CreateAgentDialog composition; Role save and optional instance
// creation remain separate authenticated Loom writes. No automatic DM/session.
import { useMemo, useRef, useState, useEffect } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import { RoleCreateResponseSchema, type RoleTemplate } from "@rah-os/protocol";
import { Button, Checkbox, DialogFooter } from "raft-ui";
import MobileFormDialog from "./MobileFormDialog";
import { DialogCommit } from "raft-ui/wip";
import RoleEditor from "./RoleEditor.tsx";
import { useDraftNavigation } from "./DraftNavigation.tsx";
import DiscardChangesDialog from "./DiscardChangesDialog.tsx";
import { ManagementClient, type Catalog } from "./management-client.ts";
import {
  useManagement,
  OperationStatus,
  SelectField,
} from "./ManagementUi.tsx";
export default function CreateRoleDialog({
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
  const [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState(false);
  const [add, setAdd] = useState(false),
    [channel, setChannel] = useState("");
  const [savedRole, setSavedRole] = useState<RoleTemplate>();
  const [adding, setAdding] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    void manager
      .catalog()
      .then((c) => {
        if (alive) setCatalog(c);
      })
      .catch(() => {
        if (alive) setError("无法读取角色和频道目录，请关闭后重试。");
      });
    return () => {
      alive = false;
    };
  }, [manager, setError]);
  useDraftNavigation(add && !savedRole, onClose);
  const busy = state !== "idle" || adding;
  const close = () => {
    if (busy) return;
    if (!savedRole && (dirty || add)) setDiscard(true);
    else onClose();
  };
  // Each completed save is retained even when the subsequent add is rejected.
  // A separate explicit confirmation prevents recreating the Role on retry.
  const attach = () => {
    if (!savedRole || !channel || busy) return;
    setAdding(true);
    setError("");
    void manager
      .instance("add", channel, savedRole.roleId, (outcome) => {
        setAdding(false);
        if (outcome.kind === "ok") {
          onChanged();
          onClose();
        } else if (outcome.kind === "rejected")
          setError(`角色已保存，添加实例被拒绝：${String(outcome.error)}`);
      })
      .finally(() => setAdding(false));
  };
  return (
    <>
      <MobileFormDialog
        busy={busy}
        title="新建角色"
        onClose={close}
        testId="loom-create-role"
      >
        <div ref={container}>
          {savedRole ? (
            <div className="space-y-4">
              <p role="status">
                角色“{savedRole.configuration.displayName}
                ”已保存。尚未创建实例。
              </p>
              <SelectField
                stable
                portalContainer={container}
                label="频道"
                value={channel}
                disabled={busy}
                onChange={setChannel}
                options={(catalog?.rooms ?? [])
                  .filter((r) => r.kind === "channel" && !r.archivedAt)
                  .map((r) => ({ value: r.roomId, label: r.name }))}
              />
              <DialogFooter>
                <Button
                  variant="ghost"
                  size="lg"
                  disabled={busy}
                  onClick={onClose}
                >
                  暂不添加
                </Button>
                <DialogCommit
                  variant="accent"
                  size="lg"
                  disabled={busy || !channel}
                  onClick={attach}
                >
                  确认添加实例
                </DialogCommit>
              </DialogFooter>
            </div>
          ) : (
            <RoleEditor
              creation
              client={client}
              disabled={busy || !catalog}
              submitDisabled={add && !channel}
              takenNames={catalog?.roles.map(
                (r) => r.configuration.displayName,
              )}
              portalContainer={container}
              onDirtyChange={setDirty}
              onNavigationDiscard={onClose}
              onCancel={close}
              beforeSubmit={
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-callout">
                    <Checkbox
                      checked={add}
                      disabled={busy}
                      onCheckedChange={(v) => setAdd(v === true)}
                    />
                    保存后添加到频道
                  </label>
                  {add && (
                    <SelectField
                      stable
                      portalContainer={container}
                      label="频道"
                      value={channel}
                      disabled={busy}
                      onChange={setChannel}
                      options={(catalog?.rooms ?? [])
                        .filter((r) => r.kind === "channel" && !r.archivedAt)
                        .map((r) => ({ value: r.roomId, label: r.name }))}
                    />
                  )}
                </div>
              }
              onSave={(configuration) => {
                setError("");
                void manager.save(configuration, undefined, (outcome) => {
                  if (outcome.kind === "ok") {
                    const result = RoleCreateResponseSchema.parse(
                      outcome.result,
                    );
                    onChanged();
                    if (add) setSavedRole(result.role);
                    else onClose();
                  } else if (outcome.kind === "rejected")
                    setError(`保存被拒绝：${String(outcome.error)}`);
                });
              }}
            />
          )}
          <OperationStatus manager={manager} error={error} />
        </div>
      </MobileFormDialog>
      {discard && (
        <DiscardChangesDialog
          onCancel={() => setDiscard(false)}
          onDiscard={onClose}
        />
      )}
    </>
  );
}
