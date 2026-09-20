import { DialogLayer } from "@rah-os/ui-web/neo-brutalist/dialog-layer";
import { createPortal } from "react-dom";
import { useEffect, useState, type ComponentType } from "react";
import type { Props as EmojiPickerProps } from "emoji-picker-react";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import {
  InteractivePopover,
  InteractivePopoverTrigger,
  InteractivePopoverContent,
} from "@rah-os/ui-web/neo-brutalist/interactive-popover";
import { useDialogProtocol } from "../dialog-protocol.ts";
import "./section-create-dialog.css";

export function SectionCreateDialog({
  initial,
  onSubmit,
  onClose,
}: {
  initial?: { name: string; emoji?: string | null | undefined };
  onSubmit: (name: string, emoji: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? ""),
    [emoji, setEmoji] = useState(initial?.emoji ?? ""),
    [open, setOpen] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string>();
  const dialog = useDialogProtocol({ blocked: pending || open, onClose });
  return createPortal(
    <DialogLayer className="rah-dialog-layer rah-section-create-layer">
      <button
        className="rah-dialog-backdrop"
        aria-label="关闭新建分区窗口"
        disabled={pending}
        onClick={onClose}
      />
      <section
        ref={dialog}
        className="rah-dialog rah-section-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={initial ? "重命名 / 更换图标" : "新建分区"}
        tabIndex={-1}
      >
        <header>
          <h2>{initial ? "重命名 / 更换图标" : "新建分区"}</h2>
          <button
            type="button"
            className="btn rah-section-close"
            aria-label="关闭"
            disabled={pending}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (pending || !name.trim()) return;
            setPending(true);
            setError(undefined);
            try {
              await onSubmit(name.trim(), emoji || null);
            } catch (e) {
              setError(e instanceof Error ? e.message : "保存失败");
            } finally {
              setPending(false);
            }
          }}
        >
          <div>
            <label htmlFor="rah-section-name">名称</label>
            <div className="rah-section-name-field">
              <InteractivePopover open={open} onOpenChange={setOpen}>
                <InteractivePopoverTrigger
                  render={
                    <button
                      type="button"
                      className="rah-section-emoji-trigger"
                      aria-label={
                        emoji ? `更改分区表情 ${emoji}` : "选择分区表情"
                      }
                      disabled={pending}
                    >
                      {emoji || <Icon name="smile-plus" />}
                    </button>
                  }
                />
                <InteractivePopoverContent
                  blocked={false}
                  label="选择分区表情"
                  className="rah-section-emoji-popover"
                >
                  <SectionEmojiContents
                    value={emoji}
                    onChange={(v) => {
                      setEmoji(v);
                      setOpen(false);
                    }}
                  />
                </InteractivePopoverContent>
              </InteractivePopover>
              <input
                id="rah-section-name"
                aria-label="名称"
                placeholder="我的项目"
                maxLength={80}
                autoFocus
                data-dialog-initial-focus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
          {error && <p role="alert">{error}</p>}
          <footer>
            <button
              type="button"
              className="btn"
              disabled={pending}
              onClick={onClose}
            >
              取消
            </button>
            <button className="btn btn-pink" disabled={pending || !name.trim()}>
              {pending ? "保存中…" : initial ? "保存" : "创建分区"}
            </button>
          </footer>
        </form>
      </section>
    </DialogLayer>,
    document.body,
  );
}
function SectionEmojiContents({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [Picker, setPicker] = useState<ComponentType<EmojiPickerProps>>(),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void import("emoji-picker-react")
      .then((m) => {
        // Native glyphs keep the picker usable under the local-only image CSP.
        if (active)
          setPicker(() => (props: EmojiPickerProps) => (
            <m.default {...props} emojiStyle={m.EmojiStyle.NATIVE} />
          ));
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  return (
    <>
      {value && (
        <button
          type="button"
          className="rah-section-no-emoji"
          onClick={() => onChange("")}
        >
          <Icon name="x" />
          不使用表情
        </button>
      )}
      {Picker ? (
        <Picker
          width="min(340px, calc(100vw - 48px))"
          height={360}
          lazyLoadEmojis
          previewConfig={{ showPreview: false }}
          onEmojiClick={(data) => onChange(data.emoji)}
        />
      ) : failed ? (
        <button type="button" onClick={() => setRetry((v) => v + 1)}>
          加载表情失败，点击重试
        </button>
      ) : (
        <p role="status">正在加载表情…</p>
      )}
    </>
  );
}
