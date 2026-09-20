import { PROFILE_IMAGE_MIME_TYPES } from "@rah-os/protocol";

import type { AgentProfileEditInput } from "./agent-profile-edit.ts";

export const AGENT_AVATAR_UPLOAD_ACCEPT = PROFILE_IMAGE_MIME_TYPES.join(",");

export async function uploadAgentAvatar({
  agentId,
  expectedRevisionId,
  file,
  saveProfile,
  upload,
}: {
  agentId: string;
  expectedRevisionId: string;
  file: File;
  saveProfile: (input: AgentProfileEditInput) => Promise<void>;
  upload: (file: File) => Promise<{
    avatarKey: string;
    uploadIntentId: string;
  }>;
}): Promise<string> {
  const { avatarKey, uploadIntentId } = await upload(file);
  await saveProfile({
    agentId,
    avatarUploadIntentId: uploadIntentId,
    expectedRevisionId,
    field: "avatarKey",
    value: avatarKey,
  });
  return avatarKey;
}
