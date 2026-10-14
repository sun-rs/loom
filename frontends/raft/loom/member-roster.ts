import type { Principal } from "@rah-os/protocol";
// Borrow the mounted RoomSession's read projection. No roster cache or cursor.
const readers = new Map<string, () => readonly Principal[]>();
export function bindMemberRoster(
  roomId: string,
  read: () => readonly Principal[],
) {
  readers.set(roomId, read);
  return () => {
    if (readers.get(roomId) === read) readers.delete(roomId);
  };
}
export function projectMentionMembers(members: readonly Principal[]) {
  const profile = (p: Principal) => ({
    id: p.principalId,
    name: p.handle,
    displayName: p.displayName ?? p.handle,
    description: p.description ?? null,
    avatarUrl: null,
  });
  return {
    agents: members.filter((p) => p.kind === "agent").map(profile),
    humans: members.filter((p) => p.kind === "human").map(profile),
    externalMembers: [],
  };
}
export function readMemberRoster(
  method: string | undefined,
  url: string | undefined,
) {
  const match =
    method === "get" && /^\/channels\/([^/?#]+)\/members$/.exec(url ?? "");
  const reader = match && readers.get(match[1]!);
  if (!reader) throw new Error("此功能尚未接入 Loom，或当前频道成员不可用");
  return projectMentionMembers(reader());
}
