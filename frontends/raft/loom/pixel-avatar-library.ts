import original from "@loom/raft-web-source/pixelAvatars" with { type: "json" };
import additions from "./avatars/presets.json" with { type: "json" };
import pokemon from "./avatars/pokemon.json" with { type: "json" };
/** Legacy grids stay readable; only the owner-supplied image library is selectable. */
const pixelAvatars = {
  ...original,
  palette: { ...original.palette, ...additions.palette },
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
export const avatarGroups = pokemon.groups.map((group) => ({
  ...group,
  avatars: pokemon.avatars.filter((a) => a.group === group.id),
}));
export const selectableAvatarKeys = pokemon.avatars.map((a) => a.id);
const imageUrls = new Map(pokemon.avatars.map((a) => [a.id, a.url]));
/** Same-origin content-addressed files, never bundled/base64 or external URLs. */
export function libraryAvatarUrl(key: string): string | null {
  return imageUrls.get(key) ?? null;
}
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
