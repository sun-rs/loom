import ts from "typescript";
import { resolve } from "node:path";
import { readdir, readFile, writeFile } from "node:fs/promises";
const base = resolve(import.meta.dirname, "../.."),
  dir = base + "/frontends/raft/loom",
  rows = [];
for (const name of (await readdir(dir))
  .filter((n) => n.endsWith(".tsx"))
  .sort()) {
  const text = await readFile(dir + "/" + name, "utf8"),
    sf = ts.createSourceFile(
      name,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
    imports = new Map();
  sf.statements.filter(ts.isImportDeclaration).forEach((n) => {
    const b = n.importClause;
    if (b?.name) imports.set(b.name.text, n.moduleSpecifier.text);
    if (b?.namedBindings && ts.isNamedImports(b.namedBindings))
      for (const e of b.namedBindings.elements)
        imports.set(
          e.name.text,
          n.moduleSpecifier.text + "#" + (e.propertyName?.text ?? e.name.text),
        );
  });
  function visit(n) {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(sf),
        attrs = {};
      for (const a of n.attributes.properties)
        if (ts.isJsxAttribute(a))
          attrs[a.name.getText(sf)] = a.initializer
            ? ts.isStringLiteral(a.initializer)
              ? a.initializer.text
              : a.initializer.getText(sf)
            : true;
      const handler = Object.hasOwn(attrs, "onClick"),
        role = attrs.role;
      if (
        /Button|Action$|Trigger$|Close$|MenuItem$|SidebarItem$|SegmentedControlItem$|AppRailItem$/.test(
          tag,
        ) ||
        tag === "button" ||
        (handler && ["a", "div", "span"].includes(tag)) ||
        role === "button"
      ) {
        const parent = ts.isJsxElement(n.parent) ? n.parent : undefined;
        rows.push({
          file: "frontends/raft/loom/" + name,
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          component: tag,
          source: imports.get(tag) ?? "DOM/local",
          variant: attrs.variant ?? null,
          size: attrs.size ?? null,
          className: attrs.className ?? null,
          label: attrs["aria-label"] ?? attrs.title ?? null,
          role: role ?? null,
          type: attrs.type ?? null,
          text: parent
            ? parent.children
                .map((c) => (ts.isJsxText(c) ? c.text.trim() : ""))
                .filter(Boolean)
                .join(" ")
                .slice(0, 100)
            : "",
          nativeButton: tag === "button",
        });
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
}
const count = (key) =>
  Object.fromEntries(
    [...new Set(rows.map((r) => r[key] ?? "(default)"))]
      .map((k) => [k, rows.filter((r) => (r[key] ?? "(default)") === k).length])
      .sort((a, b) => b[1] - a[1]),
  );
const result = {
  scope:
    "All top-level Loom TSX files; syntactic action/control callsites, not rendered button count or parity coverage. Frozen upstream subtrees and generated descendants are referenced through component owners, not individually enumerated.",
  filesScanned: (await readdir(dir)).filter((n) => n.endsWith(".tsx")).length,
  summary: { callsites: rows.length, components: count("component") },
  rows,
};
await writeFile(
  base + "/docs/evo/evidence/2026-10-19-button-audit/inventory.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result.summary));
