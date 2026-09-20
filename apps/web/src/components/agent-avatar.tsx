import type { CSSProperties } from "react";

import avatarPack from "@rah-os/ui-tokens/avatar-pack.json";
import {
  isUploadedProfileImageKey,
  profileImageContentPath,
} from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

import { agentAvatarPixels } from "../agent-avatar-presentation.ts";
import { agentPresencePresentation } from "../attention-presentation.ts";
import { AgentStatusDot } from "./agent-status-dot.tsx";

type OfficialAvatarPack = {
  palette: Record<string, string>;
  presets: Record<string, { background: string; grid: string[] }>;
};

const OFFICIAL_AVATAR_PACK = avatarPack as OfficialAvatarPack;

export function AgentAvatar({
  agent,
  showStatus = true,
  muted = agent.state === "tombstoned",
  size,
}: {
  agent: Pick<
    WorkspaceAgentView,
    | "avatarKey"
    | "displayName"
    | "runtimeAvailable"
    | "state"
    | "connectionStatus"
    | "presence"
  > & { participantId?: string };
  showStatus?: boolean;
  muted?: boolean;
  size:
    | "header"
    | "profile"
    | "sidebar"
    | "member"
    | "compact"
    | "surface"
    | "preview";
}) {
  const uploadedAvatarKey = isUploadedProfileImageKey(agent.avatarKey)
    ? agent.avatarKey
    : undefined;
  const uploaded = uploadedAvatarKey !== undefined;
  const preset = agentAvatarPixels(agent.avatarKey, agent.participantId);
  return (
    <span
      aria-label={`${agent.displayName} 头像`}
      className={`rah-agent-avatar is-${size}${muted ? " is-deleted" : ""}`}
      role="img"
      style={
        uploaded
          ? undefined
          : ({
              "--rah-avatar-background": preset.background,
            } as CSSProperties)
      }
    >
      {uploaded ? (
        <img
          alt=""
          className="rah-profile-image-avatar"
          src={profileImageContentPath(uploadedAvatarKey)}
        />
      ) : (
        <span className="rah-agent-avatar-grid" aria-hidden="true">
          {preset.grid.flatMap((row, y) =>
            [...row].map((paletteKey, x) => {
              const color = OFFICIAL_AVATAR_PACK.palette[paletteKey];
              return color === undefined || color === "transparent" ? null : (
                <i
                  key={`${x}:${y}`}
                  style={{
                    backgroundColor: color,
                    gridColumn: x + 1,
                    gridRow: y + 1,
                  }}
                />
              );
            }),
          )}
        </span>
      )}
      {showStatus && agent.state !== "tombstoned" ? (
        <AgentStatusDot
          className="rah-agent-avatar-presence"
          size={size === "sidebar" ? "sm" : "md"}
          {...agentPresencePresentation(agent)}
        />
      ) : null}
    </span>
  );
}
