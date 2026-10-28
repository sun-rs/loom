import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { generateRefresh135 } from "./generate-refresh135.mjs";
const root = "frontends/raft/",
  excerpts = JSON.parse(
    readFileSync(
      root + "upstream/published-2026-10-28/source-excerpts.json",
      "utf8",
    ),
  );
function publishedClass(code, id) {
  const f = ts.createSourceFile(
    "published.js",
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  let found;
  function visit(n) {
    if (ts.isObjectLiteralExpression(n)) {
      const props = n.properties.filter(ts.isPropertyAssignment),
        testId = props.find((p) => p.name.getText(f) === '"data-testid"');
      if (testId?.initializer.getText(f).includes(id)) {
        const value = props.find(
          (p) => p.name.getText(f) === "className",
        )?.initializer;
        if (value)
          found = ts.isTemplateExpression(value)
            ? value.head.text
            : ts.isNoSubstitutionTemplateLiteral(value) ||
                ts.isStringLiteral(value)
              ? value.text
              : undefined;
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(f);
  assert.ok(found, id + " source class");
  return found;
}
function generatedClass(code, id) {
  const f = ts.createSourceFile(
    "port.tsx",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let found;
  function visit(n) {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const props = n.attributes.properties.filter(ts.isJsxAttribute),
        testId = props.find((p) => p.name.getText(f) === "data-testid");
      if (testId?.initializer?.getText(f).includes(id)) {
        const value = props.find(
          (p) => p.name.getText(f) === "className",
        )?.initializer;
        if (value && ts.isStringLiteral(value)) found = value.text;
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(f);
  assert.ok(found, id + " port class");
  return found;
}
test("current resource ports regenerate exactly and retain published control recipes", () => {
  const generated = generateRefresh135();
  for (const [file, text] of Object.entries(generated))
    assert.equal(readFileSync(root + "loom/" + file, "utf8"), text, file);
  const toolbar = generated["OfficialActivityFilters.generated.tsx"];
  for (const id of ["inbox-toolbar", "inbox-filter-button"])
    assert.equal(
      generatedClass(toolbar, id),
      publishedClass(excerpts.activityToolbar.code, id),
    );
  for (const id of ["inbox-filter-chip", "inbox-filter-clear"])
    assert.equal(
      generatedClass(toolbar, id),
      publishedClass(excerpts.activityChip.code, id),
    );
  assert.ok(
    generated["OfficialRefresh135.generated.tsx"].includes(
      publishedClass(
        excerpts.computerGroupButton.code,
        "sidebar-agent-machine-group-toggle-",
      ),
    ),
  );
  assert.ok(
    generated["OfficialRefresh135.generated.tsx"].includes(
      "text-footnote text-foreground-hint",
    ),
  );
});
test("1.21.35 sidebar/list/panel registry is unchanged from the adopted 1.21.34 registry", async () => {
  const { officialPanelLayout } =
    await import("../../frontends/raft/upstream/published-2026-10-26/panel-layout.js");
  const f = ts.createSourceFile(
    "registry.js",
    "const " + excerpts.columnRegistry.code + ";",
    ts.ScriptTarget.Latest,
    true,
  );
  function literal(n) {
    if (ts.isObjectLiteralExpression(n))
      return Object.fromEntries(
        n.properties.map((p) => [p.name.getText(f), literal(p.initializer)]),
      );
    if (ts.isArrayLiteralExpression(n)) return n.elements.map(literal);
    if (ts.isNumericLiteral(n)) return Number(n.text);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
      return n.text;
    if (ts.isIdentifier(n) && n.text === "GF") return 8192;
    if (
      ts.isPrefixUnaryExpression(n) &&
      n.operator === ts.SyntaxKind.ExclamationToken &&
      ts.isNumericLiteral(n.operand)
    )
      return !Number(n.operand.text);
    throw Error("Unreviewed literal " + n.getText(f));
  }
  const registry = literal(
    f.statements[0].declarationList.declarations[0].initializer,
  );
  assert.deepEqual(registry, officialPanelLayout);
});
