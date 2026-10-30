import { useId, useRef } from "react";
import { Text } from "raft-ui";
import { Upload, Shuffle } from "lucide-react";
import { PROFILE_AVATAR_ACCEPT } from "../packages/web/src/utils/avatarUpload";
import { isUploadedProfileImageKey } from "@rah-os/protocol";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
import { avatarGroups } from "./pixel-avatar-library";
import {
  avatarPickerClasses,
  presetButtonClass,
} from "./OfficialPwa140.generated.js";

/** Native preset composition, fed by the complete Web1.21.40 catalog.
 * Role writes stay in the parent Revision owner. No custom search/pagination.
 * File selection shares native upload/preset composition; Role writes remain in the parent.
 */
export default function AvatarLibraryPicker({
  value,
  disabled,
  onChange,
  onUpload,
  onRandom,
  randomDisabled = false,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onUpload: (file: File) => void;
  onRandom: () => void;
  randomDisabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="grid gap-4" data-testid="role-avatar-library">
      <div className="flex items-center gap-4">
        <AvatarSlot
          context="profile-tile"
          type="agent"
          agentAvatarUrl={value}
        />
        <Tooltip content="上传图片">
          <button
            type="button"
            aria-label="上传图片"
            disabled={disabled}
            className={presetButtonClass(
              isUploadedProfileImageKey(value),
              true,
            )}
            onClick={() => input.current?.click()}
          >
            <Upload size={18} />
          </button>
        </Tooltip>
        <input
          ref={input}
          type="file"
          accept={PROFILE_AVATAR_ACCEPT}
          className="hidden"
          data-testid="avatar-upload-input"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (file) onUpload(file);
          }}
        />
        <Tooltip content="随机头像">
          <button
            type="button"
            aria-label="随机头像"
            disabled={disabled || randomDisabled}
            className={presetButtonClass(false, true)}
            onClick={onRandom}
          >
            <Shuffle size={18} />
          </button>
        </Tooltip>
      </div>
      <div className={avatarPickerClasses.root}>
        {avatarGroups.map((group) => (
          <div
            key={group.id}
            data-avatar-series={group.id}
            role="group"
            aria-labelledby={`${id}-${group.id}`}
            className={avatarPickerClasses.series}
          >
            <Text.Sans size="group" id={`${id}-${group.id}`} render={<h3 />}>
              {group.name}
            </Text.Sans>
            <div className={avatarPickerClasses.grid}>
              {group.avatars.map((avatar) => (
                <Tooltip key={avatar.id} content={avatar.id}>
                  <button
                    type="button"
                    aria-label={avatar.id}
                    aria-pressed={value === `pixel:${avatar.id}`}
                    disabled={disabled}
                    onClick={() => onChange(`pixel:${avatar.id}`)}
                    className={presetButtonClass(
                      value === `pixel:${avatar.id}`,
                    )}
                  >
                    <AvatarSlot
                      context="panel-header"
                      type="agent"
                      agentAvatarUrl={`pixel:${avatar.id}`}
                    />
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
