import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function generatePwa140() {
  const base = "frontends/raft/upstream/published-2026-10-30-pwa140/";
  const classes = JSON.parse(
    readFileSync(base + "avatar-classes.json", "utf8"),
  );
  return {
    "OfficialPwa140.generated.js":
      "// GENERATED from selected Web1.21.40 declarations; do not edit.\n" +
      readFileSync(base + "chrome.js", "utf8") +
      readFileSync(base + "avatar.js", "utf8") +
      `export const avatarPickerClasses=${JSON.stringify(classes)};\n`,
    "OfficialPwa140.generated.d.ts":
      "// GENERATED; selected native declaration bindings.\nexport function resolveBrowserChromeColor(surface: 'frame' | 'paper', mode: 'light' | 'dark'): string;\nexport function presetButtonClass(selected: boolean, upload?: boolean): string;\nexport const avatarPickerClasses: {root: string; series: string; grid: string};\n",
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  for (const [file, source] of Object.entries(generatePwa140()))
    writeFileSync("frontends/raft/loom/" + file, source);
