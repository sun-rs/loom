import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const fontRoot = resolve(import.meta.dirname, "fonts");
const source = readFileSync(require.resolve("raft-ui/fonts.css"), "utf8");
const matchedImport = source.match(
  /@import url\("https:\/\/fonts.googleapis.com\/[^\n]+;/,
)?.[0];
if (!matchedImport) throw Error("Official font import changed");
const importRule: string = matchedImport;
const faces = readFileSync(resolve(fontRoot, "faces.css"), "utf8");
const manifest = JSON.parse(
  readFileSync(resolve(fontRoot, "provenance.json"), "utf8"),
) as { files: { url: string; file: string }[] };
/** Replace delivery only. Keep upstream family, weight, display and glyph ranges. */
export function localizeFontCss(css: string) {
  const normalizedRule = importRule.replace('url("', '"').replace('");', '";');
  let result = css.replace(importRule, faces).replace(normalizedRule, faces);
  for (const { url, file } of manifest.files)
    result = result.replaceAll(url, resolve(fontRoot, file));
  if (/https:\/\/fonts\.(googleapis|gstatic)\.com/.test(result))
    throw Error(
      "Unmapped official font dependency: " +
        result.match(
          /.{0,30}https:\/\/fonts\.(googleapis|gstatic)\.com[^;]+/,
        )?.[0],
    );
  return result;
}
