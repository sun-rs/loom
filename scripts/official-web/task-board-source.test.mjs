import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
test("task board and card use reproducible official source boundaries without runtime rewriting", async () => {
  const { generateTaskBoard } = await import("./generate-task-board.mjs");
  for (const [name, content] of Object.entries(generateTaskBoard()))
    assert.equal(readFileSync("frontends/raft/loom/" + name, "utf8"), content);
  const vite = readFileSync("frontends/raft/loom/vite.config.ts", "utf8");
  assert.doesNotMatch(
    vite,
    /exposeTaskPresentation|adaptTaskCard|loom-task-board-actions/,
  );
  assert.equal(existsSync("frontends/raft/loom/task-adaptation.ts"), false);
  assert.doesNotMatch(
    readFileSync("frontends/raft/loom/TasksPage.tsx", "utf8"),
    /@ts-expect-error|components\/task\/TasksPanel/,
  );
});
test("task virtualization is a direct official dependency, preserving one shared layout context", () => {
  const pkg = JSON.parse(
    readFileSync(
      "frontends/raft/upstream/raft-web-source/package.json",
      "utf8",
    ),
  );
  assert.equal(
    pkg.exports["./VirtualizedTaskStack"],
    "./packages/web/src/components/task/VirtualizedTaskStack.tsx",
  );
  const bridge = readFileSync(
    "frontends/raft/packages/web/src/components/task/VirtualizedTaskStack.tsx",
    "utf8",
  );
  assert.match(bridge, /@loom\/raft-web-source\/VirtualizedTaskStack/);
  assert.doesNotMatch(bridge, /createContext|useVirtualizer/);
});
test("Loom permission and unknown-write guards survive source extraction", async () => {
  const { generateTaskBoard } = await import("./generate-task-board.mjs");
  const generated = generateTaskBoard();
  assert.match(
    generated["OfficialTaskBoard.generated.tsx"],
    /requestedDisabled \|\| !actions.canEditStatus \|\| actions.busy/,
  );
  assert.match(
    generated["OfficialTaskCard.generated.tsx"],
    /disabled=\{busy\}/,
  );
  assert.doesNotMatch(
    Object.values(generated).join(""),
    /useTaskStore|useAuthStore|useServerPermissions|updateTaskStatus\(/,
  );
});
