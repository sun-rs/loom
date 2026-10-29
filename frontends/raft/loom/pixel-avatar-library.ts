import original from "@loom/raft-web-source/pixelAvatars" with { type: "json" };
import additions from "./avatars/presets.json" with { type: "json" };
/** Official bytes stay immutable; this is the explicit Loom-owned data extension seam. */
const pixelAvatars = {
  ...original,
  avatars: {
    ...original.avatars,
    ...Object.fromEntries(
      additions.avatars.map((a) => [
        a.id,
        { bg: a.bg, grid: a.grid.split("/") },
      ]),
    ),
  },
};
export const avatarGroups = [
  {
    id: "raft",
    name: "Raft 原生",
    avatars: Object.keys(original.avatars)
      .filter((key) => !original.reservedKeys.includes(key))
      .map((key) => ({ id: key, name: key })),
  },
  ...additions.groups.map((group) => ({
    ...group,
    avatars: additions.avatars.filter((a) => a.group === group.id),
  })),
];
export function randomAvatarKey(
  current?: string,
  random: () => number = Math.random,
) {
  const keys = avatarGroups
    .flatMap((g) => g.avatars.map((a) => a.id))
    .filter((k) => `pixel:${k}` !== current);
  const index = Math.floor(random() * keys.length);
  if (index < 0 || index >= keys.length)
    throw Error("Invalid avatar random choice");
  return `pixel:${keys[index]}`;
}
export default pixelAvatars;
