import { DialogLayer } from "@rah-os/ui-web/neo-brutalist/dialog-layer";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useDialogProtocol } from "../dialog-protocol.ts";

/** User-requested confirmation; presentation uses the existing Raft Ki owner. */
export function ServiceRestartConfirmation({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useDialogProtocol({ blocked: false, onClose });
  return (
    <DialogLayer className="rah-dialog-layer" role="presentation">
      <button
        className="rah-dialog-backdrop"
        aria-label="关闭重启服务确认"
        onClick={onClose}
      />
      <section
        className="rah-dialog rah-channel-confirmation rah-service-restart-confirmation"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rah-service-restart-title"
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <h2 id="rah-service-restart-title">重启服务</h2>
          <button className="sq-btn" aria-label="关闭" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        <p>
          确定要重启这台 Computer
          的服务吗？连接会暂时中断，页面将在服务恢复后自动重新连接。
        </p>
        <footer>
          <button className="btn" onClick={onClose} data-dialog-initial-focus>
            取消
          </button>
          <button className="btn btn-orange" onClick={onConfirm}>
            重启服务
          </button>
        </footer>
      </section>
    </DialogLayer>
  );
}
