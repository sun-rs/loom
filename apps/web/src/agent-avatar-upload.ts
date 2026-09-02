import { PROFILE_IMAGE_MIME_TYPES } from "@rah-os/protocol";

import type { AgentProfileEditInput } from "./agent-profile-edit.ts";

export const AGENT_AVATAR_UPLOAD_ACCEPT = PROFILE_IMAGE_MIME_TYPES.join(",");

export async function uploadAgentAvatar({
  agentDefinitionId,
  expectedRevisionId,
  file,
  saveProfile,
  upload,
}: {
  agentDefinitionId: string;
  expectedRevisionId: string;
  file: File;
  saveProfile: (input: AgentProfileEditInput) => Promise<void>;
  upload: (file: File) => Promise<{ avatarKey: string }>;
}): Promise<string> {
  const { avatarKey } = await upload(file);
  await saveProfile({
    agentDefinitionId,
    expectedRevisionId,
    field: "avatarKey",
    value: avatarKey,
  });
  return avatarKey;
}
