/**
 * Stable keys extracted from Raft's shipped avatar preset table. The visual
 * grids live in the Web asset library; protocol only owns persisted identity.
 * `finch` and `mug` are upstream-reserved and are never auto-allocated.
 */
export const ROOM_AGENT_AVATAR_KEYS = [
  "robot",
  "cat",
  "ghost",
  "skull",
  "alien",
  "heart",
  "star",
  "flame",
  "diamond",
  "mushroom",
  "eye",
  "crown",
  "cloud",
  "sun",
  "bell",
  "tree",
] as const;

export type RoomAgentAvatarKey = (typeof ROOM_AGENT_AVATAR_KEYS)[number];

const ROOM_AGENT_AVATAR_KEY_SET = new Set<string>(ROOM_AGENT_AVATAR_KEYS);

export function isRoomAgentAvatarKey(value: unknown): value is RoomAgentAvatarKey {
  return typeof value === "string" && ROOM_AGENT_AVATAR_KEY_SET.has(value);
}
