import type { Principal } from "@rah-os/protocol";
import { projectMentionMembers } from "./member-roster.ts";
type Candidate = ReturnType<typeof projectMentionMembers>["agents"][number] & {
  serverId?: string;
  serverName?: string | null;
  serverSlug?: string | null;
  gravatarHash?: string;
  deletedAt?: string | null;
};
export type ComposerMemberScope = {
  roomId: string;
  members: readonly Principal[];
};
/** Borrow the host's authorized snapshot. A disabled or mismatched scope exposes no candidates. */
export function composerMemberProjection(
  scope: ComposerMemberScope,
  requestedRoom: string,
  enabled: boolean,
): { agents: Candidate[]; humans: Candidate[]; externalMembers: never[] } {
  return projectMentionMembers(
    enabled && scope.roomId === requestedRoom ? scope.members : [],
  );
}
