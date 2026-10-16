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
  assert.ok(
    result.includes(
      source.slice(
        source.indexOf("function DroppableColumn("),
        source.indexOf("export default"),
      ),
    ),
  );
  assert.ok(
    result.includes(
      "requestedDisabled || !actions.canEditStatus || actions.busy",
    ),
  );
  assert.ok(result.endsWith("export { TaskSection, DroppableColumn };\n"));
  assert.throws(() => exposeTaskPresentation("changed upstream"));
});
test("native card keeps its editor markup while writes use the scoped Loom owner", async () => {
  const { adaptTaskCard } =
    await import("../../frontends/raft/loom/task-adaptation.ts");
  const source = readFileSync(
    "frontends/raft/packages/web/src/components/task/TaskCard.tsx",
    "utf8",
  );
  const result = adaptTaskCard(source);
  const render = source.slice(source.indexOf("\n  return ("));
  assert.ok(
    result.includes(
      render.replace(
        "              open={editingStatus}",
        "              disabled={busy}\n              open={editingStatus}",
      ),
    ),
  );
  assert.ok(result.includes("useTaskCardActions(task)"));
  assert.throws(() => adaptTaskCard("changed upstream"));
});
