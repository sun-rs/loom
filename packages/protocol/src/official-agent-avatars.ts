// Raft JI/Z6, index-BoAC7nSE.js @1855376. Keys only: exact visual grids/palette
// remain frontend assets. finch/mug are upstream reserved, not auto-allocated.
export const OFFICIAL_AGENT_AVATAR_KEYS: readonly string[] = [
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
];
export const OFFICIAL_RESERVED_AVATAR_KEYS: readonly string[] = [
  "finch",
  "mug",
];
export function officialAgentAvatarKey(
  key: string | undefined,
  participantId?: string,
): string {
  const value = key?.replace(/^pixel:/u, "");
  if (
    value &&
    [...OFFICIAL_AGENT_AVATAR_KEYS, ...OFFICIAL_RESERVED_AVATAR_KEYS].includes(
      value,
    )
  )
    return value;
  const legacy: Record<string, string> = {
    codex: "ghost",
    claude: "cat",
    kimi: "skull",
    opencode: "alien",
  };
  if (value && legacy[value]) return legacy[value];
  // Compatibility selects a fixed library entry, never synthesizes pixels.
  let hash = 0;
  for (const c of value ?? participantId ?? "robot")
    hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0;
  return OFFICIAL_AGENT_AVATAR_KEYS[hash % OFFICIAL_AGENT_AVATAR_KEYS.length]!;
}
