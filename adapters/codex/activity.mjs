export const turnActivity = new WeakMap();

function parseJson(text) {
  if (typeof text !== 'string') return text;
  try { return JSON.parse(text); } catch { return null; }
}

function commandText(value) {
  if (Array.isArray(value) && value.every(part => typeof part === 'string')) return value.join(' ');
  return typeof value === 'string' && value.trim() ? value : null;
}

function shellCommand(payload) {
  const args = parseJson(payload.arguments);
  const command = commandText(payload.command ?? payload.action?.command ?? args?.cmd ?? args?.command);
  if (command) return command;
  if (payload.name !== 'exec' || typeof payload.input !== 'string') return null;
  // The experimental rollout uses a script tool. Extract its literal command without running it.
  const literal = /\btools\.exec_command\(\s*\{\s*cmd\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/s
    .exec(payload.input)?.[1];
  if (!literal) return null;
  return literal.startsWith('"') ? parseJson(literal) ?? literal : literal.slice(1, -1);
}

function exitCode(output) {
  // Limit legacy exec status detection to the tool envelope before its stdout.
  for (const block of Array.isArray(output) ? output : [output]) {
    const text = typeof block === 'string' ? block : block?.text;
    const metadata = parseJson(text);
    if (Number.isInteger(metadata?.exit_code)) return metadata.exit_code;
    if (typeof text !== 'string') continue;
    const match = /^Chunk ID: [^\r\n]+\r?\nWall time: [^\r\n]+\r?\nProcess exited with code (-?\d+)\b/.exec(text);
    if (match) return Number(match[1]);
  }
  return null;
}

function noteTool(tools, id, name, command, status) {
  const key = id ?? Symbol();
  const previous = tools.get(key);
  tools.set(key, {
    name: previous?.name ?? name,
    command: previous?.command ?? command,
    exitCode: status ?? previous?.exitCode ?? null,
  });
}

export function noteResponseTool(tools, payload) {
  const id = payload.call_id ?? payload.id;
  if (payload.type.endsWith('_call')) {
    noteTool(tools, id, payload.name ?? payload.type, shellCommand(payload));
  } else if (payload.type.endsWith('_call_output') && tools.has(id)) {
    const code = exitCode(payload.output);
    if (code !== null) tools.get(id).exitCode ??= code;
  }
}

const toolEvents = new Map([
  ['tool_call', 'tool'],
  ['exec_command_begin', 'exec_command'],
  ['exec_command_end', 'exec_command'],
  ['mcp_tool_call_begin', 'mcp_tool_call'],
  ['web_search_begin', 'web_search'],
  ['apply_patch_begin', 'apply_patch'],
]);

export function noteEventTool(tools, payload) {
  const name = toolEvents.get(payload.type);
  if (name) {
    noteTool(tools, payload.call_id ?? payload.id, payload.name ?? name, shellCommand(payload),
      Number.isInteger(payload.exit_code) ? payload.exit_code : null);
    return;
  }
  const item = payload.item;
  if (payload.type === 'item_completed' && ['CommandExecution', 'commandExecution'].includes(item?.type)) {
    noteTool(tools, item.call_id ?? item.id, 'exec_command', commandText(item.command),
      Number.isInteger(item.exit_code ?? item.exitCode) ? (item.exit_code ?? item.exitCode) : null);
  }
}
