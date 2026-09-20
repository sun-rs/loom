import { DialogLayer } from "@rah-os/ui-web/neo-brutalist/dialog-layer";
import { browserOpaqueId } from "../browser-opaque-id.ts";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RahClient } from "@rah-os/client-sdk";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useDialogProtocol } from "../dialog-protocol.ts";
export function ComputerWorkspaceDelete({
  client,
  id,
  name,
  onDeleted,
}: {
  client: RahClient | undefined;
  id: string;
  name: string;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        className="btn"
        aria-label={`删除 ${name} 工作区`}
        disabled={!client}
        ref={trigger}
        onClick={() => setOpen(true)}
      >
        <Icon name="trash-2" />
      </button>
      {open &&
        createPortal(
          <Confirm
            client={client!}
            id={id}
            name={name}
            onClose={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
            onDeleted={onDeleted}
          />,
          document.body,
        )}
    </>
  );
}
function Confirm({
  client,
  id,
  name,
  onClose,
  onDeleted,
}: {
  client: RahClient;
  id: string;
  name: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string>();
  const key = useRef(browserOpaqueId()),
    busy = useRef(false);
  const ref = useDialogProtocol({ blocked: pending, onClose });
  async function remove() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      await client.request("agent.memory.reset", {
        agentId: id,
        confirmation: "RESET_AGENT_MEMORY",
        idempotencyKey: key.current,
      });
      onDeleted();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <DialogLayer className="rah-dialog-layer rah-workspace-delete-confirm">
      <div className="rah-dialog-backdrop" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-delete-title"
        className="rah-dialog"
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <h2 id="workspace-delete-title">删除工作区</h2>
          <button
            className="sq-btn"
            aria-label="关闭"
            disabled={pending}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <p>
          删除「{name}」的工作区文件及私有记忆，同时清除旧会话续接。不会删除
          Agent 身份或聊天记录，也不会重启 Agent。运行中的工作必须先结束。
        </p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button className="btn" disabled={pending} onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-coral"
            disabled={pending}
            onClick={() => void remove()}
          >
            {pending ? "正在删除…" : "删除工作区"}
          </button>
        </footer>
      </section>
    </DialogLayer>
  );
}
