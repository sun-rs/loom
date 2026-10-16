function replace(source: string, from: string, to: string) {
  if (source.split(from).length !== 2)
    throw Error("Official task creation boundary changed");
  return source.replace(from, to);
}
export function adaptTaskCreation(source: string) {
  let code = replace(
    source,
    "  onClose,\n}: {",
    "  onClose: requestClose,\n}: {",
  );
  const start = code.indexOf("  const { formatMessage } = useIntl();");
  const end = code.indexOf("\n  return (", start);
  if (
    start < 0 ||
    end < 0 ||
    !code.slice(start, end).includes("await createTasks(channelId, nonEmpty);")
  )
    throw Error("Official task creation controller changed");
  code =
    code.slice(0, start) +
    "  const { formatMessage } = useIntl();\n  const { titles, error, submitting, isBatch, onClose, handleSubmit, updateTitle, addRow, removeRow, verification } = useTaskCreation(channelId, requestClose);\n" +
    code.slice(end);
  code = replace(
    code,
    "    <DialogCard title=",
    '    <DialogCard testId="loom-create-tasks" title=',
  );
  code = replace(
    code,
    "          <div>\n            {titles.map",
    '          {verification}\n          <fieldset disabled={submitting} className="min-w-0 space-y-4">\n          <div>\n            {titles.map',
  );
  code = replace(
    code,
    "        </form>",
    "          </fieldset>\n        </form>",
  );
  return 'import { useTaskCreation } from "loom-task-create";\n' + code;
}
