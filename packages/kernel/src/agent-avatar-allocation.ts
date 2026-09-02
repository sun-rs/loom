import { randomInt } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  OFFICIAL_AGENT_AVATAR_KEYS,
  officialAgentAvatarKey,
} from "@rah-os/protocol";

/** Inside canonical creation transaction, after replay. Never changes prior revisions. */
export function allocateAgentAvatarKey(
  database: DatabaseSync,
  controlRoomId: string,
  choose: (size: number) => number = (size) => randomInt(size),
): string {
  const counts = new Map(OFFICIAL_AGENT_AVATAR_KEYS.map((key) => [key, 0]));
  for (const row of database
    .prepare(
      "SELECT d.participant_id,r.definition_json FROM agent_definitions d JOIN agent_definition_revisions r ON r.agent_definition_revision_id=d.current_revision_id WHERE d.control_room_id=?",
    )
    .all(controlRoomId)) {
    const d = JSON.parse(String(row.definition_json)) as { avatarKey?: string };
    const key = officialAgentAvatarKey(d.avatarKey, String(row.participant_id));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const min = Math.min(
    ...OFFICIAL_AGENT_AVATAR_KEYS.map((key) => counts.get(key)!),
  );
  const available = OFFICIAL_AGENT_AVATAR_KEYS.filter(
    (key) => counts.get(key) === min,
  );
  const index = choose(available.length);
  if (!Number.isInteger(index) || index < 0 || index >= available.length)
    throw Error("invalid avatar selection");
  return available[index]!;
}
