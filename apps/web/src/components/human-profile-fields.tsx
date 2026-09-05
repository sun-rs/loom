import { useRef, useState } from "react";
import type { Principal } from "@rah-os/protocol";
import { ProfileField } from "@rah-os/ui-web/neo-brutalist/profile-field";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import {
  useHumanIdentity,
  useWorkspaceEntities,
} from "./workspace-entity-context.tsx";
import { useHumanProfileMutation } from "../human-profile-hooks.ts";

export function HumanProfileFields({ human }: { human: Principal }) {
  const context = useHumanIdentity()!;
  const entities = useWorkspaceEntities();
  const self = human.principalId === entities?.scope?.actorId;
  const { pending, save } = useHumanProfileMutation(
    context.client,
    human,
    context.onPrincipalUpdated,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const [error, setError] = useState<string>();
  const name = human.displayName || human.handle;
  async function upload(file: File) {
    if (!self || uploadingRef.current || pending) return;
    uploadingRef.current = true;
    setUploading(true);
    setError(undefined);
    const baseline = human;
    try {
      if (!context.client.profileImages) throw new Error("头像存储不可用");
      const result = await context.client.profileImages.upload(file);
      await save(
        {
          avatarKey: result.avatarKey,
          avatarUploadIntentId: result.uploadIntentId,
        },
        baseline,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "头像上传失败");
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }
  return (
    <>
      <div className="rah-profile-identity">
        {self ? (
          <>
            <input
              ref={fileInput}
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (file) void upload(file);
              }}
            />
            <button
              type="button"
              className="rah-profile-avatar-upload"
              disabled={pending || uploading}
              aria-label="上传头像"
              title="上传头像"
              onClick={() => fileInput.current?.click()}
            >
              <ProfileImageAvatar
                avatarKey={human.avatarKey}
                name={name}
                principalId={human.principalId}
                size="profile"
              />
              <span className="rah-profile-avatar-overlay">
                <Icon name="pencil" />
              </span>
            </button>
          </>
        ) : (
          <ProfileImageAvatar
            avatarKey={human.avatarKey}
            name={name}
            principalId={human.principalId}
            size="profile"
          />
        )}
        <div>
          <h2 title={name}>{name}</h2>
          <p>
            @{human.handle}
            {self ? " （你）" : ""}
          </p>
        </div>
      </div>
      {error && (
        <p className="rah-profile-notice" role="alert">
          {error}
        </p>
      )}
      <ProfileField
        label="描述"
        placeholder="描述你自己，让此协作空间中的其他人类和 Agent 了解你"
        value={human.description ?? ""}
        source={human}
        onSave={
          self
            ? async (value, baseline) => {
                await save({ description: value }, baseline);
              }
            : undefined
        }
      />
    </>
  );
}
