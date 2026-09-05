import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import type {
  ClientComputerProfileUpdateRequest,
  LocalComputerObservation,
} from "@rah-os/protocol";
import {
  computerProfileEditorAction,
  normalizeComputerDescription,
  normalizeComputerName,
  type ComputerProfileField,
} from "../computer-profile-edit.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { ProfileSection } from "@rah-os/ui-web/neo-brutalist/profile-section";

type EditState = {
  baseDescription: string | null;
  baseName: string;
  draft: string;
  field: ComputerProfileField;
  revision: number;
};

export function ComputerProfileFields({
  canEdit,
  computer,
  hostId,
  onUpdate,
}: {
  canEdit: boolean;
  computer: LocalComputerObservation | undefined;
  hostId: string;
  onUpdate:
    ((input: ClientComputerProfileUpdateRequest) => Promise<void>) | undefined;
}) {
  const name = computer?.displayName ?? hostId;
  const description = computer?.description ?? null;
  const [edit, setEdit] = useState<EditState>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const nameTrigger = useRef<HTMLButtonElement>(null);
  const descriptionTrigger = useRef<HTMLButtonElement>(null);
  const saveAttempt = useRef<
    { idempotencyKey: string; signature: string } | undefined
  >(undefined);

  function begin(field: ComputerProfileField): void {
    setEdit({
      baseDescription: description,
      baseName: name,
      draft: field === "name" ? name : (description ?? ""),
      field,
      revision: computer?.profileRevision ?? 0,
    });
    setError(undefined);
  }

  function close(): void {
    const field = edit?.field;
    setEdit(undefined);
    setError(undefined);
    saveAttempt.current = undefined;
    requestAnimationFrame(() =>
      (field === "name" ? nameTrigger : descriptionTrigger).current?.focus(),
    );
  }

  async function save(): Promise<void> {
    if (edit === undefined || onUpdate === undefined || pending) return;
    const displayName =
      edit.field === "name" ? normalizeComputerName(edit.draft) : edit.baseName;
    const nextDescription =
      edit.field === "description"
        ? normalizeComputerDescription(edit.draft)
        : edit.baseDescription;
    if (displayName.length === 0 || displayName.length > 120) return;
    if (
      displayName === edit.baseName &&
      nextDescription === edit.baseDescription
    ) {
      close();
      return;
    }
    const signature = JSON.stringify({
      description: nextDescription,
      displayName,
      expectedRevision: edit.revision,
      hostId,
    });
    if (saveAttempt.current?.signature !== signature) {
      saveAttempt.current = {
        idempotencyKey: crypto.randomUUID(),
        signature,
      };
    }
    setPending(true);
    setError(undefined);
    try {
      await onUpdate({
        description: nextDescription,
        displayName,
        expectedRevision: edit.revision,
        hostId,
        idempotencyKey: saveAttempt.current.idempotencyKey,
      });
      close();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "保存失败，草稿已保留",
      );
    } finally {
      setPending(false);
    }
  }

  function keyDown(
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void {
    if (edit === undefined) return;
    const action = computerProfileEditorAction(
      edit.field,
      event.key,
      event.metaKey,
      event.ctrlKey,
      event.nativeEvent.isComposing || event.keyCode === 229,
    );
    if (action === "save") {
      event.preventDefault();
      void save();
    } else if (action === "cancel") {
      event.preventDefault();
      close();
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    void save();
  }

  return (
    <>
      <ProfileSection
        title="名称"
        variant="field"
        className="rah-computer-field"
        action={
          edit === undefined && canEdit && onUpdate !== undefined ? (
            <button
              aria-label="编辑计算机名称"
              className="rah-profile-edit rah-interaction-flat"
              onClick={() => begin("name")}
              ref={nameTrigger}
              title="编辑计算机名称"
              type="button"
            >
              <Icon name="pencil" />
            </button>
          ) : null
        }
      >
        {edit?.field === "name" ? (
          <form className="rah-computer-profile-form" onSubmit={submit}>
            <input
              aria-label="计算机名称"
              autoFocus
              disabled={pending}
              maxLength={120}
              onChange={(event) =>
                setEdit({
                  ...edit,
                  draft: event.target.value.replaceAll(/[\r\n]+/gu, " "),
                })
              }
              onKeyDown={keyDown}
              value={edit.draft}
            />
            <ComputerProfileActions
              error={error}
              pending={pending}
              saveDisabled={normalizeComputerName(edit.draft).length === 0}
              onCancel={close}
            />
          </form>
        ) : (
          <p>{name}</p>
        )}
      </ProfileSection>
      <ProfileSection
        title="描述"
        variant="field"
        className="rah-computer-field"
        action={
          edit === undefined && canEdit && onUpdate !== undefined ? (
            <button
              aria-label="编辑计算机描述"
              className="rah-profile-edit rah-interaction-flat"
              onClick={() => begin("description")}
              ref={descriptionTrigger}
              title="编辑计算机描述"
              type="button"
            >
              <Icon name="pencil" />
            </button>
          ) : null
        }
      >
        {edit?.field === "description" ? (
          <form className="rah-computer-profile-form" onSubmit={submit}>
            <textarea
              aria-label="计算机描述"
              autoFocus
              disabled={pending}
              maxLength={500}
              onChange={(event) =>
                setEdit({ ...edit, draft: event.target.value })
              }
              onKeyDown={keyDown}
              value={edit.draft}
            />
            <span className="rah-computer-profile-count">
              {edit.draft.length}/500
            </span>
            <ComputerProfileActions
              error={error}
              pending={pending}
              saveDisabled={false}
              onCancel={close}
            />
          </form>
        ) : (
          <p className={description === null ? "is-muted" : undefined}>
            {description ?? "暂无描述"}
          </p>
        )}
      </ProfileSection>
    </>
  );
}

function ComputerProfileActions({
  error,
  onCancel,
  pending,
  saveDisabled,
}: {
  error: string | undefined;
  onCancel: () => void;
  pending: boolean;
  saveDisabled: boolean;
}) {
  return (
    <>
      {error ? (
        <p className="rah-computer-profile-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="rah-computer-profile-actions">
        <button
          className="btn btn-pink"
          disabled={pending || saveDisabled}
          type="submit"
        >
          {pending ? "正在保存…" : "保存"}
        </button>
        <button
          className="btn"
          disabled={pending}
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
      </div>
    </>
  );
}
