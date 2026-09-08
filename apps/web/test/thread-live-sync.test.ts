import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readUiSource } from "./ui-source.ts";

test("open Thread follows completed Room reconciliation even when activity refresh cancels the reload timer", () => {
  const source = readUiSource("App.tsx");
  const file = ts.createSourceFile(
    "App.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let dependencies: string[] | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useEffect" &&
      node.arguments[0]?.getText(file).includes("threadMessageSessions.current")
    ) {
      const deps = node.arguments[1];
      assert.ok(deps && ts.isArrayLiteralExpression(deps));
      dependencies = deps.elements.map((element) => element.getText(file));
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(
    dependencies?.includes("roomData"),
    "Thread must follow committed Room data, not only the reload timer that other refreshes can cancel",
  );
});
