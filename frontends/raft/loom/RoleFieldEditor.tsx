import { editableRolePrompt, patchRoleText } from "./role-profile-values.ts";
// Loom Revision binding around official AgentProfileEditDialog field/preset composition.
import { useState, useEffect } from "react";
import { Button, Input, Textarea } from "raft-ui";
import type { RahClient } from "@rah-os/client-sdk";
import {
  RoleConfigurationSchema,
  type RoleTemplate,
  type RoleCreateRequest,
} from "@rah-os/protocol";
import RoleEditor from "./RoleEditor.tsx";
import { useDraftNavigation } from "./DraftNavigation.tsx";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import { AVATAR_KEYS } from "../packages/web/src/components/agent/PixelAvatar.tsx";
export type RoleField =
  | "displayName"
  | "instructions"
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
}: {
  field: RoleField;
  role: RoleTemplate;
  client: RahClient;
  disabled: boolean;
  onSave: (config: RoleCreateRequest["configuration"]) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const textual =
    field === "displayName" ||
    field === "instructions" ||
    field === "avatarKey";
  const initial = textual
    ? field === "instructions"
      ? editableRolePrompt(role.configuration)
      : (role.configuration[field] ?? "")
    : "";
  const [value, setValue] = useState(initial),
    [error, setError] = useState("");
  const dirty = textual && value !== initial;
  useEffect(() => {
    if (textual) onDirtyChange(dirty);
  }, [dirty, textual, onDirtyChange]);
  useDraftNavigation(dirty, () => {
    setValue(initial);
    onCancel();
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
    const config = patchRoleText(
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
        <div className="grid grid-cols-[repeat(auto-fill,40px)] gap-2">
          {AVATAR_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              aria-label={`头像 ${key}`}
              aria-pressed={value === `pixel:${key}`}
              disabled={disabled}
              onClick={() => setValue(`pixel:${key}`)}
              className={`flex size-10 items-center justify-center overflow-hidden rounded-md border transition-colors ${value === `pixel:${key}` ? "border-accent bg-accent-soft" : "border-line-muted hover:border-line-strong"}`}
            >
              <AvatarSlot
                context="panel-header"
                type="agent"
                agentAvatarUrl={`pixel:${key}`}
              />
            </button>
          ))}
        </div>
      ) : field === "instructions" ? (
        <Textarea
          aria-label="角色 Prompt"
          autoFocus
          rows={5}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
        />
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
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="accent"
          size="sm"
          disabled={disabled || !dirty}
        >
          保存
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onCancel}
        >
          取消
        </Button>
      </div>
    </form>
  );
}
