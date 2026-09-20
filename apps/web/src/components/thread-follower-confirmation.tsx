import { DialogLayer } from "@rah-os/ui-web/neo-brutalist/dialog-layer";
import { createPortal } from "react-dom";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useDialogProtocol } from "../dialog-protocol.ts";

/** User-requested confirmation; reuse the shared Raft dialog/focus contract. */
export function ThreadFollowerConfirmation({
  name,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  name: string;
  busy: boolean;
  error: string | undefined;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useDialogProtocol({ blocked: busy, onClose });
  return createPortal(
    <DialogLayer className="rah-dialog-layer rah-room-visibility-confirm">
      <div
        className="rah-dialog-backdrop"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <section
        ref={ref}
        className="rah-dialog rah-channel-confirmation"
        role="dialog"
        aria-modal="true"
        aria-label="移除关注"
        tabIndex={-1}
      >
        <header>
          <h2>移除关注</h2>
          <button
            className="sq-btn"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <p>确认移除 {name} 对此消息列的关注？此操作不会将 Agent 移出频道。</p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button className="btn" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-orange"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "正在移除…" : "移除关注"}
          </button>
        </footer>
      </section>
    </DialogLayer>,
    document.body,
  );
}
