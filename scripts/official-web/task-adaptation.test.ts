import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { exposeTaskPresentation } from "../../frontends/raft/loom/task-adaptation.ts";
test("native task sections are exposed without rewriting their recipes or state", () => {
  const source = readFileSync(
    "frontends/raft/packages/web/src/components/task/TasksPanel.tsx",
    "utf8",
  );
  const result = exposeTaskPresentation(source);
  assert.ok(result.startsWith(source));
  assert.ok(result.endsWith("export { TaskSection, DroppableColumn };\n"));
  assert.throws(() => exposeTaskPresentation("changed upstream"));
});
