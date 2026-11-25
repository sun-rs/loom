import { turnActivity } from '../adapters/codex/activity.mjs';
import { toolExitCode } from '../adapters/claude/tool-evidence.mjs';
import { agyCommands, codexCommands } from '../evidence/transcript.mjs';

const readName = /^(?:read|read_file|view_file|view_image)$/i;
const editName = /(?:patch|edit|write_file|write_to_file|replace_file_content|multi_replace|create_file|^write$|filechange)/i;
const shellName = /^(?:exec_command|shell_command|run_command|Bash|Terminal|commandExecution)$/i;
export const textOf = value => typeof value === 'string' ? value : Array.isArray(value) ?
  value.map(part => textOf(part?.text ?? part)).filter(Boolean).join('\n') : null;

export function decode(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

const commandText = value => Array.isArray(value) && value.every(part => typeof part === 'string') ?
  value.join(' ') : textOf(value);
const argsOf = value => decode(value?.arguments ?? value?.input ?? value?.args) ?? {};
const pathsOf = (value, args) => [args.path, args.file_path, args.filePath, args.Path, args.TargetFile, args.TargetPath,
  args.notebook_path, value.path, value.file_path, ...(Array.isArray(args.paths) ? args.paths : [])]
  .filter(path => typeof path === 'string');
const patchPaths = patch => typeof patch === 'string' ?
  [...patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map(match => match[1]) : [];
const timeOf = row => row.timestamp ?? row.created_at ?? row.receivedAt ?? row.at ?? null;

export function turnTools(provider, turn, rows) {
  const tools = new Map();
  const raw = rows.map(({ row }) => row);
  const canonical = provider === 'codex' && !raw.some(row => row.type === 'tool_call_started') ?
    codexCommands(raw, turn) : provider === 'agy' ?
      agyCommands([...new Map(raw.map(row => [row.step_index == null ? Symbol() : String(row.step_index), row])).values()],
        null, true) : [];
  const canonicalIds = new Set(canonical.map(tool => tool.id).filter(id => id != null));
  function call(id, name, value, row, position) {
    const args = argsOf(value);
    const command = commandText(value.command ?? value.action?.command ?? args.command ?? args.cmd ?? args.CommandLine ?? value.cmd ??
      (name === 'commandExecution' && typeof value.input === 'string' ? value.input : null));
    if (provider === 'codex' && (name === 'exec' || shellName.test(name ?? '') && row.payload)) return;
    if (provider === 'agy' && shellName.test(name ?? '')) return;
    const paths = [...pathsOf(value, args), ...patchPaths(textOf(value.input) ?? textOf(args.patch))];
    const key = id ?? Symbol();
    const previous = tools.get(key);
    if (previous) {
      previous.paths = [...new Set([...previous.paths, ...paths])];
      previous.command ??= command;
      return;
    }
    const tool = command || shellName.test(name ?? '') ? 'shell' : editName.test(name ?? '') ? 'edit' :
      readName.test(name ?? '') ? 'read' : 'other';
    tools.set(key, { tool, name: name ?? 'unknown', command, paths, exitCode: null, output: null,
      timestamp: timeOf(row), position });
  }

  function result(id, value, exitCode) {
    const item = tools.get(id);
    if (!item) return;
    const output = textOf(value.aggregated_output ?? value.aggregatedOutput ?? value.output ?? value.content) ??
      ([value.stderr, value.stdout].filter(part => typeof part === 'string').join('\n') || null);
    const code = exitCode ?? value.exit_code ?? value.exitCode;
    if (Number.isSafeInteger(code)) item.exitCode = code;
    item.output = output ?? item.output;
    item.denied ||= value.denied === true || value.status === 'denied' || value.result === 'denied' ||
      value.is_error === true && /^\s*(?:(?:tool )?permission (?:refused|denied)|sandbox (?:denied|blocked))/i.test(output ?? '');
  }

  for (const [position, row] of raw.entries()) {
    const payload = row.payload;
    if (provider === 'codex' && payload) {
      if (payload.turn_id != null && turn.id != null && String(payload.turn_id) !== String(turn.id)) continue;
      const item = payload.item ?? payload;
      const id = item.call_id ?? item.id;
      if (['apply_patch_begin', 'tool_call', 'mcp_tool_call_begin', 'web_search_begin'].includes(payload.type) ||
          /_call$/.test(payload.type)) {
        if (!canonicalIds.has(id)) call(id, item.name ?? payload.type, item, row, position);
      }
      if (payload.type === 'item_completed' && /^FileChange$/i.test(item.type ?? '')) {
        call(id, item.type, item, row, position);
      }
      if (payload.type === 'item_completed' || /(?:_call_output|apply_patch_end)$/.test(payload.type)) result(id, item);
    } else if (provider === 'claude' && ['user', 'assistant'].includes(row.type) && !row.isSidechain && !row.isMeta &&
        row.parent_tool_use_id == null && row.parentToolUseId == null) {
      const blocks = row.message?.content ?? row.content;
      if (!Array.isArray(blocks)) continue;
      const results = blocks.filter(block => block.type === 'tool_result');
      const metadata = results.length === 1 ? row.toolUseResult ?? row.tool_use_result : null;
      for (const block of blocks) {
        if (block.type === 'tool_use') call(block.id, block.name, block, row, position);
        if (block.type === 'tool_result') result(block.tool_use_id, { ...metadata, ...block },
          toolExitCode(block, metadata) ?? (block.is_error || metadata?.backgroundTaskId || metadata?.interrupted ? null : 0));
      }
    } else {
      if (row.type === 'tool_call_ended') { result(row.callId, row); continue; }
      if (['tool_call_started', 'tool_call_input'].includes(row.type)) {
        call(row.callId, row.tool ?? row.toolName ?? tools.get(row.callId)?.name, row, row, position);
        continue;
      }
      for (const value of row.tool_calls ?? row.toolCalls ?? []) {
        call(value.call_id ?? value.tool_call_id ?? value.id, value.name ?? value.tool_name, value, row, position);
      }
    }
  }
  if (provider === 'codex' && !raw.length) {
    for (const tool of turnActivity.get(turn)?.tools.values() ?? []) {
      if (!tool.command || tool.name === 'exec') continue;
      canonical.push({ ...tool, position: 0 });
    }
  }
  const shell = canonical.map(({ id, resultPosition, chunk, ...tool }) => ({
    ...tool, tool: 'shell', paths: [], timestamp: tool.timestamp ?? null, output: tool.output ?? null,
  }));
  return [...tools.values(), ...shell].sort((a, b) => a.position - b.position)
    .map(({ position, ...tool }, i) => ({ ...tool, ordinal: i + 1 }));
}
