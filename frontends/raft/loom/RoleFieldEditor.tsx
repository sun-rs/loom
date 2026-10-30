import {
  editableRolePrompt,
  patchRoleText,
  patchRoleDescription,
} from "./role-profile-values.ts";
// Loom Revision binding around official AgentProfileEditDialog field/preset composition.
import { useState, useEffect, useId, useRef, type RefObject } from "react";
import { DialogCommit } from "raft-ui/wip";
import { Button, Input, Textarea, DialogBody, DialogFooter } from "raft-ui";
import type { RahClient } from "@rah-os/client-sdk";
import {
  RoleConfigurationSchema,
  PROFILE_IMAGE_MAX_BYTES,
  ProfileImageMimeTypeSchema,
  type RoleTemplate,
  type RoleCreateRequest,
} from "@rah-os/protocol";
import RoleEditor from "./RoleEditor.tsx";
import { useDraftNavigation } from "./DraftNavigation.tsx";
import AvatarLibraryPicker from "./AvatarLibraryPicker";
import { randomAvatarKey } from "./pixel-avatar-library";
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
  onSave: (
    config: RoleCreateRequest["configuration"],
    avatarUploadIntentId?: string,
  ) => void;
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
  const [uploadIntentId, setUploadIntentId] = useState<string>();
  const [selecting, setSelecting] = useState(false);
  const [occupiedAvatars, setOccupiedAvatars] =
    useState<(string | undefined)[]>();
  const selectionAbort = useRef<AbortController | null>(null);
  useEffect(() => () => selectionAbort.current?.abort(), []);
  useEffect(() => {
    if (field !== "avatarKey") return;
    const abort = new AbortController();
    void client
      .request(
        "role.list",
        { controlRoomId: role.controlRoomId },
        { signal: abort.signal },
      )
      .then((catalog) => {
        if (!abort.signal.aborted)
          setOccupiedAvatars(
            catalog.roles.map((r) => r.configuration.avatarKey),
          );
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError("无法读取角色头像，请关闭后重新打开。");
      });
    return () => abort.abort();
  }, [client, role.controlRoomId, field]);
  const blocked = disabled || selecting;
  const selectPreset = (key: string) => {
    setValue(key);
    setUploadIntentId(undefined);
    setError("");
  };
  const randomize = () => {
    if (blocked || !occupiedAvatars) return;
    selectPreset(randomAvatarKey(value, Math.random, occupiedAvatars));
  };
  const upload = async (file: File) => {
    if (blocked) return;
    if (file.size > PROFILE_IMAGE_MAX_BYTES) {
      setError("图片不能超过 5 MB。");
      return;
    }
    if (!ProfileImageMimeTypeSchema.safeParse(file.type).success) {
      setError("请选择 JPEG、PNG、GIF 或 WebP 图片。");
      return;
    }
    if (!client.profileImages) {
      setError("当前连接不支持头像上传。");
      return;
    }
    const abort = new AbortController();
    selectionAbort.current = abort;
    setSelecting(true);
    setError("");
    try {
      const receipt = await client.profileImages.upload(file, abort.signal);
      if (!abort.signal.aborted) {
        setValue(receipt.avatarKey);
        setUploadIntentId(receipt.uploadIntentId);
      }
    } catch {
      if (!abort.signal.aborted)
        setError("图片上传未确认，请重新选择；角色尚未修改。");
    } finally {
      if (!abort.signal.aborted) setSelecting(false);
    }
  };
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
    if (blocked) return;
    const config = combined
      ? patchRoleDescription(role.configuration, description, value)
      : patchRoleText(
          role.configuration,
          field as "displayName" | "instructions" | "avatarKey",
          value,
        );
    const parsed = RoleConfigurationSchema.safeParse(config);
    if (parsed.success) onSave(parsed.data, uploadIntentId);
    else setError("请输入有效内容。");
  };
  const body = (
    <>
      {field === "avatarKey" ? (
        <AvatarLibraryPicker
          value={value}
          disabled={blocked}
          onChange={selectPreset}
          onUpload={(file) => void upload(file)}
          onRandom={() => void randomize()}
          randomDisabled={!occupiedAvatars}
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
      {field === "avatarKey" && selecting && (
        <p role="status" className="sr-only">
          正在准备头像…
        </p>
      )}
    </>
  );
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
      className={field === "avatarKey" ? "contents" : "space-y-3"}
    >
      {field === "avatarKey" ? (
        <DialogBody className="grid gap-5">{body}</DialogBody>
      ) : (
        body
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          size={combined || field === "avatarKey" ? "lg" : "sm"}
          disabled={disabled}
          onClick={onCancel}
        >
          取消
        </Button>
        <Commit
          form={formId}
          type="submit"
          variant="accent"
          size={combined || field === "avatarKey" ? "lg" : "sm"}
          disabled={blocked || !dirty}
        >
          保存
        </Commit>
      </DialogFooter>
    </form>
  );
}
