import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  profileEditorKeyAction,
  validProfileField,
  type AgentProfileEditInput,
  type AgentProfileField,
} from "../agent-profile-edit.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { ProfileSection } from "@rah-os/ui-web/neo-brutalist/profile-section";

/** Raft hc field editing contract. Parent keys this editor by durable Agent identity. */
export function AgentProfileFieldEditor({
  agentId,
  revisionId,
  field,
  value,
  onSave,
}: {
  agentId: string;
  revisionId: string | undefined;
  field: AgentProfileField;
  value: string;
  onSave?: ((input: AgentProfileEditInput) => Promise<void>) | undefined;
}) {
  const label = field === "displayName" ? "显示名称" : "描述";
  const [edit, setEdit] = useState<{ value: string; revisionId: string }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const descriptionInput = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = descriptionInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.max(40, Math.min(input.scrollHeight, 160))}px`;
  }, [edit?.value]);
  function close() {
    setEdit(undefined);
    setError(undefined);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  async function save() {
    if (
      !edit ||
      !onSave ||
      saving.current ||
      !validProfileField(field, edit.value)
    )
      return;
    saving.current = true;
    setPending(true);
    setError(undefined);
    try {
      await onSave({
        agentId,
        expectedRevisionId: edit.revisionId,
        field,
        value: edit.value.trim(),
      });
      close();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "保存失败，草稿已保留",
      );
    } finally {
      saving.current = false;
      setPending(false);
    }
  }
  function keyDown(
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    // Don't let a field's Escape dismiss the surrounding Agent inspector.
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
    }
    const action = profileEditorKeyAction(
      field,
      event.key,
      event.nativeEvent.isComposing || event.keyCode === 229,
      pending,
    );
    if (action === "save") {
      event.preventDefault();
      void save();
    } else if (action === "cancel") close();
  }
  return (
    <ProfileSection
      title={label}
      variant="field"
      divided={false}
      className="rah-agent-profile-field"
      action={
        !edit &&
        onSave &&
        revisionId !== undefined && (
          <button
            ref={trigger}
            className="rah-profile-edit rah-interaction-flat"
            aria-label={`编辑${label}`}
            title={`编辑${label}`}
            onClick={() => {
              setEdit({ value, revisionId });
              setError(undefined);
            }}
          >
            <Icon name="pencil" />
          </button>
        )
      }
    >
      {edit ? (
        <form
          className="rah-profile-field-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {field === "description" ? (
            <textarea
              ref={descriptionInput}
              rows={2}
              autoFocus
              aria-label={label}
              maxLength={2000}
              disabled={pending}
              value={edit.value}
              onChange={(event) =>
                setEdit({ ...edit, value: event.target.value })
              }
              onKeyDown={keyDown}
            />
          ) : (
            <input
              autoFocus
              aria-label={label}
              maxLength={128}
              disabled={pending}
              value={edit.value}
              onChange={(event) =>
                setEdit({ ...edit, value: event.target.value })
              }
              onKeyDown={keyDown}
            />
          )}
          {error && <p role="alert">{error}</p>}
          <div className="rah-profile-field-buttons">
            <button
              className="btn btn-pink"
              disabled={pending || !validProfileField(field, edit.value)}
            >
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
          {field === "description" && (
            <div className="rah-profile-field-count">
              {edit.value.trim().length}/2000
            </div>
          )}
        </form>
      ) : (
        <p className={!value ? "is-empty" : undefined}>{value || "暂无描述"}</p>
      )}
    </ProfileSection>
  );
}
