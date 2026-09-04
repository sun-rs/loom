import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  taskAttentionLabel,
  taskStatusPresentation,
} from "../src/task-presentation.ts";

const readRaftBundle = () =>
  readFile(
    new URL(
      "../../../docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js",
      import.meta.url,
    ),
    "utf8",
  );

test("all task surfaces share the five Raft status labels and tones", () => {
  assert.deepEqual(taskStatusPresentation("todo"), {
    id: "todo",
    label: "待办",
    tone: "orange",
  });
  assert.deepEqual(taskStatusPresentation("waiting_input"), {
    id: "in-progress",
    label: "进行中",
    tone: "cyan",
  });
  assert.deepEqual(taskStatusPresentation("submitted"), {
    id: "review",
    label: "待确认",
    tone: "purple",
  });
  assert.deepEqual(taskStatusPresentation("completed"), {
    id: "done",
    label: "完成",
    tone: "green",
  });
  assert.deepEqual(taskStatusPresentation("cancelled"), {
    id: "closed",
    label: "已关闭",
    tone: "gray",
  });
  assert.deepEqual(
    taskStatusPresentation({
      state: "submitted",
      workflowStatus: "in_progress",
    }),
    {
      id: "in-progress",
      label: "进行中",
      tone: "cyan",
    },
  );
  assert.equal(taskAttentionLabel({ state: "claimed" }), "已认领");
  assert.equal(taskAttentionLabel({ state: "waiting_input" }), "等待输入");
  assert.equal(
    taskAttentionLabel({ state: "blocked", blockedReason: "等待授权" }),
    "已阻塞：等待授权",
  );
  assert.equal(taskAttentionLabel({ state: "submitted" }), undefined);
});

test("Room Tasks reuse the Raft board instead of a second card workflow", async () => {
  const source = await readFile(
    new URL("../src/components/conversation-panes.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\{task\.state\}/u);
  assert.doesNotMatch(source, /agent\.handle\.slice\(0, 1\)/u);
  assert.match(source, /<GlobalTaskBoard/u);
  assert.doesNotMatch(
    source,
    /TaskCloseDialog|TaskReassignDialog|关闭任务|确认完成|重开为待办/u,
  );
});

test("global Tasks keeps the Raft heading semantics and has no local-only refresh action", async () => {
  const source = await readFile(
    new URL("../src/components/global-discovery.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /<h2>\{title\}<\/h2>/u);
  const taskSurface = source.slice(
    source.indexOf("function GlobalTasks("),
    source.indexOf("function GlobalSearch("),
  );
  assert.doesNotMatch(taskSurface, /onRefresh=/u);
  assert.doesNotMatch(taskSurface, /刷新任务/u);
});

test("Room and global Task cards follow Raft's channel-name scope", async () => {
  const raft = await readRaftBundle();
  const board = await readFile(
    new URL("../src/components/global-task-board.tsx", import.meta.url),
    "utf8",
  );
  const room = await readFile(
    new URL("../src/components/conversation-panes.tsx", import.meta.url),
    "utf8",
  );

  assert.match(raft, /showChannelName:!o/u);
  assert.match(raft, /showChannelName:!a/u);
  assert.match(board, /showRoomName = true/u);
  assert.match(board, /showRoomName=\{showRoomName\}/u);
  assert.match(board, /\{showRoomName \? <b>#\{roomName\}<\/b> : null\}/u);
  assert.match(room, /<GlobalTaskBoard[\s\S]*?showRoomName=\{false\}/u);
});

test("Task view toggles use Raft's exact icons and final shared 14px size", async () => {
  const raft = await readRaftBundle();
  const toolbar = await readFile(
    new URL("../src/components/task-toolbar.tsx", import.meta.url),
    "utf8",
  );
  const global = await readFile(
    new URL("../src/components/global-discovery.tsx", import.meta.url),
    "utf8",
  );
  const icon = await readFile(
    new URL(
      "../../../packages/ui-web/src/neo-brutalist/icon.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const styles = await readFile(
    new URL("../src/product.css", import.meta.url),
    "utf8",
  );
  const discoveryStyles = await readFile(
    new URL("../src/global-discovery.css", import.meta.url),
    "utf8",
  );
  const sprite = await readFile(
    new URL(
      "../../../packages/ui-tokens/src/interaction-icons.svg",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(raft, /ZUe=Et\("columns-3",XUe\)/u);
  assert.match(raft, /R3e=Et\("layout-list",I3e\)/u);
  assert.match(raft, /i\.jsx\(ZUe,\{size:12\}\)/u);
  assert.match(raft, /i\.jsx\(R3e,\{size:12\}\)/u);
  const segmented = raft.slice(
    raft.indexOf("const II=Lt("),
    raft.indexOf("function q5"),
  );
  assert.ok(
    segmented.includes("[&_svg:not([class*='size-'])]:size-3.5"),
    "the shared segmented CSS overrides the 12px SVG attribute with 14px",
  );
  assert.match(
    raft,
    /border-2 border-dashed border-black\/20 px-3 py-5 text-sm text-black\/40/u,
  );
  for (const source of [toolbar, global]) {
    assert.match(
      source,
      /<Icon name=\{mode === "board" \? "columns-3" : "layout-list"\} \/>/u,
    );
  }
  assert.match(icon, /"columns-3"[\s\S]*?"layout-list"/u);
  assert.match(sprite, /id="raft-icon-columns-3"/u);
  assert.match(sprite, /id="raft-icon-layout-list"/u);
  assert.match(
    styles,
    /\.tasks-view svg\s*\{[\s\S]*?height:\s*14px;[\s\S]*?width:\s*14px;/u,
  );
  const emptyGroup =
    discoveryStyles.match(
      /\.rah-global-kanban \.rah-empty-copy\s*\{[^}]*\}/u,
    )?.[0] ?? "";
  assert.match(emptyGroup, /margin:\s*0;/u);
  assert.match(emptyGroup, /padding:\s*20px 12px;/u);
  assert.match(emptyGroup, /text-align:\s*left;/u);
});

test("global Task cards keep Raft's separate drag and visual interaction layers", async () => {
  const board = await readFile(
    new URL("../src/components/global-task-board.tsx", import.meta.url),
    "utf8",
  );
  const filter = await readFile(
    new URL("../src/components/discovery-filter.tsx", import.meta.url),
    "utf8",
  );
  const styles = await readFile(
    new URL("../src/discovery-controls.css", import.meta.url),
    "utf8",
  );
  const discoveryStyles = await readFile(
    new URL("../src/global-discovery.css", import.meta.url),
    "utf8",
  );
  const interactionProtocol = await readFile(
    new URL(
      "../../../packages/ui-tokens/src/neo-brutalist/interaction-state.css",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(board, /data-testid="task-board-draggable-card"/u);
  assert.match(board, /className=\{`rah-global-task-drag-shell/u);
  assert.match(board, /setActivatorNodeRef/u);
  assert.match(
    board,
    /<button\s+type="button"\s+ref=\{setActivatorNodeRef\}\s+\{\.\.\.attributes\}[\s\S]*?className="rah-task-drag-handle"/u,
  );
  assert.match(
    board,
    /<div\s+draggable=\{false\}\s+className="kcard rah-global-task-card rah-interaction-brutal"/u,
  );
  assert.match(board, /className="kcol-body rah-interaction-shadow-host"/u);
  assert.doesNotMatch(
    board,
    /className=\{`kcard rah-global-task-card[^`]*`\}[\s\S]{0,160}CSS\.Translate/u,
  );
  assert.match(filter, /variant === "status" \? "pencil" : "chevron-down"/u);
  assert.match(
    styles,
    /\.rah-global-task-card\s*\{[\s\S]*?display:\s*block;[\s\S]*?gap:\s*normal;[\s\S]*?font:\s*400 16px\/24px var\(--sans\);/u,
  );
  assert.doesNotMatch(
    styles.match(/\.rah-global-task-card\s*\{[^}]*\}/u)?.[0] ?? "",
    /box-shadow/u,
  );
  assert.match(
    styles,
    /\.rah-global-card-open\s*\{[\s\S]*?display:\s*inline-block;/u,
  );
  assert.match(
    board,
    /<div className="rah-global-card-row">\s*<div className="rah-global-card-main">\s*<div className="kcard-no">/u,
  );
  assert.match(
    styles,
    /\.rah-global-card-row\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*flex-start;[\s\S]*?gap:\s*8px;/u,
  );
  assert.match(
    styles,
    /\.rah-global-task-card \.kcard-no span\s*\{[\s\S]*?font:\s*11px\/1\.5 var\(--mono\);/u,
  );
  assert.doesNotMatch(styles, /\.rah-global-task-card:(?:hover|active)\s*\{/u);
  assert.match(
    interactionProtocol,
    /\.rah-interaction-brutal:hover:not\(:disabled\)\s*\{[\s\S]*?transform:\s*var\(--rah-brutal-lift-hover-transform\);[\s\S]*?box-shadow:\s*var\(--rah-brutal-lift-hover-shadow\);/u,
  );
  assert.match(
    interactionProtocol,
    /\.rah-interaction-brutal:active:not\(:disabled\)\s*\{[\s\S]*?transform:\s*var\(--rah-brutal-lift-active-transform\);[\s\S]*?box-shadow:\s*var\(--rah-brutal-lift-active-shadow\);/u,
  );
  assert.match(
    styles,
    /\.rah-task-status-picker \.task-filter-trigger > svg:last-child\s*\{\s*width: 10px;\s*height: 10px;/u,
  );
  assert.match(
    board,
    /className="rah-task-state rah-task-status-picker"[\s\S]*?triggerClassName=\{`chip-\$\{column\.tone\}`\}/u,
    "Raft paints the status tone on the bordered button, never on its margin-owning wrapper",
  );
  assert.doesNotMatch(
    styles,
    /\.rah-task-status-picker\.chip-(?:orange|cyan|purple|green|gray)\s*\{/u,
    "a colored wrapper would remain visible through the trigger's 2px top margin",
  );
  for (const [tone, token] of [
    ["orange", "orange"],
    ["cyan", "cyan"],
    ["purple", "lavender"],
    ["green", "green"],
    ["gray", "gray-chip"],
  ] as const) {
    assert.match(
      styles,
      new RegExp(
        String.raw`\.rah-task-status-picker \.task-filter-trigger\.chip-${tone}\s*\{\s*background:\s*var\(--${token}\);`,
        "u",
      ),
    );
  }
  assert.match(
    styles,
    /\.rah-task-drag-handle\s*\{[\s\S]*?clip-path:\s*inset\(50%\);/u,
  );
  assert.doesNotMatch(
    discoveryStyles,
    /\.rah-global-task-card(?::hover)?\s*\{/u,
  );
  assert.match(
    discoveryStyles,
    /\.rah-global-kanban\.list-mode \.kcol-head\[aria-expanded="true"\]\s*\{\s*margin-bottom:\s*10px;/u,
  );
  assert.match(
    board,
    /options=\{columns\s*\.filter\([\s\S]*?globalTaskTransition\(task, item\.id, canManageAnyTask\)[\s\S]*?\.operation,[\s\S]*?\)\s*\.map\(\(item\) => \(\{/u,
  );
  assert.doesNotMatch(board, /disabledReason:\s*globalTaskTransition/u);
  assert.doesNotMatch(board, /TaskCloseDialog|请填写关闭原因/u);
});

test("global Task status changes use one Raft five-state workflow command", async () => {
  const actions = await readFile(
    new URL("../src/global-task-actions.ts", import.meta.url),
    "utf8",
  );
  assert.match(actions, /operation:\s*"task\.workflow\.update"/u);
  assert.match(actions, /client\.request\("task\.workflow\.update"/u);
  assert.doesNotMatch(
    actions,
    /canHumanCancelTask|canHumanReopenTask|canHumanCompleteTask/u,
  );
});
