import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(
  resolve(
    import.meta.dirname,
    "../upstream/web-1.21.23/packages/web/package.json",
  ),
);
const source = readFileSync(
  require.resolve("@botiverse/raft-ui/fonts.css"),
  "utf8",
);
const importRule = source.match(
  /@import url\("https:\/\/fonts.googleapis.com\/[^\n]+;/,
)?.[0];
if (!importRule) throw Error("Native1.21.23 font contract changed");
const root = resolve(import.meta.dirname, "../loom/fonts");
const faces = readFileSync(root + "/faces.css", "utf8");
const files = JSON.parse(readFileSync(root + "/provenance.json", "utf8")).files;
export function localFontDelivery(css: string) {
  let result = css
    .replace(importRule!, faces)
    .replace(importRule!.replace('url("', '"').replace('");', '";'), faces);
  for (const { url, file } of files)
    result = result.replaceAll(url, resolve(root, file));
  const quote =
    "https://fonts.gstatic.com/s/hankengrotesk/v12/ieVn2YZDLWuGJpnzaiwFXS9tYtpd59CxCis4.woff2";
  result = result.replaceAll(
    quote,
    resolve(import.meta.dirname, "assets/quote.woff2"),
  );
  if (/https:\/\/fonts\.(googleapis|gstatic)\.com/.test(result))
    throw Error("Unmapped native font");
  return result;
}
