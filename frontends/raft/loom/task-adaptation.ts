/** Export existing presentation only; keep frozen upstream code unchanged. */
export function exposeTaskPresentation(source: string) {
  for (const name of ["TaskSection", "DroppableColumn"])
    if (source.split(`function ${name}(`).length !== 2)
      throw Error("Official task presentation boundary changed");
  const marker =
    "  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled });";
  if (source.split(marker).length !== 2)
    throw Error("Official draggable wrapper changed");
  const code = source
    .replace("  disabled = false,", "  disabled: requestedDisabled = false,")
    .replace(
      marker,
      "  const actions = useTaskCardActions(task);\n  const disabled = requestedDisabled || !actions.canEditStatus || actions.busy;\n" +
        marker,
    );
  return (
    'import { useTaskCardActions } from "loom-task-board-actions";\n' +
    code +
    "\nexport { TaskSection, DroppableColumn };\n"
  );
}
/** Keep the native status editor; replace only its disconnected store controller. */
export function adaptTaskCard(source: string) {
  const start = source.indexOf("  const updateTaskStatus = useTaskStore(");
  const end = source.indexOf("\n  return (", start);
  if (
    start < 0 ||
    end < 0 ||
    !source
      .slice(start, end)
      .includes("await updateTaskStatus(task.channelId, task.id, nextStatus);")
  )
    throw Error("Official task card boundary changed");
  return (
    'import { useTaskCardActions } from "loom-task-board-actions";\n' +
    source.slice(0, start) +
    "  const { formatMessage, editingStatus, busy, canEditStatus, statusOptions, style, handleStatusSelect, toggleStatusEditor, closeStatusEditor } = useTaskCardActions(task);\n" +
    source
      .slice(end)
      .replace(
        "              open={editingStatus}",
        "              disabled={busy}\n              open={editingStatus}",
      )
  );
}
