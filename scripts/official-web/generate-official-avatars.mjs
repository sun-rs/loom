import ts from "typescript";
import prettier from "prettier";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withPinnedRelease } from "./pinned-release.mjs";

// Data adapter for the entire pinned distribution. No code is evaluated and no
// old page is patched: the native catalog, palette and translations stay exact.
function literal(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties.map((property) => {
        if (
          !ts.isPropertyAssignment(property) ||
          ts.isComputedPropertyName(property.name)
        )
          throw Error("Nonliteral official avatar data");
        return [property.name.text, literal(property.initializer)];
      }),
    );
  throw Error("Executable expression in official avatar data");
}
function sourceAst(directory, record) {
  const text = readFileSync(resolve(directory, record.file), "utf8");
  const ast = ts.createSourceFile(
    record.url,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (ast.parseDiagnostics.length)
    throw Error("Official avatar module does not parse");
  return ast;
}
function visit(ast, callback) {
  callback(ast);
  ts.forEachChild(ast, (node) => visit(node, callback));
}

export async function generateOfficialAvatars() {
  return withPinnedRelease(async ({ directory, metadata }) => {
    const lock = JSON.parse(
      readFileSync(resolve(directory, "release-lock.json"), "utf8"),
    );
    const module = lock.files.find((r) =>
      r.url.endsWith("/assets/app-shell-DOYrxQ-_.js"),
    );
    const locale = lock.files.find((r) =>
      r.url.endsWith("/assets/zh-cn-zgUfP7tb.js"),
    );
    if (!module || !locale)
      throw Error("Pinned whole-release avatar inputs missing");
    const candidates = [];
    visit(sourceAst(directory, module), (node) => {
      if (
        ts.isObjectLiteralExpression(node) &&
        ["palette", "avatars", "series", "reservedKeys", "defaultKey"].every(
          (key) =>
            node.properties.some(
              (p) => ts.isPropertyAssignment(p) && p.name.text === key,
            ),
        )
      )
        candidates.push(node);
    });
    if (candidates.length !== 1)
      throw Error("Ambiguous official avatar catalog");
    const catalog = literal(candidates[0]);
    const labels = {};
    visit(sourceAst(directory, locale), (node) => {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.text?.startsWith("agent.avatar.series.")
      )
        labels[node.name.text.slice("agent.avatar.series.".length)] = literal(
          node.initializer,
        );
    });
    const keys = catalog.series.flatMap((series) => series.avatars);
    if (
      catalog.version !== 2 ||
      catalog.series.length !== 9 ||
      keys.length !== 72 ||
      new Set(keys).size !== 72 ||
      Object.keys(catalog.avatars).length !== 74
    )
      throw Error("Unexpected Web1.21.40 avatar catalog");
    if (
      JSON.stringify(keys) !==
      JSON.stringify(
        Object.keys(catalog.avatars).filter(
          (key) => !catalog.reservedKeys.includes(key),
        ),
      )
    )
      throw Error("Native series/picker ordering differs");
    for (const series of catalog.series)
      if (!labels[series.key])
        throw Error("Missing official Chinese group label");
    const provenance = {
      kind: "generated data binding from the complete immutable Web release; not a page-source port",
      release: metadata.release,
      archiveSha256: metadata.sha256,
      inputs: [module, locale].map((r) => ({ url: r.url, sha256: r.sha256 })),
      series: 9,
      selectable: 72,
      reserved: catalog.reservedKeys,
      legacyArt:
        "Existing custom/Pokémon references remain read compatible; not selectable or randomly assigned",
    };
    const raw = {
      "frontends/raft/loom/avatars/official.json": JSON.stringify(catalog),
      "frontends/raft/loom/avatars/official-series-labels.json":
        JSON.stringify(labels),
      "frontends/raft/loom/avatars/official.provenance.json":
        JSON.stringify(provenance),
      "packages/protocol/src/raft-agent-avatar-keys.ts": `// GENERATED DATA from complete official Web1.21.40; run scripts/official-web/generate-official-avatars.mjs.\nexport const RAFT_AGENT_AVATAR_KEYS: readonly string[] = ${JSON.stringify(keys)};\n`,
    };
    const files = {};
    for (const [path, source] of Object.entries(raw))
      files[path] = await prettier.format(source, {
        parser: path.endsWith(".json") ? "json" : "typescript",
      });
    return { files, catalog, keys, labels };
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  for (const [path, source] of Object.entries(
    (await generateOfficialAvatars()).files,
  ))
    writeFileSync(path, source);
