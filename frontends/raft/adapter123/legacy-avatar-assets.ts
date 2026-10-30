import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import pokemon from "../loom/avatars/pokemon.json" with { type: "json" };
/** Existing content-addressed history images; not part of the native selection library. */
export function legacyAvatarAssets(): Plugin {
  return {
    name: "loom-native123-legacy-avatar-resources",
    generateBundle() {
      for (const a of pokemon.avatars) {
        this.emitFile({
          type: "asset",
          fileName: a.url.slice(1),
          source: readFileSync(
            resolve(
              import.meta.dirname,
              "../packages/web/public",
              a.url.slice(1),
            ),
          ),
        });
      }
    },
  };
}
