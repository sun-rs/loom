import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useDialogProtocol } from "../dialog-protocol.ts";

/** Raft MachineDetailPanel Na -> zi: confirm before the batch stop action. */
export function ComputerStopConfirmation({
  count,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  count: number;
  pending: boolean;
  error: string | undefined;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const ref = useDialogProtocol({ blocked: pending, onClose });
  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        className="rah-dialog-backdrop"
        aria-label="关闭停止确认"
        disabled={pending}
        onClick={onClose}
      />
      {/* Existing zi confirmation chrome owner, also used by channel confirmations. */}
      <section
        className="rah-dialog rah-channel-confirmation"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rah-computer-stop-title"
        aria-busy={pending}
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <h2 id="rah-computer-stop-title">停止 Agent</h2>
          <button
            className="sq-btn"
            aria-label="关闭"
            disabled={pending}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <p>要停止选中的 {count} 个在线 Agent 吗？它们会停止处理消息。</p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button className="btn" disabled={pending} onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-orange"
            disabled={pending}
            onClick={() => void onConfirm()}
          >
            {pending ? "正在停止…" : "停止 Agent"}
          </button>
        </footer>
      </section>
    </div>
  );
}
