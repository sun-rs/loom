// Read-only recipe comparison: equality of selected classes is not whole-page parity.
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
const slots = [
  "sidebarItem",
  "sidebarSection",
  "sidebarList",
  "sidebarSectionHeader",
  "sidebarSectionDisclosure",
  "sidebarSectionControl",
  "sidebarRoot",
];
function inspect(paths) {
  const trees = paths.map((p) =>
      ts.createSourceFile(p, readFileSync(p, "utf8"), 99, true, 1),
    ),
    vars = new Map();
  for (const sf of trees)
    for (const s of sf.statements)
      if (ts.isVariableStatement(s))
        for (const d of s.declarationList.declarations)
          if (ts.isIdentifier(d.name) && d.initializer)
            vars.set(d.name.text, d.initializer);
  function flatten(n, seen = new Set()) {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
      return [n.text];
    if (ts.isArrayLiteralExpression(n))
      return n.elements.flatMap((e) => flatten(e, seen));
    if (ts.isSpreadElement(n)) return flatten(n.expression, seen);
    if (ts.isIdentifier(n) && vars.has(n.text) && !seen.has(n.text))
      return flatten(vars.get(n.text), new Set([...seen, n.text]));
    return ["UNRESOLVED:" + n.getText().slice(0, 60)];
  }
  return Object.fromEntries(
    slots.map((slot) => {
      let found;
      function visit(n) {
        if (
          !found &&
          ts.isPropertyAssignment(n) &&
          n.name.getText().replace(/["'`]/g, "") === slot &&
          ts.isArrayLiteralExpression(n.initializer)
        )
          found = n.initializer;
        ts.forEachChild(n, visit);
      }
      for (const sf of trees) visit(sf);
      return [slot, found ? flatten(found) : null];
    }),
  );
}
const [previousFile, currentFile, outputFile] = process.argv.slice(2);
if (!previousFile || !currentFile || !outputFile)
  throw Error(
    "Usage: node compare-sidebar-recipes.mjs OLD_VENDOR NEW_VENDOR OUTPUT_JSON (repo root cwd)",
  );
const root = "frontends/raft/node_modules/raft-ui/dist/";
const npm = inspect(
  [
    "components/sidebar/sidebar-item.recipe.mjs",
    "components/sidebar/sidebar-section.recipe.mjs",
    "components/sidebar/sidebar.recipe.mjs",
    "lib/list-cell.mjs",
    "lib/head-edges.mjs",
  ].map((p) => root + p),
);
const old = inspect([previousFile]),
  current = inspect([currentFile]);
const result = Object.fromEntries(
  slots.map((s) => [
    s,
    {
      old: old[s],
      current: current[s],
      npm: npm[s],
      npmEqualsCurrent:
        current[s] !== null &&
        JSON.stringify(current[s]) === JSON.stringify(npm[s]),
    },
  ]),
);
writeFileSync(outputFile, JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(result).map(([k, v]) => [
        k,
        {
          npmEqualsCurrent: v.npmEqualsCurrent,
          unresolved: v.current?.filter((x) => x.startsWith("UNRESOLVED")),
        },
      ]),
    ),
  ),
);
