import original from "@loom/raft-web-source/pixelAvatars" with { type: "json" };
import { availableAgentAvatarKeys } from "@rah-os/protocol";
import additions from "./avatars/presets.json" with { type: "json" };
import pokemon from "./avatars/pokemon.json" with { type: "json" };
import official from "./avatars/official.json" with { type: "json" };
import seriesLabels from "./avatars/official-series-labels.json" with { type: "json" };
/** Native Web1.21.40 sprites/series are active; previous artwork is read compatibility only. */
const pixelAvatars = {
  ...official,
  palette: { ...original.palette, ...additions.palette, ...official.palette },
  avatars: {
    ...original.avatars,
    ...Object.fromEntries(
      additions.avatars.map((a) => [
        a.id,
        { bg: a.bg, grid: a.grid.split("/") },
      ]),
    ),
    ...official.avatars,
  },
};
export const avatarGroups = official.series.map((series) => ({
  id: series.key,
  name: seriesLabels[series.key as keyof typeof seriesLabels],
  avatars: series.avatars.map((id) => ({ id, name: id })),
}));
export const selectableAvatarKeys = official.series.flatMap(
  (series) => series.avatars,
);
const imageUrls = new Map(pokemon.avatars.map((a) => [a.id, a.url]));
/** Same-origin content-addressed files, never bundled/base64 or external URLs. */
export function libraryAvatarUrl(key: string): string | null {
  return imageUrls.get(key) ?? null;
}
export function randomAvatarKey(
  current?: string,
  random: () => number = Math.random,
  occupied?: Iterable<string | undefined>,
) {
  // A draft is not an occupied Role. Never recycle occupied presets merely
  // because the sole unused preset is already selected in this draft.
  const keys = availableAgentAvatarKeys(occupied ?? [current]);
  const index = Math.floor(random() * keys.length);
  if (index < 0 || index >= keys.length)
    throw Error("Invalid avatar random choice");
  return `pixel:${keys[index]}`;
}
export default pixelAvatars;
