// Raft JI/Z6, index-BoAC7nSE.js @1855376. Keys only: exact visual grids/palette
// remain frontend assets. finch/mug are upstream reserved, not auto-allocated.
import { LOOM_EXTRA_AGENT_AVATAR_KEYS } from "./loom-agent-avatar-keys.ts";
import { POKEMON_AGENT_AVATAR_KEYS } from "./pokemon-agent-avatar-keys.ts";
import { RAFT_AGENT_AVATAR_KEYS } from "./raft-agent-avatar-keys.ts";
export { LOOM_EXTRA_AGENT_AVATAR_KEYS } from "./loom-agent-avatar-keys.ts";
/** Current allocation/picker pool; old identities remain accepted for stored history. */
export const OFFICIAL_AGENT_AVATAR_KEYS = RAFT_AGENT_AVATAR_KEYS;
export const SELECTABLE_AGENT_AVATAR_KEYS = OFFICIAL_AGENT_AVATAR_KEYS;
/** Automatic selection excludes occupied current presets; manual selection is unrestricted.
 * Once every preset is occupied the owner permits recycling the complete pool. */
export function availableAgentAvatarKeys(
  used: Iterable<string | undefined>,
): readonly string[] {
  const occupied = new Set(
    Array.from(used, (key) => key?.replace(/^pixel:/u, "")),
  );
  const unused = SELECTABLE_AGENT_AVATAR_KEYS.filter(
    (key) => !occupied.has(key),
  );
  return unused.length ? unused : SELECTABLE_AGENT_AVATAR_KEYS;
}
// Keep unknown legacy presentation deterministic across this catalogue upgrade.
const LEGACY_FALLBACK_AVATAR_KEYS: readonly string[] = [
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
export const AGENT_AVATAR_PRESET_KEYS: readonly string[] = [
  ...OFFICIAL_AGENT_AVATAR_KEYS,
  ...LOOM_EXTRA_AGENT_AVATAR_KEYS,
  ...POKEMON_AGENT_AVATAR_KEYS,
];
export function officialAgentAvatarKey(
  key: string | undefined,
  participantId?: string,
): string {
  const value = key?.replace(/^pixel:/u, "");
  if (
    value &&
    [...AGENT_AVATAR_PRESET_KEYS, ...OFFICIAL_RESERVED_AVATAR_KEYS].includes(
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
  return LEGACY_FALLBACK_AVATAR_KEYS[
    hash % LEGACY_FALLBACK_AVATAR_KEYS.length
  ]!;
}
