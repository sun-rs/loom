import { useRef, type ChangeEvent } from "react";
import { Icon } from "./icon.tsx";

// Raft composer: separate media/file inputs, one selection path. See
// docs/design/composer-attachment-pickers.md for source and local boundaries.
export function ComposerAttachmentPickers({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: readonly File[]) => void;
}) {
  const media = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const select = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const selected = Array.from(input.files ?? []);
    input.value = "";
    if (disabled || !selected.length) return;
    input.closest("form")?.querySelector("textarea")?.blur();
    onFiles(selected);
  };
  return (
    <div className="rah-composer-pickers">
      <input
        ref={media}
        type="file"
        aria-label="选择媒体"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={select}
      />
      <input
        ref={files}
        type="file"
        aria-label="选择附件"
        multiple
        hidden
        onChange={select}
      />
      {[
        { label: "添加媒体", input: media, icon: "image-plus" },
        { label: "添加文件", input: files, icon: "clip" },
      ].map(({ label, input, icon }) => (
        <button
          key={label}
          className="sq-btn rah-composer-picker"
          type="button"
          aria-label={label}
          title={label}
          disabled={disabled}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (!disabled) input.current?.click();
          }}
        >
          <Icon name={icon} />
        </button>
      ))}
    </div>
  );
}
