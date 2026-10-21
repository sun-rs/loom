import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDeclarations } from "./generate-appearance.mjs";
const root =
  "frontends/raft/upstream/raft-web-source/packages/web/src/components/task/";
const header =
  "// GENERATED from db5e399 official task presentation; explicit Loom permissions and writes. Do not edit.\n";
function replaceOnce(s, from, to) {
  if (s.split(from).length !== 2)
    throw Error("Official boundary changed: " + from);
  return s.replace(from, to);
}
function ruiImports(source) {
  const f = ts.createSourceFile(
    "official.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  return f.statements
    .filter(
      (n) =>
        ts.isImportDeclaration(n) &&
        n.moduleSpecifier.text === "@botiverse/raft-ui",
    )
    .map((n) => n.getText(f).replace("@botiverse/raft-ui", "raft-ui"))
    .join("\n");
}
export function generateTaskBoard() {
  const source = readFileSync(root + "TasksPanel.tsx", "utf8"),
    card = readFileSync(root + "TaskCard.tsx", "utf8");
  let declarations = extractDeclarations(source, [
    "SKELETON_LINE_WIDTHS",
    "TaskCardSkeleton",
    "getTaskKey",
    "STATUS_TO_RUI_STATUS",
    "TaskSection",
    "DraggableTaskWrapper",
    "DroppableColumn",
  ]).join("\n");
  declarations = replaceOnce(
    declarations,
    "  disabled = false,",
    "  disabled: requestedDisabled = false,",
  );
  const marker =
    "  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled });";
  declarations = replaceOnce(
    declarations,
    marker,
    "  const actions = useTaskCardActions(task);\n  const disabled = requestedDisabled || !actions.canEditStatus || actions.busy;\n" +
      marker,
  );
  let cardFn = extractDeclarations(card, ["TaskCard"])[0];
  const start = cardFn.indexOf("  const updateTaskStatus = useTaskStore("),
    end = cardFn.indexOf("\n  return (", start);
  if (start < 0 || end < 0) throw Error("Official task controller changed");
  cardFn =
    cardFn.slice(0, start) +
    "  const {formatMessage,editingStatus,busy,canEditStatus,statusOptions,style,handleStatusSelect,toggleStatusEditor,closeStatusEditor}=useTaskCardActions(task);\n" +
    cardFn.slice(end);
  cardFn = replaceOnce(
    cardFn,
    "              open={editingStatus}",
    "              disabled={busy}\n              open={editingStatus}",
  );
  return {
    "OfficialTaskBoard.generated.tsx":
      header +
      ruiImports(source) +
      `\nimport {useCallback} from "react";
import {useIntl} from "react-intl";
import {useDraggable,useDroppable} from "@dnd-kit/core";
import {CSS} from "@dnd-kit/utilities";
import type {Task,TaskStatus} from "../packages/web/src/store/taskStore";
import {TASK_STATUS_UI} from "../packages/web/src/components/task/taskStatusUi";
import {SkeletonRow} from "../packages/web/src/components/ui/Skeleton";
import VirtualizedTaskStack from "../packages/web/src/components/task/VirtualizedTaskStack";
import TaskCard from "./OfficialTaskCard.generated";
import {useTaskCardActions} from "./TaskBoardActions";\n` +
      declarations +
      "\nexport {TaskSection,DroppableColumn};\n",
    "OfficialTaskCard.generated.tsx":
      header +
      ruiImports(card) +
      `\nimport {memo} from "react";
import type {Task} from "../packages/web/src/store/taskStore";
import InlineBadgeEditor from "../packages/web/src/components/InlineBadgeEditor";
import {StatusBadge} from "../packages/web/src/components/task/StatusBadge";
import {toRuiTaskStatus} from "../packages/web/src/components/task/taskStatusUi";
import {useTaskCardActions} from "./TaskBoardActions";\n` +
      cardFn +
      "\nexport default memo(TaskCard);\n",
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  for (const [name, content] of Object.entries(generateTaskBoard()))
    writeFileSync("frontends/raft/loom/" + name, content);
