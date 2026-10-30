import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const sharedContentModules = [
  "markdown/MarkdownContent",
  "markdown/CodeBlock",
  "markdown/CustomProtocolLink",
  "ui/CopyButton",
  "ui/CopyIconButton",
  "message/AttachmentChip",
  "message/AttachmentMetaText",
  "ui/AvatarSlot",
  "agent/PixelAvatar",
];
export function generateSharedContent() {
  const output = {};
  for (const name of sharedContentModules) {
    const path = "packages/web/src/components/" + name + ".tsx";
    let source = readFileSync(
      "frontends/raft/upstream/raft-web-source/" + path,
      "utf8",
    );
    const ast = ts.createSourceFile(path, source, 99, true, ts.ScriptKind.TSX),
      edits = [];
    for (const node of ast.statements) {
      if (!ts.isImportDeclaration(node)) continue;
      const spec = node.moduleSpecifier.text;
      const bound =
        spec === "../../../assets/avatars/pixelAvatars.json"
          ? "./pixel-avatar-library"
          : spec === "@botiverse/raft-ui"
            ? "raft-ui"
            : spec === "../../utils/markdownAutolink"
              ? "@loom/raft-web-source/markdownAutolink"
              : spec === "./markdownSanitizeSchema"
                ? "@loom/raft-web-source/markdownSanitizeSchema"
                : spec.startsWith(".")
                  ? "../" +
                    posix.normalize(posix.join(posix.dirname(path), spec))
                  : spec;
      if (bound !== spec)
        edits.push([
          node.moduleSpecifier.getStart(ast),
          node.moduleSpecifier.end,
          JSON.stringify(bound),
        ]);
    }
    for (const [start, end, value] of edits.reverse())
      source = source.slice(0, start) + value + source.slice(end);
    // Explicit compatibility seam: native 8x8 output is identical; detailed owned
    // presets use their actual grid dimensions, still one cached image per avatar.
    if (name === "agent/PixelAvatar") {
      source = source.replace(
        "const cells = data.grid.flatMap",
        "const cells = data.grid.length > 8 ? detailedAvatarCells(data.grid, C) : data.grid.flatMap",
      );
      source =
        'import {detailedAvatarCells} from "./detailed-avatar-svg";\n' + source;
      source = source
        .replace(
          'viewBox="0 0 8 8"',
          'viewBox="0 0 ${data.grid[0]!.length} ${data.grid.length}"',
        )
        .replace(
          '<rect width="8" height="8" fill="${data.bg}"',
          '<rect width="${data.grid[0]!.length}" height="${data.grid.length}" fill="${data.bg}"',
        );
      // Owner-supplied immutable PNGs reuse the native single-image/frame path.
      // Legacy pixel identities keep their byte-identical SVG renderer.
      source =
        'import {libraryAvatarUrl, selectableAvatarKeys} from "./pixel-avatar-library";\n' +
        source;
      source = source
        .replace(
          /export const AVATAR_KEYS = Object.keys\(AVATARS\).filter\([\s\S]*?\n\);/,
          "export const AVATAR_KEYS = selectableAvatarKeys;",
        )
        .replace(
          "export function pixelAvatarDataUrl(avatarKey: string): string | null {",
          "export function pixelAvatarDataUrl(avatarKey: string): string | null {\n  const imageUrl = libraryAvatarUrl(avatarKey);\n  if (imageUrl) return imageUrl;",
        )
        .replace(
          'style={{ imageRendering: "pixelated" }}',
          'loading={libraryAvatarUrl(avatarKey) ? "lazy" : undefined}\n      decoding="async"\n      style={{ imageRendering: libraryAvatarUrl(avatarKey) ? "auto" : "pixelated" }}',
        );
    }
    output["Official" + posix.basename(name) + ".generated.tsx"] =
      (name === "agent/PixelAvatar"
        ? "// GENERATED from immutable Raft db5e399. Import bindings, legacy-grid and owner PNG seams; do not edit.\n"
        : "// GENERATED from immutable Raft db5e399 module. Import-only bindings to the shared Loom presentation graph; do not edit.\n") +
      source;
  }
  return output;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  for (const [name, source] of Object.entries(generateSharedContent()))
    writeFileSync("frontends/raft/loom/" + name, source);
