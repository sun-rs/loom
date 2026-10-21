import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDeclarations } from "./generate-appearance.mjs";
const path = "packages/web/src/components/message/MessageItem.tsx";
const root = "frontends/raft/upstream/raft-web-source/";
const names = [
  "useRenderMessageMarkdown",
  "MentionEntry",
  "taskNumberSigil",
  "buildMentionIdentityMap",
  "highlightThreadSearchInlineCode",
  "getRaftRefProp",
  "renderDisplayOnlyMention",
  "ThreadSearchFragmentHighlight",
  "mentionIdentityMapCache",
];
export function generateMessageMarkdown() {
  const source = readFileSync(root + path, "utf8"),
    file = ts.createSourceFile(path, source, 99, true, ts.ScriptKind.TSX);
  const nodes = names.map((name) => {
    const found = file.statements.filter(
      (n) =>
        n.name?.text === name ||
        (ts.isVariableStatement(n) &&
          n.declarationList.declarations.length === 1 &&
          n.declarationList.declarations[0].name.getText(file) === name),
    );
    if (found.length !== 1)
      throw Error("Changed official markdown declaration: " + name);
    return found[0];
  });
  const identifiers = new Set();
  function visit(n) {
    if (ts.isIdentifier(n)) identifiers.add(n.text);
    ts.forEachChild(n, visit);
  }
  nodes.forEach(visit);
  const imports = [];
  for (const n of file.statements) {
    if (!ts.isImportDeclaration(n) || !n.importClause) continue;
    const c = n.importClause,
      parts = [];
    if (c.name && identifiers.has(c.name.text)) parts.push(c.name.text);
    if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
      const entries = c.namedBindings.elements.filter((e) =>
        identifiers.has(e.name.text),
      );
      if (entries.length)
        parts.push("{" + entries.map((e) => e.getText(file)).join(",") + "}");
    }
    if (!parts.length) continue;
    let spec = n.moduleSpecifier.text;
    if (
      [
        "./messageMarkdownSecurity",
        "./remarkMessageTokens",
        "./repairGeneratedMarkdown",
      ].includes(spec)
    )
      spec = "@loom/raft-web-source/" + spec.slice(2);
    else if (spec === "./threadSearch")
      spec = "./OfficialMarkdownSearch.generated";
    else if (spec === "@botiverse/raft-ui") spec = "raft-ui";
    else if (spec.startsWith("."))
      spec = "../" + posix.normalize(posix.join(posix.dirname(path), spec));
    imports.push(
      "import " +
        (c.isTypeOnly ? "type " : "") +
        parts.join(",") +
        " from " +
        JSON.stringify(spec) +
        ";",
    );
  }
  const search = readFileSync(
    root + "packages/web/src/components/message/threadSearch.ts",
    "utf8",
  );
  return {
    "OfficialMessageMarkdown.generated.tsx":
      "// GENERATED from immutable Raft db5e399 declarations. Imports bind existing presentation and Loom callbacks; do not edit.\n" +
      imports.join("\n") +
      "\n" +
      nodes.map((n) => n.getText(file)).join("\n\n") +
      "\nexport default useRenderMessageMarkdown;\n",
    "OfficialMarkdownSearch.generated.ts":
      '// GENERATED from immutable Raft db5e399 threadSearch declarations; do not edit.\nimport type {Root} from "mdast";\nimport {messageTokenNode,replaceTokensInTree,SKIP_CODE_AND_TOKENS} from "@loom/raft-web-source/remarkMessageTokens";\n' +
      extractDeclarations(search, [
        "normalizeThreadSearchQuery",
        "highlightThreadSearchInTree",
      ]).join("\n") +
      "\n",
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  for (const [name, source] of Object.entries(generateMessageMarkdown()))
    writeFileSync("frontends/raft/loom/" + name, source);
