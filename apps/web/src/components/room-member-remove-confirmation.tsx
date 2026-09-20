import { DialogLayer } from "@rah-os/ui-web/neo-brutalist/dialog-layer";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useDialogProtocol } from "../dialog-protocol.ts";

/** Raft act → Ki: confirmation before the existing membership mutation. */
export function RoomMemberRemoveConfirmation({
  name,
  roomName,
  blocked,
  error,
  onCancel,
  onConfirm,
}: {
  name: string;
  roomName: string;
  blocked: boolean;
  error: string | undefined;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useDialogProtocol({ blocked, onClose: onCancel });
  return (
    <DialogLayer
      className="rah-dialog-layer rah-room-visibility-confirm"
      role="presentation"
    >
      <div aria-hidden="true" className="rah-dialog-backdrop" />
      <section
        ref={ref}
        className="rah-dialog rah-channel-confirmation rah-member-remove-confirmation"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rah-member-remove-title"
        tabIndex={-1}
      >
        <header>
          <h2 id="rah-member-remove-title">移除成员</h2>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={blocked}
            onClick={onCancel}
          >
            <Icon name="x" />
          </button>
        </header>
        <p>
          {name} 将停止接收 #{roomName}{" "}
          的常规消息，并且在重新加入前无法读取或发送此频道的消息，已关注的消息列也不会继续通知。
          已有消息与关注记录会保留，重新加入后按当前权限恢复访问。
        </p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button className="btn" disabled={blocked} onClick={onCancel}>
            取消
          </button>
          <button
            className="btn btn-red"
            disabled={blocked}
            onClick={onConfirm}
          >
            {blocked ? "正在移除…" : "移除"}
          </button>
        </footer>
      </section>
    </DialogLayer>
  );
}
