import {
  isUploadedProfileImageKey,
  profileImageContentPath,
} from "@rah-os/protocol";

import { AgentAvatar } from "./agent-avatar.tsx";

export function ProfileImageAvatar({
  avatarKey,
  name,
  size = "header",
  kind = "human",
  principalId,
}: {
  avatarKey: string | undefined;
  name: string;
  size?: "header" | "profile" | "sidebar" | "member" | "compact";
  kind?: string;
  principalId?: string;
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
  if (avatarKey || kind === "agent") {
    return (
      <AgentAvatar
        agent={{
          ...(avatarKey ? { avatarKey } : {}),
          displayName: name,
          runtimeAvailable: false,
          state: "enabled",
          ...(principalId ? { participantId: principalId } : {}),
        }}
        showStatus={false}
        size={size}
      />
    );
  }
  return (
    <span
      aria-label={`${name} 头像`}
      role="img"
      className={`rah-settings-avatar is-${size}`}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
