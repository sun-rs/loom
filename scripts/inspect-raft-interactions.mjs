import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Development evidence only. Never imported by the product renderer or daemon.
const EVENT =
  /^on(?:Click|DoubleClick|ContextMenu|Mouse\w+|Pointer\w+|Touch\w+|Focus|Blur|Key\w+|Submit|Change|Input|BeforeInput|Composition\w+|Drag\w+|Drop|Scroll|Wheel|Select|OpenChange|ValueChange|CheckedChange|SelectItem|InteractOutside|EscapeKeyDown|CloseAutoFocus|OpenAutoFocus)(?:Capture)?$/;
function propertyName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteral(node)
    ? node.text
    : undefined;
}
function ownerOf(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) && parent.name)
      return parent.name.text;
    if (
      (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
      ts.isVariableDeclaration(parent.parent) &&
      ts.isIdentifier(parent.parent.name)
    )
      return parent.parent.name.text;
  }
  return "<module-or-anonymous>";
}
export function inspectInteractionSource(filename, source) {
  const ast = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (ast.parseDiagnostics.length)
    throw new Error(
      `Cannot parse ${filename}: ${ast.parseDiagnostics[0].messageText}`,
    );
  const events = [],
    assets = new Set();
  const record = (node, event, handler, kind) => {
    const start = node.getStart(ast),
      end = node.getEnd();
    const position = ast.getLineAndCharacterOfPosition(start);
    events.push({
      event,
      kind,
      owner: ownerOf(node),
      startUtf16: start,
      endUtf16: end,
      line: position.line + 1,
      column: position.character + 1,
      source: source.slice(start, end).slice(0, 600),
      sourceTruncated: end - start > 600,
      handler: handler?.getText(ast).slice(0, 400) ?? null,
      semanticStatus: "untraced",
    });
  };
  const visit = (node) => {
    if (
      ts.isStringLiteral(node) &&
      /^(?:\.{1,2}\/|assets\/)[^?#]+\.(?:js|css)$/.test(node.text)
    )
      assets.add(node.text);
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name && EVENT.test(name))
        record(node, name, node.initializer, "property");
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "addEventListener" &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      record(node, node.arguments[0].text, node.arguments[1], "listener");
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return {
    filename,
    sha256: createHash("sha256").update(source).digest("hex"),
    bytes: Buffer.byteLength(source),
    semanticCoverage: "not-evaluated",
    assetReferences: [...assets].sort(),
    events,
  };
}
async function main() {
  const [directory, output] = process.argv.slice(2);
  if (!directory || !output)
    throw new Error(
      "Usage: node scripts/inspect-raft-interactions.mjs <archived-js-directory> <new-output.json>",
    );
  const root = resolve(directory),
    files = [];
  for (const name of (await readdir(root))
    .filter((n) => n.endsWith(".js"))
    .sort())
    files.push(
      inspectInteractionSource(name, await readFile(join(root, name), "utf8")),
    );
  const present = new Set(files.map((f) => f.filename));
  const referencedJs = [
    ...new Set(
      files
        .flatMap((f) => f.assetReferences)
        .filter((p) => p.endsWith(".js"))
        .map((p) => basename(p)),
    ),
  ].sort();
  const missingReferencedJs = referencedJs.filter((n) => !present.has(n));
  const byEvent = {};
  for (const f of files)
    for (const e of f.events) byEvent[e.event] = (byEvent[e.event] ?? 0) + 1;
  const result = {
    schemaVersion: 1,
    sourceDirectory: root,
    warning:
      "Candidate event sites, not a complete interaction contract. Data-driven callbacks, missing chunks and server-conditioned branches require manual tracing and browser checks. No semantic or browser pass is implied.",
    summary: {
      files: files.length,
      eventSites: files.reduce((n, f) => n + f.events.length, 0),
      byEvent,
      missingReferencedJs,
    },
    files,
  };
  await mkdir(dirname(resolve(output)), { recursive: true });
  // Generated evidence must not overwrite a previous frozen capture.
  await writeFile(resolve(output), JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
  });
  process.stdout.write(JSON.stringify(result.summary, null, 2) + "\n");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
