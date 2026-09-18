import { useRef, type ChangeEvent, type ReactNode } from "react";
import { Icon } from "./icon.tsx";

/** The plus button is always the daemon Computer path. Mobile gets one native upload input. */
export function ComposerAttachmentPickers({
  disabled,
  uploadsDisabled = disabled,
  mobile,
  onComputer,
  browser,
  onFiles,
}: {
  disabled: boolean;
  uploadsDisabled?: boolean;
  mobile: boolean;
  onComputer: () => void;
  browser: ReactNode;
  onFiles: (files: readonly File[]) => void;
}) {
  const files = useRef<HTMLInputElement>(null);
  const select = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const selected = Array.from(input.files ?? []);
    input.value = "";
    if (uploadsDisabled || !selected.length) return;
    input.closest("form")?.querySelector("textarea")?.blur();
    onFiles(selected);
  };
  const nativeInput = (
    <input
      ref={files}
      disabled={uploadsDisabled}
      type="file"
      aria-label="选择附件"
      aria-hidden={mobile || undefined}
      tabIndex={-1}
      multiple
      hidden={!mobile}
      className={mobile ? "rah-composer-native-input" : undefined}
      onChange={select}
    />
  );
  return (
    <div className="rah-composer-pickers">
      <button
        className="sq-btn rah-composer-picker"
        type="button"
        aria-label="添加引用或附件"
        title="引用文件或文件夹"
        disabled={disabled}
        onPointerDown={(event) => event.preventDefault()}
        onClick={onComputer}
      >
        <Icon name="plus" />
      </button>
      {mobile ? (
        <span
          className="sq-btn rah-composer-picker rah-composer-native-picker"
          role="button"
          tabIndex={uploadsDisabled ? -1 : 0}
          aria-label="上传此设备的文件"
          title="上传此设备的文件"
          aria-disabled={uploadsDisabled}
          onClick={(event) => {
            // Border/assistive activation targets the wrapper; native input clicks
            // bubble here too and must never open a second picker.
            if (event.target === event.currentTarget && !uploadsDisabled)
              files.current?.click();
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" || event.key === " ")
              event.preventDefault();
            if (event.key === "Enter" && !event.repeat && !uploadsDisabled)
              files.current?.click();
          }}
          onKeyUp={(event) => {
            if (
              event.target === event.currentTarget &&
              event.key === " " &&
              !uploadsDisabled
            ) {
              event.preventDefault();
              files.current?.click();
            }
          }}
        >
          <Icon name="clip" />
          {nativeInput}
        </span>
      ) : (
        nativeInput
      )}
      {browser}
    </div>
  );
}
