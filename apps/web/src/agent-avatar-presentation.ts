import { officialAgentAvatarKey } from "@rah-os/protocol";
import avatarPack from "@rah-os/ui-tokens/avatar-pack.json" with { type: "json" };

/** Exact upstream fixed preset grid; no procedural pixel generation. */
export function agentAvatarPixels(
  avatarKey: string | undefined,
  participantId?: string,
) {
  const presets = avatarPack.presets as Record<
    string,
    { background: string; grid: string[] }
  >;
  return presets[officialAgentAvatarKey(avatarKey, participantId)]!;
}
