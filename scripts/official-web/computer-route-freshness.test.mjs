import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync("frontends/raft/loom/ChannelApp.tsx", "utf8");
const ast = ts.createSourceFile(
  "ChannelApp.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let body;
function walk(node) {
  if (
    ts.isJsxSelfClosingElement(node) &&
    node.tagName.getText(ast) === "ComputersPage"
  ) {
    const select = node.attributes.properties.find(
      (p) => ts.isJsxAttribute(p) && p.name.getText(ast) === "onSelect",
    );
    const expression = select?.initializer?.expression;
    if (
      expression &&
      ts.isArrowFunction(expression) &&
      ts.isBlock(expression.body)
    )
      body = expression.body.statements.map((s) => s.getText(ast)).join("\n");
  }
  ts.forEachChild(node, walk);
}
walk(ast);
assert.ok(body, "Computer selection binding must remain inspectable");
function select(actualSearch, blocked = false) {
  let navigated;
  // Router setter captured when the Computers page rendered. A later page click
  // has already updated the actual URL before inventory auto-select completes.
  const captured = new URLSearchParams("?view=computers&room=r");
  const fn = vm.runInNewContext(`(id)=>{${body}}`, {
    URLSearchParams,
    window: { location: { search: actualSearch } },
    hasRouteBoundIntent: () => blocked,
    setParams: (update) => {
      navigated = update(captured);
    },
  });
  fn("host-a");
  return navigated;
}
test("late computer auto-selection cannot replace a newer destination", () => {
  assert.equal(select("?view=tasks&room=r"), undefined);
});
test("computer selection retains current route fields and the write-intent fence", () => {
  assert.equal(
    select("?view=computers&room=r").toString(),
    "view=computers&room=r&computer=host-a",
  );
  assert.equal(select("?view=computers", true), undefined);
});
