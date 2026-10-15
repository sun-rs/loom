/** Exact upstream seams, no edits to the frozen native source. */
function replace(source: string, from: string, to: string) {
  if (source.split(from).length !== 2)
    throw Error("Official channel task boundary changed");
  return source.replace(from, to);
}
export function adaptTaskComposer(source: string) {
  let code = replace(
    source,
    "onSendOverride?: (content: string, mentions: MessageMention[]) => Promise<void>;",
    "onSendOverride?: (content: string, mentions: MessageMention[], asTask?: boolean) => Promise<void>;",
  );
  return replace(
    code,
    "await onSendOverride(msg, mentionsToSend);",
    "await onSendOverride(msg, mentionsToSend, submitAsTask);\n        if (submitAsTask) setAlsoCreateTask(false);",
  );
}
export function adaptTaskMessage(source: string) {
  let code = replace(
    source,
    "className }: MessageItemProps) {",
    "className }: MessageItemProps) {\n  const loomTaskActions = useLoomTaskActions(message, !parentMessageId && !hideThreadActions);\n  linkedTask = linkedTask ?? loomTaskActions?.task;",
  );
  for (const [prop, handler] of [
    ["onContextMenu", "handleContextMenu"],
    ["onTouchStart", "handleTouchStart"],
    ["onTouchEnd", "handleTouchEnd"],
    ["onTouchMove", "handleTouchMove"],
  ])
    code = replace(
      code,
      `${prop}={readOnlyProjection ? undefined : ${handler}}`,
      `${prop}={readOnlyProjection && !loomTaskActions ? undefined : ${handler}}`,
    );
  code = replace(
    code,
    "          {/* Reaction quick row",
    "          {readOnlyProjection ? <LoomTaskMenu actions={loomTaskActions} close={handleCloseCtx} /> : <>\n          {/* Reaction quick row",
  );
  code = replace(
    code,
    "          </>\n        </ContextMenuPopup>",
    "          </>}\n          </>\n        </ContextMenuPopup>",
  );
  code = replace(
    code,
    "onClick={openLinkedTask}",
    "onClick={loomTaskActions ? () => loomTaskActions.open(linkedTask.id) : openLinkedTask}",
  );
  return (
    'import { useLoomTaskActions, LoomTaskMenu } from "loom-channel-tasks";\n' +
    code
  );
}
