import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import ts from "typescript";
const base = "frontends/raft/loom/";
const contract = JSON.parse(readFileSync(base + "ui-contract.json", "utf8"));
function controls(file) {
  const source = readFileSync(base + file, "utf8"),
    sf = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
    out = [],
    imports = new Map();
  for (const node of sf.statements)
    if (ts.isImportDeclaration(node)) {
      const c = node.importClause;
      if (c?.name) imports.set(c.name.text, node.moduleSpecifier.text);
      if (c?.namedBindings && ts.isNamedImports(c.namedBindings))
        for (const e of c.namedBindings.elements)
          imports.set(
            e.name.text,
            node.moduleSpecifier.text +
              "#" +
              (e.propertyName?.text ?? e.name.text),
          );
    }
  function walk(n) {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const props = {};
      for (const a of n.attributes.properties)
        if (
          ts.isJsxAttribute(a) &&
          a.initializer &&
          ts.isStringLiteral(a.initializer)
        )
          props[a.name.getText(sf)] = a.initializer.text;
      const tag = n.tagName.getText(sf);
      out.push({ tag, source: imports.get(tag), props });
    }
    ts.forEachChild(n, walk);
  }
  walk(sf);
  return out;
}
test("local detail dismissals reuse official CloseButton including Side and loading/error branches", () => {
  for (const file of contract.families.find((f) => f.id === "detail-close")
    .bindings) {
    const entries = controls(file).filter(
      (c) =>
        (c.props["aria-label"] ?? "").startsWith("关闭") &&
        c.props["data-testid"] !== "task-modal-mobile-back",
    );
    const close = entries.filter(
      (c) => !["DialogClose", "DrawerClose"].includes(c.tag),
    );
    assert.ok(close.length, file);
    for (const c of close)
      assert.equal(
        c.source,
        "../packages/web/src/components/ui/CloseButton.tsx",
        file + " " + c.props["aria-label"],
      );
  }
});
test("local official CloseButton calls carry an explicit semantic mobile target marker", () => {
  for (const file of readdirSync(base).filter((f) => f.endsWith(".tsx")))
    for (const c of controls(file))
      if (c.source === "../packages/web/src/components/ui/CloseButton.tsx")
        assert.equal(c.props["data-loom-control"], "detail-close", file);
});
test("header touch adaptation uses semantic controls rather than SVG/span nesting", () => {
  const css = readFileSync(base + "mobile.css", "utf8");
  assert.ok(!css.includes('[data-loom-control="detail-close"]'));
  assert.ok(css.includes("rUI 0.6 owns"));
  assert.ok(!css.includes("button:has(> svg):not(:has(span))"));
});

test("adoption registry references existing source owners, bindings and checks", () => {
  const ids = [...contract.families, ...contract.exceptions].map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const family of contract.families) {
    for (const path of family.sources) assert.ok(existsSync(path), path);
    for (const file of family.bindings ?? [])
      assert.ok(existsSync(base + file), file);
    if (family.guard) assert.ok(existsSync(family.guard));
  }
  for (const exception of contract.exceptions) {
    assert.ok(exception.owner && exception.rule);
    assert.ok(existsSync(exception.implementation));
    assert.ok(existsSync(exception.browser));
  }
});

test("new local close affordances cannot silently bypass scenario owners", () => {
  const allowed = new Set([
    "../packages/web/src/components/ui/CloseButton.tsx",
    "raft-ui#DialogClose",
    "raft-ui#DrawerClose",
  ]);
  for (const file of readdirSync(base).filter((f) => f.endsWith(".tsx"))) {
    for (const c of controls(file)) {
      if (!(c.props["aria-label"] ?? "").startsWith("关闭")) continue;
      const exception = contract.exceptions.find(
        (e) =>
          e.selector?.file === file &&
          e.selector.testId === c.props["data-testid"],
      );
      if (exception) {
        assert.equal(c.source, "raft-ui#Button", file);
        assert.equal(c.props["data-loom-control"], "panel-back", file);
      } else if (
        file === "InstanceInspector.tsx" &&
        c.props["aria-label"] === "关闭实例详情"
      ) {
        const scenario = contract.families.find(
          (f) => f.id === "profile-header-close",
        );
        assert.equal(scenario?.selector.file, file);
        assert.equal(scenario?.selector.ariaLabel, c.props["aria-label"]);
        assert.equal(c.source, "raft-ui#PanelAction");
        assert.equal(c.props.className, "hidden md:flex");
        assert.equal(c.props["data-loom-control"], "detail-close");
        assert.equal(c.props.size, undefined);
        assert.equal(c.props.variant, undefined);
      } else
        assert.ok(
          allowed.has(c.source),
          file +
            ": " +
            c.props["aria-label"] +
            " must select an official scenario owner or register a justified exception",
        );
    }
  }
});
