import {
  editableRolePrompt,
  patchRoleText,
  patchRoleDescription,
} from "./role-profile-values.ts";
// Loom Revision binding around official AgentProfileEditDialog field/preset composition.
import { useState, useEffect, useId, type RefObject } from "react";
import { DialogCommit } from "raft-ui/wip";
import { Button, Input, Textarea, DialogFooter } from "raft-ui";
import type { RahClient } from "@rah-os/client-sdk";
import {
  RoleConfigurationSchema,
  type RoleTemplate,
  type RoleCreateRequest,
} from "@rah-os/protocol";
import RoleEditor from "./RoleEditor.tsx";
import { useDraftNavigation } from "./DraftNavigation.tsx";
import AvatarLibraryPicker from "./AvatarLibraryPicker";
import FormField from "../packages/web/src/components/ui/FormField.tsx";
export type RoleField =
  | "displayName"
  | "instructions"
  | "description"
  | "runtimeOfferId"
  | "modelBindingId"
  | "avatarKey";
export default function RoleFieldEditor({
  field,
  role,
  client,
  disabled,
  onSave,
  onCancel,
  onDirtyChange,
  descriptionPlaceholder,
  onDiscard,
  initialFocusRef,
}: {
  field: RoleField;
  role: RoleTemplate;
  client: RahClient;
  disabled: boolean;
  onSave: (config: RoleCreateRequest["configuration"]) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
  descriptionPlaceholder?: string;
  onDiscard?: () => void;
  initialFocusRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const textual =
    field === "displayName" ||
    field === "instructions" ||
    field === "description" ||
    field === "avatarKey";
  const initial = textual
    ? field === "instructions" || field === "description"
      ? editableRolePrompt(role.configuration)
      : (role.configuration[field] ?? "")
    : "";
  const [value, setValue] = useState(initial),
    [error, setError] = useState("");
  const [description, setDescription] = useState(
    role.configuration.description ?? "",
  );
  const combined = field === "description" || field === "instructions";
  const formId = useId();
  const Commit = combined || field === "avatarKey" ? DialogCommit : Button;
  const dirty =
    textual &&
    (value !== initial ||
      (combined && description !== (role.configuration.description ?? "")));
  useEffect(() => {
    if (textual) onDirtyChange(dirty);
  }, [dirty, textual, onDirtyChange]);
  useDraftNavigation(dirty, () => {
    setValue(initial);
    (onDiscard ?? onCancel)();
  });
  if (!textual)
    return (
      <>
        <RoleEditor
          client={client}
          role={role}
          field={field}
          disabled={disabled}
          onSave={onSave}
          onDirtyChange={onDirtyChange}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onCancel}
        >
          取消
        </Button>
      </>
    );
  const save = () => {
    if (disabled) return;
    const config = combined
      ? patchRoleDescription(role.configuration, description, value)
      : patchRoleText(
          role.configuration,
          field as "displayName" | "instructions" | "avatarKey",
          value,
        );
    const parsed = RoleConfigurationSchema.safeParse(config);
    if (parsed.success) onSave(parsed.data);
    else setError("请输入有效内容。");
  };
  return (
    <form
      id={formId}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.nativeEvent.isComposing && !disabled) {
          e.preventDefault();
          onCancel();
        }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-3"
    >
      {field === "avatarKey" ? (
        <AvatarLibraryPicker
          value={value}
          disabled={disabled}
          onChange={setValue}
        />
      ) : combined ? (
        <>
          <FormField label="描述" labelStyle="plain">
            <Textarea
              aria-label="描述"
              ref={field === "description" ? initialFocusRef : undefined}
              rows={3}
              maxLength={2000}
              placeholder={descriptionPlaceholder}
              value={description}
              disabled={disabled}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>
          <FormField label="提示词" labelStyle="plain">
            <Textarea
              aria-label="提示词"
              ref={field === "instructions" ? initialFocusRef : undefined}
              rows={8}
              maxLength={64 * 1024}
              value={value}
              disabled={disabled}
              onChange={(e) => setValue(e.target.value)}
            />
          </FormField>
        </>
      ) : (
        <Input
          aria-label="名称"
          autoFocus
          value={value}
          disabled={disabled}
          maxLength={128}
          onChange={(e) => setValue(e.target.value)}
        />
      )}
      {error && <p role="alert">{error}</p>}
      <DialogFooter>
        <Commit
          form={formId}
          type="submit"
          variant="accent"
          size={combined || field === "avatarKey" ? "lg" : "sm"}
          disabled={disabled || !dirty}
        >
          保存
        </Commit>
        <Button
          type="button"
          variant="ghost"
          size={combined || field === "avatarKey" ? "lg" : "sm"}
          disabled={disabled}
          onClick={onCancel}
        >
          取消
        </Button>
      </DialogFooter>
    </form>
  );
}
