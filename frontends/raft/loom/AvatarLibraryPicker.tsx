import { useId } from "react";
import { Text } from "raft-ui";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
import { avatarGroups } from "./pixel-avatar-library";
import {
  avatarPickerClasses,
  presetButtonClass,
} from "./OfficialPwa140.generated.js";

/** Native preset composition, fed by the complete Web1.21.40 catalog.
 * Role writes stay in the parent Revision owner. No custom search/pagination.
 * Upload is omitted because Role configuration currently accepts preset keys.
 */
export default function AvatarLibraryPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-4" data-testid="role-avatar-library">
      <div className="flex items-center gap-4">
        <AvatarSlot
          context="profile-tile"
          type="agent"
          agentAvatarUrl={value}
        />
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
