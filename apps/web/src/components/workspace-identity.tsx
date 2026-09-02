import { useEffect, useState } from "react";
import { opaqueIdFromBytes } from "@rah-os/ui-web";
import type { RahClient } from "@rah-os/client-sdk";
import type { Workspace } from "@rah-os/protocol";
import avatarPack from "@rah-os/ui-tokens/avatar-pack.json";
import { workspaceInitial } from "../identity-presentation.ts";
import { useDialogProtocol } from "../dialog-protocol.ts";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";

export function WorkspaceIdentity({
  computerName,
  workspace,
  workspaces,
  client,
  canManage,
  onUpdated,
  onSelect,
}: {
  computerName?: string | undefined;
  workspace: Workspace | undefined;
  workspaces: readonly Workspace[];
  client: RahClient;
  canManage: boolean;
  onUpdated: (workspace: Workspace) => void;
  onSelect: (workspace: Workspace) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="rail-logo rah-space-mark"
        aria-label={`计算机：${computerName ?? workspace?.name ?? "加载中"}`}
        title={computerName ?? workspace?.name ?? "计算机"}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {workspace?.avatarKey ? (
          <ProfileImageAvatar
            avatarKey={workspace.avatarKey}
            name={workspace.name}
            size="header"
          />
        ) : (
          workspaceInitial(computerName ?? workspace?.name ?? "")
        )}
      </button>
      {open && workspace ? (
        <WorkspaceIdentityDialog
          key={workspace.workspaceId}
          workspace={workspace}
          workspaces={workspaces}
          client={client}
          canManage={canManage}
          onClose={() => setOpen(false)}
          onUpdated={onUpdated}
          onSelect={(w) => {
            onSelect(w);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function WorkspaceIdentityDialog({
  workspace,
  workspaces,
  client,
  canManage,
  onClose,
  onUpdated,
  onSelect,
}: {
  workspace: Workspace;
  workspaces: readonly Workspace[];
  client: RahClient;
  canManage: boolean;
  onClose: () => void;
  onUpdated: (workspace: Workspace) => void;
  onSelect: (workspace: Workspace) => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [avatarKey, setAvatarKey] = useState(workspace.avatarKey ?? "");
  const [pending, setPending] = useState(false);
  const [baseline, setBaseline] = useState<number>();
  const [mutationId] = useState(() =>
    opaqueIdFromBytes(crypto.getRandomValues(new Uint8Array(16))),
  );
  const [error, setError] = useState<string>();
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  useEffect(() => {
    if (!workspace.controlRoomId) return;
    const controller = new AbortController();
    void client
      .request(
        "room.sync",
        {
          roomId: workspace.controlRoomId,
          consumerId: `workspace-identity-${mutationId}`,
          afterSeq: 0,
          limit: 1,
        },
        { signal: controller.signal },
      )
      .then(async (sync) => {
        const current = await client.request(
          "workspace.list",
          {},
          { signal: controller.signal },
        );
        const canonical = current.workspaces.find(
          (w) => w.workspaceId === workspace.workspaceId,
        );
        if (!controller.signal.aborted && canonical) {
          setName(canonical.name);
          setAvatarKey(canonical.avatarKey ?? "");
          setBaseline(sync.latestRoomSeq);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "无法读取空间版本");
      });
    return () => controller.abort();
  }, [client, workspace.controlRoomId, workspace.workspaceId, mutationId]);
  async function save() {
    if (
      !workspace.controlRoomId ||
      !canManage ||
      pending ||
      baseline === undefined
    )
      return;
    setPending(true);
    setError(undefined);
    try {
      // Freeze the causal baseline, never silently overwrite a concurrent edit.
      const response = await client.request("workspace.update", {
        workspaceId: workspace.workspaceId,
        name,
        avatarKey: avatarKey || null,
        basedOnControlRoomSeq: baseline,
        idempotencyKey: mutationId,
      });
      onUpdated(response.workspace);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="rah-dialog-layer">
      <button
        className="rah-dialog-backdrop"
        aria-label="关闭空间设置背景"
        disabled={pending}
        onClick={onClose}
      />
      <section
        className="rah-dialog rah-space-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="协作空间"
        ref={dialogRef}
        tabIndex={-1}
      >
        <header>
          <h2>协作空间</h2>
          <button
            className="sq-btn"
            aria-label="关闭"
            disabled={pending}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="rah-space-list">
          {workspaces.map((w) => (
            <button
              key={w.workspaceId}
              aria-pressed={workspace.workspaceId === w.workspaceId}
              disabled={pending}
              onClick={() => onSelect(w)}
            >
              {workspaceInitial(w.name)} · {w.name}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            空间名称
            <input
              aria-label="空间名称"
              required
              maxLength={120}
              value={name}
              disabled={!canManage || pending || baseline === undefined}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            空间头像
            <select
              aria-label="空间头像"
              value={avatarKey}
              disabled={!canManage || pending || baseline === undefined}
              onChange={(e) => setAvatarKey(e.target.value)}
            >
              <option value="">名称首字母</option>
              {avatarKey && !(avatarKey in avatarPack.presets) ? (
                <option value={avatarKey}>当前上传头像</option>
              ) : null}
              {Object.keys(avatarPack.presets).map((key) => (
                <option value={key} key={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <footer>
            <button
              type="button"
              className="btn"
              disabled={pending}
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="btn primary"
              disabled={
                !canManage || pending || baseline === undefined || !name.trim()
              }
            >
              {pending ? "保存中…" : "保存更改"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
