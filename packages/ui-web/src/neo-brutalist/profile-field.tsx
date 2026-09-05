import { useRef, useState, useLayoutEffect } from "react";
import { ProfileSection } from "./profile-section.tsx";
import { Icon } from "./icon.tsx";

/** HumanDetailPanel description editor: local presentation only, source frozen at edit. */
export function ProfileField<Source>({
  label,
  value,
  source,
  onSave,
  maxLength = 3000,
  placeholder,
}: {
  label: string;
  value: string;
  source: Source;
  onSave?: ((value: string, source: Source) => Promise<void>) | undefined;
  maxLength?: number;
  placeholder?: string;
}) {
  const [edit, setEdit] = useState<{ value: string; source: Source }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const busy = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = input.current;
    if (element) {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
    }
  }, [edit?.value]);
  const close = () => {
    setEdit(undefined);
    setError(undefined);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const save = async () => {
    if (
      !edit ||
      !onSave ||
      busy.current ||
      edit.value.trim().length > maxLength
    )
      return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      await onSave(edit.value.trim(), edit.source);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，草稿已保留");
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return (
    <ProfileSection
      title={
        <>
          {label}
          {onSave && !edit && (
            <button
              type="button"
              className="rah-profile-edit rah-interaction-flat"
              ref={trigger}
              aria-label={`编辑${label}`}
              title={`编辑${label}`}
              onClick={() => {
                setEdit({ value, source });
                setError(undefined);
              }}
            >
              <Icon name="pencil" />
            </button>
          )}
        </>
      }
    >
      {edit ? (
        <form
          className="rah-profile-text-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <textarea
            ref={input}
            autoFocus
            aria-label={label}
            placeholder={placeholder}
            rows={3}
            maxLength={maxLength}
            disabled={pending}
            value={edit.value}
            onChange={(e) => setEdit({ ...edit, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.stopPropagation();
                if (!pending) close();
              }
            }}
          />
          <div>
            <button className="btn btn-pink" disabled={pending}>
              {pending ? "正在保存…" : "保存"}
            </button>
            <button
              className="btn"
              type="button"
              disabled={pending}
              onClick={close}
            >
              取消
            </button>
          </div>
          <footer>
            {error ? <span role="alert">{error}</span> : <span />}
            <span>
              {edit.value.trim().length}/{maxLength}
            </span>
          </footer>
        </form>
      ) : (
        <p className={value ? "rah-profile-description" : "rah-profile-empty"}>
          {value || "暂无描述"}
        </p>
      )}
    </ProfileSection>
  );
}
