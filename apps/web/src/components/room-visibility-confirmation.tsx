import { DialogLayer } from "@rah-os/ui-web/neo-brutalist/dialog-layer";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useDialogProtocol } from "../dialog-protocol.ts";

export function RoomVisibilityConfirmation({
  blocked,
  error,
  name,
  visibility,
  onCancel,
  onConfirm,
}: {
  blocked: boolean;
  error: string | undefined;
  name: string;
  visibility: "public" | "private";
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const ref = useDialogProtocol({ blocked, onClose: onCancel });
  const label = visibility === "public" ? "公开" : "私密";
  return (
    <DialogLayer
      className="rah-dialog-layer rah-room-visibility-confirm"
      role="presentation"
    >
      <div aria-hidden="true" className="rah-dialog-backdrop" />
      <section
        aria-labelledby="rah-room-visibility-title"
        aria-modal="true"
        className="rah-dialog rah-channel-confirmation"
        ref={ref}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <h2 id="rah-room-visibility-title">将频道设为{label}</h2>
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
          {visibility === "public"
            ? `工作空间成员将恢复对「${name}」的读取权限。已加入的人类和 Agent 会保持加入状态。`
            : `「${name}」将仅对已加入的成员可见。已加入的人类和 Agent 会保持加入状态。`}
        </p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button className="btn" disabled={blocked} onClick={onCancel}>
            取消
          </button>
          <button
            className="btn btn-orange"
            disabled={blocked}
            onClick={() => void onConfirm()}
          >
            {blocked ? "正在更新…" : label}
          </button>
        </footer>
      </section>
    </DialogLayer>
  );
}
