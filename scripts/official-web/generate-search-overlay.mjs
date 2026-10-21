import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function generateSearchOverlay() {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/search/SearchOverlay.tsx",
    "utf8",
  );
  const file = ts.createSourceFile(
    "overlay.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (file.parseDiagnostics.length) throw Error("Invalid official overlay");
  const imports = {
    "@botiverse/raft-ui": "raft-ui",
    "./MessageSearchPage": "./SearchOverlayContent",
    "./searchOverlayAnchor": "@loom/raft-web-source/searchOverlayAnchor",
    "../../utils/desktopShell": "../packages/web/src/utils/desktopShell",
    "../Modal": "@loom/raft-web-source/Modal",
  };
  return (
    "// GENERATED from locked db5e399 SearchOverlay. Only imports bind Loom; body unchanged.\n" +
    file.statements
      .map((n) => {
        const s = n.getText(file);
        if (!ts.isImportDeclaration(n)) return s;
        const from = n.moduleSpecifier.text;
        if (!(from in imports) && from !== "react" && from !== "react-intl")
          throw Error("Unknown official import " + from);
        return imports[from] ? s.replace(from, imports[from]) : s;
      })
      .join("\n") +
    "\n"
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialSearchOverlay.generated.tsx",
    generateSearchOverlay(),
  );
