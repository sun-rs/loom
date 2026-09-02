import {
  isUploadedProfileImageKey,
  profileImageContentPath,
} from "@rah-os/protocol";

import { AgentAvatar } from "./agent-directory-pane.tsx";

export function ProfileImageAvatar({
  avatarKey,
  name,
  size = "header",
}: {
  avatarKey: string | undefined;
  name: string;
  size?: "header" | "profile" | "sidebar" | "member" | "compact";
}) {
  if (isUploadedProfileImageKey(avatarKey)) {
    return (
      <span
        aria-label={`${name} 头像`}
        className={`rah-agent-avatar is-${size}`}
        role="img"
      >
        <img
          alt=""
          className="rah-profile-image-avatar"
          src={profileImageContentPath(avatarKey)}
        />
      </span>
    );
  }
  if (avatarKey) {
    return (
      <AgentAvatar
        agent={{
          avatarKey,
          displayName: name,
          runtimeAvailable: false,
          state: "enabled",
        }}
        showStatus={false}
        size={size}
      />
    );
  }
  return (
    <span aria-hidden="true" className="rah-settings-avatar">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
