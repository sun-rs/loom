import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
/** Raft uct: centered identity stack; title leading-tight, subtitle text-xs. */
export function ChannelSettingsHeader({
  name,
  description,
  visibility,
  blocked,
  onClose,
}: {
  name: string;
  description: string;
  visibility: "private" | "public";
  blocked: boolean;
  onClose: () => void;
}) {
  return (
    <header className="rah-channel-settings-header">
      <span className="rah-visually-hidden">频道详情与设置</span>
      <button
        aria-label="关闭频道设置"
        className="btn rah-room-settings-mobile-close"
        disabled={blocked}
        onClick={onClose}
      >
        <Icon name="x" />
      </button>
      <div className="rah-channel-settings-identity">
        <h2 id="rah-room-members-title">
          <span>#{name}</span>
          <b>{visibility === "private" ? "私密" : "公开"}</b>
        </h2>
        {description !== "" && <p>{description}</p>}
      </div>
    </header>
  );
}
