import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Workspace } from "@rah-os/protocol";
import { browserOpaqueId } from "../browser-opaque-id.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useDialogProtocol } from "../dialog-protocol.ts";
import { SettingsSectionLabel } from "./settings-primitives.tsx";

export async function changeSystemChannel(
  client: RahClient,
  workspace: Workspace,
  hidden: boolean,
) {
  if (!workspace.controlRoomId) throw new Error("工作空间尚未就绪");
  const head = await client.request("room.sync", {
    roomId: workspace.controlRoomId,
    afterSeq: 0,
    limit: 1,
    consumerId: "system-channel-settings",
  });
  return client.request("workspace.system-channel.update", {
    workspaceId: workspace.workspaceId,
    hidden,
    basedOnRoomSeq: head.latestRoomSeq,
    idempotencyKey: browserOpaqueId(),
  });
}
export function SystemChannelSettings({
  client,
  workspace,
  canManage,
  onUpdated,
}: {
  client: RahClient;
  workspace: Workspace | undefined;
  canManage: boolean;
  onUpdated: () => void;
}) {
  const [saved, setSaved] = useState<boolean>();
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const writing = useRef(false);
  useEffect(() => {
    const ticket = ++generation.current;
    setSaved(undefined);
    setError(undefined);
    writing.current = false;
    setBusy(false);
    if (workspace && canManage)
      void client
        .request("workspace.system-channel.read", {
          workspaceId: workspace.workspaceId,
        })
        .then((x) => {
          if (ticket === generation.current) {
            setSaved(x.hidden);
            setDraft(x.hidden);
          }
        })
        .catch((e) => {
          if (ticket === generation.current) setError(String(e));
        });
    return () => {
      generation.current++;
    };
  }, [client, workspace?.workspaceId, canManage]);
  async function save() {
    if (
      !workspace ||
      !canManage ||
      writing.current ||
      saved === undefined ||
      draft === saved
    )
      return;
    const ticket = generation.current;
    writing.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await changeSystemChannel(client, workspace, draft);
      if (ticket === generation.current) {
        setSaved(result.hidden);
        onUpdated();
      }
    } catch (e) {
      if (ticket === generation.current)
        setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      if (ticket === generation.current) {
        writing.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="rah-system-channel-settings">
      <SettingsSectionLabel icon="eye">系统频道</SettingsSectionLabel>
      <div className="rah-system-channel-card">
        <label>
          <input
            type="checkbox"
            checked={draft}
            disabled={!canManage || saved === undefined || busy}
            onChange={(e) => setDraft(e.target.checked)}
          />
          <span>
            <strong>隐藏 #all 频道</strong>
            <p>
              启用后，#all 将从频道列表、搜索、发帖、成员和 Agent
              频道界面中消失。现有历史记录会被保留。
            </p>
          </span>
        </label>
        {error && <p role="alert">{error}</p>}
        <button
          className="btn btn-pink"
          disabled={
            !canManage || saved === undefined || busy || saved === draft
          }
          onClick={() => void save()}
        >
          {busy ? "正在保存…" : "保存"}
        </button>
      </div>
    </section>
  );
}
export function HideAllChannelAction({
  onHide,
  disabled,
}: {
  onHide: () => Promise<void>;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const writing = useRef(false);
  return (
    <>
      <button className="btn" disabled={disabled} onClick={() => setOpen(true)}>
        <Icon name="eye-off" />
        隐藏 #all
      </button>
      {open &&
        createPortal(
          <HideAllConfirmation
            busy={busy}
            error={error}
            onClose={() => setOpen(false)}
            onConfirm={async () => {
              if (writing.current) return;
              writing.current = true;
              setBusy(true);
              setError(undefined);
              try {
                await onHide();
                setOpen(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : "隐藏失败");
              } finally {
                writing.current = false;
                setBusy(false);
              }
            }}
          />,
          document.body,
        )}
    </>
  );
}
function HideAllConfirmation({
  busy,
  error,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  error: string | undefined;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const ref = useDialogProtocol({ blocked: busy, onClose });
  return (
    <div className="rah-dialog-layer rah-room-visibility-confirm">
      <div
        className="rah-dialog-backdrop"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <section
        className="rah-dialog rah-channel-confirmation rah-agent-state-confirmation"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="隐藏 #ALL"
        tabIndex={-1}
      >
        <header>
          <h2>隐藏 #ALL</h2>
          <button
            className="sq-btn"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <p>
          #all 将从频道列表中消失，工作空间成员和 Agent
          将无法在其中阅读或发送消息——包括你自己。已有的历史记录会保留。要恢复它，请前往
          设置 → 管理 → 系统频道，关闭「隐藏 #all 频道」。
        </p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button className="btn" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-orange"
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? "正在隐藏…" : "隐藏 #all"}
          </button>
        </footer>
      </section>
    </div>
  );
}
