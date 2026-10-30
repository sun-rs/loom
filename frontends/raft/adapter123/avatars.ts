import native from "../upstream/web-1.21.23/packages/web/assets/avatars/pixelAvatars.json" with { type: "json" };
import additions from "../loom/avatars/presets.json" with { type: "json" };
import later from "../loom/avatars/official.json" with { type: "json" };
import pokemon from "../loom/avatars/pokemon.json" with { type: "json" };
import { roleAvatarUrl } from "../loom/profile-avatar.ts";
export const nativeAvatarKeys = Object.keys(native.avatars).filter(
  (key) => !native.reservedKeys.includes(key),
);
export function nativeRandomAvatar(
  occupied: Iterable<string | undefined>,
  random: () => number = Math.random,
) {
  const used = new Set(occupied),
    unused = nativeAvatarKeys.filter((key) => !used.has("pixel:" + key)),
    pool = unused.length ? unused : nativeAvatarKeys;
  const index = Math.floor(random() * pool.length);
  if (index < 0 || index >= pool.length)
    throw Error("Invalid avatar random source");
  return "pixel:" + pool[index];
}
const images = new Map(pokemon.avatars.map((a) => [a.id, a.url]));
const legacy: Record<string, { bg: string; grid: string[] }> =
  Object.fromEntries(
    additions.avatars.map((a) => [a.id, { bg: a.bg, grid: a.grid.split("/") }]),
  );
Object.assign(legacy, later.avatars);
const palette: Record<string, string> = {
    ...native.palette,
    ...additions.palette,
    ...later.palette,
  },
  cache = new Map<string, string>();
/** Resource compatibility only. Old saved artwork never expands the pinned native picker. */
export function nativeAvatarUrl(value: string | null): string | null {
  if (!value?.startsWith("pixel:")) return roleAvatarUrl(value);
  const key = value.slice(6);
  if (Object.hasOwn(native.avatars, key) || key.startsWith("random:"))
    return value;
  const image = images.get(key);
  if (image) return image;
  if (cache.has(key)) return cache.get(key)!;
  const data = legacy[key];
  if (!data) return value;
  const n = data.grid.length,
    bg = palette[data.bg] ?? data.bg,
    cells = data.grid
      .flatMap((row, y) =>
        row
          .split("")
          .flatMap((color, x) =>
            color === "_"
              ? []
              : [
                  `<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[color]}"/>`,
                ],
          ),
      )
      .join("");
  const url =
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${bg}"/>${cells}</svg>`,
    );
  cache.set(key, url);
  return url;
}
