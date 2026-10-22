import type { RahClient } from "@rah-os/client-sdk";
import type { Principal } from "@rah-os/protocol";
/** Read-through identity cache, not a second cursor or membership authority. */
export async function readCurrentChannelMembers(
  client: RahClient,
  roomId: string,
  known: readonly Principal[],
  signal?: AbortSignal,
): Promise<Principal[]> {
  const { memberships } = await client.request(
    "room.member.list",
    { roomId },
    { signal },
  );
  let identities = new Map(known.map((p) => [p.principalId, p]));
  if (memberships.some((m) => !identities.has(m.principalId))) {
    // A bounded latest bootstrap supplies identities only. Never advance the chat
    // session, ACK a message, or replay history to discover a newly joined member.
    const latest = await client.request(
      "room.sync",
      {
        roomId,
        consumerId: `loom-member-identities:${roomId}`,
        bootstrap: "latest",
        limit: 1,
      },
      { signal },
    );
    if (!latest.snapshot) throw Error("Current member identities unavailable");
    identities = new Map(
      latest.snapshot.members.map((p) => [p.principalId, p]),
    );
  }
  return memberships.map((m) => {
    const p = identities.get(m.principalId);
    if (!p) throw Error("Membership changed during identity read");
    return p;
  });
}
