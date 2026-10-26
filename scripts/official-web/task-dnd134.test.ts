import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  taskDropStatus,
  taskDropAllowed,
} from "../../frontends/raft/loom/task-drag-policy.ts";
test("drop data admits only known states and a currently editable authorized transition", () => {
  const task = { id: "t", status: "todo" };
  const board = {
    state: "idle",
    canEdit: () => true,
    options: () => ["in_progress"],
  };
  assert.equal(taskDropStatus({ status: "bogus" }), undefined);
  assert.equal(taskDropStatus(undefined), undefined);
  assert.equal(
    taskDropAllowed("t", { status: "in_progress" }, [task], board),
    true,
  );
  assert.equal(
    taskDropAllowed("other", { status: "in_progress" }, [task], board),
    false,
  );
  assert.equal(taskDropAllowed("t", { status: "done" }, [task], board), false);
  assert.equal(taskDropAllowed("t", { status: "todo" }, [task], board), true);
  assert.equal(
    taskDropAllowed("t", { status: "in_progress" }, [task], {
      ...board,
      state: "unknown",
    }),
    false,
  );
  assert.equal(
    taskDropAllowed("t", { status: "in_progress" }, [task], {
      ...board,
      canEdit: () => false,
    }),
    false,
  );
});
test("page delegates all sensors to official TaskDndProvider and restores focus after confirmed projection", () => {
  const page = readFileSync("frontends/raft/loom/TasksPage.tsx", "utf8");
  assert.match(page, /<TaskDndProvider/);
  assert.doesNotMatch(page, /PointerSensor|TouchSensor|useSensors|<DndContext/);
  const hook = readFileSync("frontends/raft/loom/useTaskDrag.ts", "utf8");
  assert.match(hook, /focusMovedTaskCard/);
  assert.match(hook, /task.status === focus.status/);
  assert.match(hook, /await board.update/);
});
test("generated columns use native blocked/allowed placeholders and keep identity", () => {
  const source = readFileSync(
    "frontends/raft/loom/OfficialTaskBoard.generated.tsx",
    "utf8",
  );
  for (const component of [
    "TaskDraggable",
    "TaskDropZone",
    "TaskDropPlaceholder",
    "TaskBoardColumnEmptyBlocked",
    "TaskBoardColumnEmptyAllowed",
  ])
    assert.ok(source.includes(component), component);
  assert.match(source, /data-task-id=\{task.id\}/);
  assert.doesNotMatch(source, /useDraggable|useDroppable/);
});
test("drag accessibility uses Chinese display titles and never reports success on drop alone", () => {
  const hook = readFileSync("frontends/raft/loom/useTaskDrag.ts", "utf8");
  assert.match(hook, /screenReaderInstructions/);
  assert.match(hook, /announcements/);
  assert.match(hook, /任务状态更新结果/);
  assert.doesNotMatch(hook, /was moved|Draggable item/);
});
