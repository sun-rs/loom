import type { Principal } from "@rah-os/protocol";
import { roleAvatarUrl } from "./profile-avatar.ts";
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
    avatarUrl: roleAvatarUrl(p.avatarKey ?? null),
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

/** Canonical current Room members only; a mention never grants access. */
export function projectMessageMentions(members: readonly Principal[]) {
  return new Map(
    members
      .filter((p) => p.kind === "agent" || p.kind === "human")
      .map((p) => [
        p.handle,
        {
          id: p.principalId,
          type: p.kind === "agent" ? ("agent" as const) : ("user" as const),
          displayName: p.displayName ?? p.handle,
        },
      ]),
  );
}

/** Labels may change; only durable bindings authorize mention identity. */
export function boundMessageMentions<T extends { id: string; type: string }>(
  directory: Map<string, T>,
  bindings: readonly { id: string; type: string }[] | undefined,
): Map<string, T> {
  const ids = new Set(bindings?.map((b) => `${b.type}:${b.id}`));
  return new Map(
    [...directory].filter(([, p]) => ids.has(`${p.type}:${p.id}`)),
  );
}
