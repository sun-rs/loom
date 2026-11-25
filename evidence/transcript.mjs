import { claude } from '../adapters/claude/index.mjs';
import { isClaudeToolResultContent, toolExitCode } from '../adapters/claude/tool-evidence.mjs';
import { codex } from '../adapters/codex/index.mjs';
import { turnActivity } from '../adapters/codex/activity.mjs';
import { parseAgy } from '../adapters/agy/lib/parse-agy.mjs';
import { checkEvidence, checkKind, sandboxDenialCounts, shellBody } from './checks.mjs';

function json(text) {
  if (typeof text !== 'string') return text;
  try { return JSON.parse(text); } catch { return null; }
}

const string = value => typeof value === 'string' ? value : null;
const integer = value => Number.isSafeInteger(value) ? value : null;
const time = value => typeof value === 'number' ? value : Date.parse(value ?? '');
const elapsed = (start, end) => Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;

export function executionEvidence(commands) {
  return commands.flatMap(({ command, exitCode, durationMs }) => {
    const kind = checkKind(command);
    return kind && (Number.isSafeInteger(exitCode) || Number.isFinite(durationMs)) ?
      [{ command: shellBody(command).trim(), kind, exitCode: exitCode ?? null, durationMs: durationMs ?? null }] : [];
  });
}

function turnsAt(session, { nativeTurnId, nativeTurnIndex, endedAt, finalReply }) {
  const turns = session.turns;
  if (nativeTurnId != null) {
    const matches = turns.filter(turn => turn.id === String(nativeTurnId));
    if (matches.length === 1) return matches[0];
    // Some headless runtimes supply a provider span ID instead of the native turn ID.
    const indexed = nativeTurnIndex != null ? turns[nativeTurnIndex - 1] : null;
    return indexed && finalReply != null && indexed.reply?.trim() === finalReply.trim() ? indexed : undefined;
  }
  if (nativeTurnIndex != null) return turns[nativeTurnIndex - 1];
  const at = time(endedAt);
  if (Number.isFinite(at)) {
    const started = turns.filter(turn => time(turn.startedAt) <= at);
    if (started.length) {
      const last = started.at(-1);
      if (time(last.endedAt) > at && last.reply?.trim() !== finalReply?.trim()) return undefined;
      if (finalReply != null && last.reply?.trim() !== finalReply.trim()) return undefined;
      return last;
    }
  }
  if (turns.length === 1 && (!Number.isFinite(at) || !Number.isFinite(time(turns[0].startedAt))) &&
    (finalReply == null || finalReply.trim() === turns[0].reply?.trim())) return turns[0];
}

export function sandboxMode(value) {
  if (typeof value === 'boolean') return value;
  const label = value?.type ?? value?.mode ?? value;
  if (typeof label !== 'string') return null;
  const mode = label.toLowerCase().replace(/[-_]/g, '');
  if (['workspacewrite', 'readonly', 'externalsandbox', 'enabled'].includes(mode)) return true;
  if (['dangerfullaccess', 'disabled', 'none', 'nosandbox'].includes(mode)) return false;
  return null;
}

function sandboxOf(value) {
  if (value?.sandbox_permissions === 'require_escalated' || value?.dangerouslyDisableSandbox === true) return false;
  return sandboxMode(value?.sandboxed ?? value?.is_sandboxed ?? value?.sandbox_policy ?? value?.sandboxPolicy ??
    value?.sandbox_mode ?? value?.sandboxMode ?? value?.sandbox);
}

function outputOf(value) {
  return string(value?.aggregated_output ?? value?.aggregatedOutput ?? value?.output) ??
    ([value?.stdout, value?.stderr].some(text => typeof text === 'string')
      ? [value.stdout, value.stderr].filter(Boolean).join('\n') : null);
}

function blocksText(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return string(value?.text);
  const parts = value.map(part => string(part?.text) ?? string(part)).filter(part => part !== null);
  return parts.length ? parts.join('\n') : null;
}

function codexResult(output) {
  const text = blocksText(output);
  const codeMode = /^Script completed[^\r\n]*\r?\n(?:Wall time:? [^\r\n]*\r?\n)?Output:\s*\r?\n([\s\S]*)$/.exec(text ?? '');
  const result = json(codeMode?.[1] ?? text) ?? (typeof output === 'object' ? output : null);
  const code = integer(result?.exit_code ?? result?.exitCode);
  if (code !== null) return { exitCode: code, output: outputOf(result), sandboxed: sandboxOf(result), chunk: result.chunk_id };
  if (text === null) return null;
  const header = /^Chunk ID: [^\r\n]+\r?\nWall time: ([^\r\n]+)\r?\nProcess exited with code (-?\d+)\b/.exec(text);
  if (!header) return null;
  const marker = /\r?\n(?:Final output|Output):\r?\n/.exec(text);
  const seconds = /^(\d+(?:\.\d+)?) seconds?$/.exec(header[1])?.[1];
  return { durationMs: seconds == null ? null : Number(seconds) * 1000,
    exitCode: Number(header[2]), output: marker ? text.slice(marker.index + marker[0].length) : null,
    chunk: /^Chunk ID: ([^\r\n]+)/.exec(text)?.[1] };
}

export function codexCommands(rows, turn, defaultSandbox, includePending = false) {
  const tools = turnActivity.get(turn)?.tools ?? new Map();
  const metadata = new Map();
  let turnSandbox = defaultSandbox;
  for (const [position, { type, payload, timestamp }] of rows.entries()) {
    if (!payload || (payload.turn_id != null && turn.id != null && payload.turn_id !== turn.id)) continue;
    const at = time(timestamp);
    if (at < time(turn.startedAt) || at > time(turn.endedAt)) continue;
    if (type === 'turn_context') {
      turnSandbox = sandboxOf(payload) ?? turnSandbox;
      continue;
    }
    const resultItem = payload.type === 'item_completed' && ['commandExecution', 'CommandExecution'].includes(payload.item?.type);
    const value = resultItem ? payload.item : payload;
    const id = value.call_id ?? value.id;
    if (!tools.get(id)?.command) continue;
    const details = metadata.get(id) ?? { position, timestamp };
    if (type === 'response_item' && typeof payload.type === 'string' && payload.type.endsWith('_call')) {
      const args = json(payload.arguments);
      details.callSandbox = sandboxOf(args) ?? sandboxOf(payload) ?? details.callSandbox;
      details.cwd = string(args?.workdir ?? args?.cwd) ?? details.cwd;
    } else if (type === 'event_msg' && payload.type === 'exec_command_begin') {
      details.started = true;
      details.startedAt = at;
      details.callSandbox = sandboxOf(value) ?? details.callSandbox;
      details.cwd = string(value.cwd) ?? details.cwd;
    } else if (type === 'event_msg' && (payload.type === 'exec_command_end' || resultItem)) {
      const exitCode = integer(value.exit_code ?? value.exitCode);
      details.native = { exitCode, output: outputOf(value), sandboxed: sandboxOf(value), chunk: value.chunk_id ?? value.chunkId,
        status: value.status,
        durationMs: elapsed(details.startedAt ?? time(details.timestamp), at) };
      details.cwd = string(value.cwd) ?? details.cwd;
      details.source = payload.type;
    } else if (type === 'response_item' && typeof payload.type === 'string' && payload.type.endsWith('_call_output')) {
      const result = codexResult(payload.output);
      if (result) details.result = result;
      details.resultPosition = position;
      details.resultAt = at;
    }
    metadata.set(id, details);
  }
  const commands = [...tools.entries()].flatMap(([id, tool]) => {
    const { native, result, source, cwd, callSandbox, started, position, resultPosition, timestamp, resultAt } = metadata.get(id) ?? {};
    if (!native && !result && !started && !(includePending && position != null)) return [];
    return [{ id, name: tool.name, command: tool.command, cwd, exitCode: native?.exitCode ?? result?.exitCode ?? tool.exitCode,
      output: native?.output ?? result?.output, chunk: native?.chunk ?? result?.chunk, position, resultPosition, timestamp,
      sandboxed: native?.sandboxed ?? result?.sandboxed ?? callSandbox ?? turnSandbox,
      durationMs: result?.durationMs ?? native?.durationMs ?? (result && elapsed(time(timestamp), resultAt)),
      started, status: native?.status, ...(includePending && { nativeStatus: native?.status, ended: Boolean(native || result || resultPosition != null) }),
      source: `codex.${source ?? (result ? 'call_output' : started ? 'exec_command_begin' : 'call')}` }];
  });
  // Code-mode exec returns the same command result as its native child event.
  // Constrain matching to the wrapper's lifetime so genuine reruns survive.
  return commands.filter(wrapper => {
    if (wrapper.name !== 'exec') return true;
    const child = commands.find(child => child.name !== 'exec' &&
      (wrapper.chunk && child.chunk ? wrapper.chunk === child.chunk :
        child.position >= wrapper.position && child.position <= (wrapper.resultPosition ?? wrapper.position) &&
        shellBody(wrapper.command) === shellBody(child.command) && wrapper.exitCode === child.exitCode));
    if (!child) return true;
    child.output ??= wrapper.output;
    child.cwd ??= wrapper.cwd;
    child.sandboxed ??= wrapper.sandboxed;
    child.durationMs ??= wrapper.durationMs;
    return false;
  });

}

function claudeCommands(rows, turn, defaultSandbox) {
  const calls = new Map(turn.tools.filter(tool => tool.id && tool.name === 'Bash').map(tool => [tool.id, tool]));
  const commands = new Map();
  const inputs = new Map();
  for (const row of rows) {
    const at = time(row.timestamp);
    if (row.isSidechain || row.parent_tool_use_id != null || row.parentToolUseId != null ||
      row.isMeta || at < time(turn.startedAt) || at > time(turn.endedAt)) continue;
    const blocks = row.message?.content ?? row.content;
    if (!Array.isArray(blocks)) continue;
    if (row.type === 'assistant') {
      for (const block of blocks) if (calls.has(block?.id)) inputs.set(block.id, { ...block.input, at });
    } else if (row.type === 'user') {
      const results = blocks.filter(isClaudeToolResultContent);
      const metadata = results.length === 1 ? row.toolUseResult ?? row.tool_use_result : null;
      for (const block of results) {
        const call = calls.get(block.tool_use_id);
        if (!call || metadata?.backgroundTaskId || metadata?.interrupted) continue;
        const output = outputOf(metadata) ?? blocksText(block.content);
        const exitCode = toolExitCode(block, metadata) ?? call.exitCode ??
          (!block.is_error && output !== null && !String(block.content?.type ?? '').endsWith('_error') ? 0 : null);
        commands.set(call.id, { command: call.command, cwd: row.cwd, exitCode, output,
          durationMs: metadata?.durationMs ?? elapsed(inputs.get(call.id)?.at, at),
          sandboxed: sandboxOf(metadata) ?? sandboxOf(block) ?? sandboxOf(inputs.get(call.id)) ?? defaultSandbox,
          source: 'claude.tool_result' });
      }
    }
  }
  return [...commands.values()];
}

const agyCommand = call => string(call?.command ?? call?.cmd ?? call?.args?.CommandLine ?? call?.args?.command ?? call?.args?.cmd);
const agyId = call => call?.call_id ?? call?.tool_call_id ?? call?.id;
const agyShell = /^(?:run_command|shell_command)$/i;
const agyHeader = /^(?:(?:Created|Completed) At: [^\r\n]+\r?\n)*/;

export function agyCommands(rows, defaultSandbox, includePending = false) {
  const commands = [];
  const ids = new Map();
  const tasks = new Map();
  let batch = [];
  let edit;
  function resolve(call, row, position, generic) {
    const envelope = call.result ?? row.result ?? call;
    const raw = envelope.exit_code ?? envelope.exitCode ?? row.exit_code ?? row.exitCode;
    const code = generic?.exitCode ?? integer(typeof raw === 'string' && /^-?\d+$/.test(raw) ? Number(raw) : raw);
    const command = agyCommand(call);
    const id = agyId(call);
    const pending = batch.filter(item => item.exitCode === null);
    let entry = id == null ? null : ids.get(String(id));
    if (!entry && code !== null) {
      entry = command ? pending.find(item => item.command === command) : pending[0];
    }
    if (!entry && command) {
      entry = { id, name: call.name ?? call.tool_name ?? 'run_command', command, position,
        timestamp: row.created_at, exitCode: null, output: null, cwd: call.args?.Cwd ?? call.cwd,
        sandboxed: sandboxOf(call.args) ?? sandboxOf(call) ?? sandboxOf(row) ?? defaultSandbox,
        source: `agy.${row.type}` };
      batch.push(entry);
      commands.push(entry);
      if (id != null) ids.set(String(id), entry);
    }
    if (entry && code !== null) {
      entry.exitCode = code;
      entry.output = generic?.output ?? outputOf(envelope) ?? outputOf(row);
      entry.sandboxed = sandboxOf(envelope) ?? sandboxOf(row) ?? entry.sandboxed;
      entry.durationMs ??= generic?.durationMs ?? envelope.duration_ms ?? envelope.durationMs ??
        elapsed(time(entry.timestamp), time(row.completed_at ?? row.created_at));
    }
  }
  for (const [position, row] of rows.entries()) {
    const calls = row.tool_calls ?? row.toolCalls;
    if (Array.isArray(calls) && calls.length) {
      batch = [];
      edit = calls.length === 1 && /_fast_apply_edits$/.test(calls[0]?.name ?? calls[0]?.tool_name ?? '') ? calls[0] : null;
      for (const call of calls) {
        if (agyShell.test(call?.name ?? call?.tool_name ?? '')) resolve(call, row, position);
      }
    } else if (row.type === 'RUN_COMMAND' || /^(?:TOOL|FUNCTION)_(?:CALL|USE|RESULT)$/.test(row.type)) {
      const call = row.toolCall ?? row.tool_call ?? row;
      const name = call.name ?? call.tool_name;
      if (row.type === 'RUN_COMMAND' || name == null || agyShell.test(name)) resolve(call, row, position);
    } else if (row.type === 'SYSTEM_MESSAGE' && row.source === 'SYSTEM' && typeof row.content === 'string') {
      const finished = /^\[Message\][^\r\n]* content=Task id "([^"]+)" finished with result:/m.exec(row.content);
      const match = finished && /^Command exited with code (-?\d+)\.(?:\s*Command output:\s*([\s\S]*))?/m.exec(
        row.content.slice(finished.index + finished[0].length).split(/\r?\n<\/SYSTEM_MESSAGE>/, 1)[0]);
      const entry = finished && tasks.get(finished[1]);
      if (entry && match) {
        entry.exitCode = Number(match[1]);
        entry.output = match[2] ?? null;
        entry.durationMs = elapsed(time(entry.timestamp), time(row.created_at));
        entry.source = 'agy.background-completion';
        tasks.delete(finished[1]);
      }
    } else if (row.source === 'MODEL' && row.type === 'GENERIC' && typeof row.content === 'string') {
      const content = row.content.replace(agyHeader, '').trimStart();
      const background = /^Tool is running as a background task with task id: (\S+)(?:\s+Task Description: ([^\r\n]+))?/.exec(content);
      if (background) {
        const pending = batch.filter(item => item.exitCode === null && ![...tasks.values()].includes(item));
        const entry = pending.find(item => background[2]?.trim() === item.command.split(/\r?\n/, 1)[0].trim()) ??
          (pending.length === 1 ? pending[0] : undefined);
        if (entry) {
          tasks.set(background[1], entry);
          batch = batch.filter(item => item !== entry);
        }
      }
      const match = /^Command exited with code (-?\d+)\.(?:\s*Command output:\s*([\s\S]*))?/.exec(content);
      if (match) resolve(row, row, position, { exitCode: Number(match[1]), output: match[2] });
      const verify = edit && /^Verify \[(PASS|FAIL \(exit (-?\d+)\)) in (\d+)ms\] `([^`\n]+)`:\r?\n([\s\S]*)/m.exec(content);
      if (verify) {
        resolve({ command: verify[4], name: 'run_command' }, row, position,
          { exitCode: verify[1] === 'PASS' ? 0 : Number(verify[2]), durationMs: Number(verify[3]), output: verify[5] });
        edit = null;
      }
    }
  }
  return includePending ? commands : commands.filter(command => command.exitCode !== null);
}

export function collectVerification(options) {
  const { provider, transcript, sandboxed = null } = options;
  if (typeof transcript !== 'string' || !transcript.trim()) return { status: 'missing-transcript', commands: [] };
  let session;
  const agyRows = [];
  if (provider === 'agy') {
    // The agy adapter's parser supplies the same deduplicated record stream to its turn summary.
    session = parseAgy(transcript, (index, row) => (agyRows[index] ??= []).push(row));
  } else if (provider === 'codex' || provider === 'claude') {
    session = (provider === 'codex' ? codex : claude).transcript.parse(transcript);
  } else return { status: 'unsupported-provider', commands: [] };

  const turn = turnsAt(session, options);
  if (!turn) return { status: 'unmatched-turn', commands: [] };
  let commands;
  if (provider === 'agy') commands = agyCommands(agyRows[turn.index - 1], sandboxed);
  else {
    const rows = transcript.replace(/^\uFEFF/, '').split('\n').map(json).filter(row => row && typeof row === 'object');
    commands = provider === 'codex' ? codexCommands(rows, turn, sandboxed) : claudeCommands(rows, turn, sandboxed);
  }
  return {
    status: 'ok', turnId: turn.id, turnIndex: turn.index, turnStatus: turn.status, finalReply: turn.reply,
    denialCounts: sandboxDenialCounts(commands),
    commands: commands.map(checkEvidence).filter(Boolean), executions: executionEvidence(commands),
  };
}
