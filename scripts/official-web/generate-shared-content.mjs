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
        spec === "@botiverse/raft-ui"
          ? "raft-ui"
          : spec === "../../utils/markdownAutolink"
            ? "@loom/raft-web-source/markdownAutolink"
            : spec === "./markdownSanitizeSchema"
              ? "@loom/raft-web-source/markdownSanitizeSchema"
              : spec.startsWith(".")
                ? "../" + posix.normalize(posix.join(posix.dirname(path), spec))
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
    output["Official" + posix.basename(name) + ".generated.tsx"] =
      "// GENERATED from immutable Raft db5e399 module. Import-only bindings to the shared Loom presentation graph; do not edit.\n" +
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
