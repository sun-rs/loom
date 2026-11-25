import { basename, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { protectedPath } from '../../cli/artifacts.mjs';
import { adapterFor, readTranscript, transcriptFor } from '../../cli/sessions.mjs';
import { decode, nativeRanges, transcriptRows, turnTools } from '../../cli/turns.mjs';
import { checkEvidence } from '../../evidence/checks.mjs';

const oneLine = text => String(text ?? '').trim().split(/\r?\n/, 1)[0];
const display = (text, limit = 180) => {
  const chars = Array.from(text);
  return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : text;
};
const number = value => Number.isSafeInteger(value) ? value : null;
const lines = text => text ? text.replace(/\r?\n$/, '').split('\n').length : 0;
const shellTool = /^(?:Bash|PowerShell|commandExecution|exec_command(?:_begin)?|shell_command|run_command|Terminal)$/i;
const readTool = /^(?:read|read_file|view_file|view_image)$/i;
const editTool = /^(?:edit|write|write_file|edit_file|replace_file_content|multi_replace_file_content|create_file|notebookedit|apply_patch|filechange)$/i;
const textOf = value => typeof value === 'string' ? value : Array.isArray(value) ?
  value.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n') : '';

function filePath(path, cwd) {
  if (typeof path !== 'string' || !path || protectedPath.test(path)) return null;
  const local = cwd && path.startsWith('/') ? relative(cwd, path) : path.replace(/^\.\//, '');
  return local && !local.startsWith('../') ? local : path;
}

function patchCounts(patch) {
  if (typeof patch !== 'string') return {};
  const rows = patch.split(/\r?\n/);
  const firstHunk = rows.findIndex(line => line.startsWith('@@'));
  const changes = rows.slice(Math.max(0, firstHunk)).filter(line => /^[+-]/.test(line));
  return { added: changes.filter(line => line.startsWith('+')).length,
    deleted: changes.filter(line => line.startsWith('-')).length };
}

function pathsOf(input) {
  return [input.path, input.file_path, input.filePath, input.Path, input.TargetFile, input.TargetPath,
    input.notebook_path, ...(Array.isArray(input.paths) ? input.paths : [])];
}

function shellBody(command) {
  const shell = command.replace(/^\S*\b(?:ba|z|da|k)?sh\s+-[a-z]*c[a-z]*\s+/i, '');
  return shell !== command && /^(['"])[\s\S]*\1$/.test(shell) ? shell.slice(1, -1) : shell;
}

// Identify only literal file operands in common shell reads. Never evaluate recorded commands.
function shellReads(command) {
  const shell = shellBody(command);
  const tokens = shell.match(/&&|\|\||[;|\n]|(?:'[^']*'|"[^"]*"|[^\s'";|&])+/g) ?? [];
  const paths = [];
  let stage = [];
  for (const token of [...tokens, ';']) {
    if (!['&&', '||', ';', '|', '\n'].includes(token)) {
      stage.push(token.replace(/^(['"])(.*)\1$/, '$2'));
      continue;
    }
    const [exe, ...args] = stage;
    if (!args.some(arg => /[<>$\x60]/.test(arg))) {
      const tool = basename(exe ?? '');
      const operands = tool === 'sed' && args[0] === '-n' && /^\d+(?:,\d+)?p$/.test(args[1]) ? args.slice(2) :
        ['cat', 'nl', 'head', 'tail', 'wc'].includes(tool) ? args.filter(arg => !arg.startsWith('-') && !/^\d+$/.test(arg)) : [];
      paths.push(...operands.filter(arg => /^[\w./-]+$/.test(arg) && (arg.includes('.') || arg.includes('/'))));
    }
    stage = [];
  }
  return paths;
}

function createTurn({ status, reply, cwd, index }, coverage) {
  const reads = new Set();
  const writes = [];
  const commands = [];
  const tests = [];
  function read(path) {
    const normalized = filePath(path, cwd);
    if (normalized) reads.add(normalized);
  }
  function write(path, state, counts = {}) {
    const normalized = filePath(path, cwd);
    if (normalized) writes.push({ path: normalized, state, added: counts.added ?? null,
      deleted: counts.deleted ?? null, net: counts.net ?? null });
  }
  function command(entry) {
    if (!entry.command) return;
    const code = number(entry.exitCode);
    commands.push({ command: display(entry.command.replace(/\s+/g, ' ')), exitCode: code });
    if (code === 0) shellReads(entry.command).forEach(read);
    const output = entry.output?.replace(/ \| (?=ℹ\s+)/g, '\n') ?? '';
    const check = checkEvidence({ ...entry, command: shellBody(entry.command), output, started: true });
    if (check) {
      const { counts } = check;
      const total = [...output.matchAll(/^(?:#|ℹ)\s*tests\s+(\d+)\s*$/gm)].at(-1);
      const test = total ? Number(total[1]) : null;
      tests.push({ command: display(entry.command.replace(/\s+/g, ' ')), total: test, ...counts });
    }
  }
  return { read, write, command, finish: () => ({ index, coverage, status, reply: display(oneLine(reply)) || null,
    reads: [...reads], writes, commands, tests }) };
}

function codexFiles(rows, digest) {
  const seen = new Set();
  for (const { row } of rows) {
    const event = row.payload;
    const item = event?.item ?? event;
    if (!item || !['item_completed', 'apply_patch_end'].includes(event.type) ||
        (event.type === 'item_completed' && !/^filechange$/i.test(item.type))) continue;
    const id = item.call_id ?? item.id;
    if (id != null && seen.has(id)) continue;
    if (id != null) seen.add(id);
    const state = item.success === true || item.status === 'completed' ? 'reported' :
      item.success === false || item.status === 'failed' ? 'failed' : 'requested';
    const changes = Array.isArray(item.changes) ? item.changes.map(change => [change.path, change]) : Object.entries(item.changes ?? {});
    for (const [path, change] of changes) {
      const kind = change.type ?? change.kind?.type ?? change.kind;
      const diff = change.unified_diff ?? change.diff;
      const counts = typeof diff === 'string' ? patchCounts(diff) :
        kind === 'add' && typeof change.content === 'string' ? { added: lines(change.content), deleted: 0 } :
        kind === 'delete' && typeof change.content === 'string' ? { added: 0, deleted: lines(change.content) } : {};
      digest.write(path, state, state === 'reported' ? counts : {});
    }
  }
}

function claudeFiles(rows, digest) {
  const calls = new Map();
  for (const { row } of rows) {
    if (row.isSidechain || row.parent_tool_use_id != null || row.parentToolUseId != null) continue;
    const blocks = row.message?.content ?? row.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (block.type === 'tool_use' && !calls.has(block.id)) calls.set(block.id, { name: block.name, input: block.input ?? {} });
      const call = block.type === 'tool_result' && calls.get(block.tool_use_id);
      if (call) {
        call.state = block.is_error ? 'failed' : 'reported';
        if (blocks.length === 1) call.result = row.toolUseResult ?? row.tool_use_result;
      }
    }
  }
  for (const { name, input, state = 'requested', result } of calls.values()) {
    const paths = pathsOf(input);
    if (readTool.test(name)) paths.forEach(digest.read);
    if (!editTool.test(name)) continue;
    const hunks = result?.structuredPatch;
    const counts = state !== 'reported' ? {} : Array.isArray(hunks) && hunks.length ?
      patchCounts(hunks.flatMap(hunk => hunk.lines ?? []).join('\n')) :
      result?.type === 'create' && typeof input.content === 'string' ? { added: lines(input.content), deleted: 0 } : {};
    paths.forEach(path => digest.write(path, state, counts));
  }
}

function agyActivity(rows, digest, commands) {
  const pending = [...commands];
  for (const [index, { row }] of rows.entries()) {
    const calls = row.tool_calls ?? row.toolCalls ?? [];
    const output = [];
    for (let i = index + 1; rows[i]?.row.type === 'GENERIC'; i++) output.push(rows[i].row.content);
    const results = [...new Set(output.filter(value => typeof value === 'string').map(value =>
      value.replace(/^(?:(?:Created|Completed) At: [^\n]*\r?\n)+/, '')))];
    for (const call of calls) {
      const name = call.name ?? call.tool_name;
      const input = call.args ?? {};
      if (shellTool.test(name)) {
        const command = input.CommandLine ?? input.command ?? input.cmd ?? call.command ?? call.cmd;
        const match = pending.findIndex(tool => tool.command === command);
        if (match !== -1) digest.command(pending.splice(match, 1)[0]);
      }
      if (readTool.test(name)) pathsOf(input).forEach(digest.read);
      if (name?.endsWith('_fast_apply_edits')) {
        const result = calls.length === 1 ? results.join('\n') : '';
        for (const edit of input.edits ?? []) {
          const report = result.split('\n').find(line => line.startsWith('- ' + edit.path + ': '));
          const net = /, lines ([+-]\d+)\s*$/.exec(report ?? '');
          const state = report && net ? 'reported' : /Atomic edit aborted \(0 files modified\)/.test(result) ? 'failed' : 'requested';
          const counts = net ? report.includes(': created,') ? { added: Number(net[1]), deleted: 0 } : { net: Number(net[1]) } : {};
          digest.write(edit.path, state, counts);
        }
        const verify = /^Verify \[(PASS|FAIL \(exit (-?\d+)\)) in \d+ms\] `([^`\n]+)`:\r?\n([\s\S]*)/m.exec(result);
        if (verify) digest.command({ command: verify[3], exitCode: verify[1] === 'PASS' ? 0 : Number(verify[2]), output: verify[4] });
      } else if (editTool.test(name)) {
        for (const path of pathsOf(input).filter(Boolean)) {
          const reports = results.flatMap(result => [...result.matchAll(/^Made \d+ replacement(?:s)? in (.+?) starting at line \d+ \(\+(\d+)\/-(\d+) lines\)\./gm)])
            .filter(report => report[1] === path);
          const report = calls.filter(other => pathsOf(other.args ?? {}).includes(path)).length === 1 && reports.length === 1 && reports[0];
          const created = calls.length === 1 && results.length === 1 && /^Created file\./.test(results[0]);
          digest.write(path, report || created ? 'reported' : 'requested', report ?
            { added: Number(report[2]), deleted: Number(report[3]) } :
            created && typeof input.Content === 'string' ? { added: lines(input.Content), deleted: 0 } : {});
        }
      }
    }
  }
  pending.forEach(digest.command);
}

const filesByProvider = { codex: codexFiles, claude: claudeFiles };

export function nativeDigests(provider, text, cwd, parsed = adapterFor({ cli: provider }).transcript.parse(text)) {
  const ranges = nativeRanges(transcriptRows(text), parsed.turns, provider);
  return parsed.turns.map((turn, i) => {
    const rows = ranges[i];
    const digest = createTurn({ ...turn, cwd }, rows.length ? 'native transcript' : 'turn records unavailable');
    const commands = turnTools(provider, turn, rows).filter(tool => tool.tool === 'shell' && shellTool.test(tool.name));
    if (provider === 'agy') {
      agyActivity(rows, digest, commands);
    } else {
      filesByProvider[provider](rows, digest);
      commands.forEach(digest.command);
    }
    return digest.finish();
  });
}

function oarTurn(turn, index, cwd) {
  const digest = createTurn({ index, cwd, status: turn.status ?? 'incomplete', reply: turn.reply },
    turn.calls.size ? 'OAR tool records' : 'OAR turn records · no tool events present');
  for (const call of turn.calls.values()) {
    const value = decode(call.input);
    const args = value && typeof value === 'object' ? value : {};
    if (shellTool.test(call.name)) {
      const codexCommand = call.name === 'commandExecution' && typeof call.input === 'string' &&
        (typeof value === 'string' || value == null) ? value ?? call.input : null;
      digest.command({ command: args.command ?? args.cmd ?? args.CommandLine ?? codexCommand,
        exitCode: call.exitCode, output: call.output });
    }
    if (readTool.test(call.name)) pathsOf(args).forEach(digest.read);
    if (call.changes?.length) {
      for (const change of call.changes) {
        const input = Array.isArray(args) ? args.find(item => item.path === change.path) : args;
        const counts = patchCounts(input?.diff ?? input?.patch);
        digest.write(change.path, 'reported', { added: number(change.added) ?? counts.added,
          deleted: number(change.deleted) ?? counts.deleted });
        if (change.moveTo) digest.write(change.moveTo, 'reported');
      }
    } else if (editTool.test(call.name)) {
      const paths = Array.isArray(args) ? args.map(item => item.path) : pathsOf(args);
      paths.forEach(path => digest.write(path, call.result === 'failed' ? 'failed' :
        call.result === 'ok' ? 'reported' : 'requested'));
    }
  }
  return digest.finish();
}

// Accept OAR raw frames, flat Session.events(), wrapped Voyage records, and Loom's OAR relay projection.
export function oarDigests(text, cwd) {
  const rows = transcriptRows(text).map(({ row }) => row);
  const header = rows.find(row => row.kind === 'header');
  const events = rows.flatMap(row => {
    const record = row.kind === 'record' ? row.record : row;
    if (record?.kind === 'frame') return (record.body?.events ?? []).map(event => ({
      ...event, sessionId: record.sessionId, agentPath: record.agentPath, spanId: record.spanId,
    }));
    if (record?.kind) return [record];
    const kind = { 'turn-start': 'turn_started', 'turn-end': 'turn_ended', 'turn-unconfirmed': 'turn_unconfirmed' }[record?.type];
    return kind ? [{ ...record, kind, spanId: `${record.streamId ?? ''}/${record.turnId ?? record.turn}` }] : [];
  });
  const root = header?.sessionId ?? events.find(event => !event.agentPath?.length && event.sessionId)?.sessionId;
  const turns = [];
  const spans = new Map();
  let active;
  for (const event of events) {
    const { kind, spanId, callId } = event;
    if (event.agentPath?.length || root && event.sessionId && event.sessionId !== root) continue;
    if (!/^(?:turn_(?:started|active|ended|unconfirmed)|tool_call_|text_delta)/.test(kind)) continue;
    let turn = spanId == null ? active : spans.get(spanId);
    if (!turn) {
      turn = { calls: new Map(), reply: null, excerpt: '', messageId: null };
      turns.push(turn);
      if (spanId != null) spans.set(spanId, turn);
      active = turn;
    }
    if (kind === 'turn_ended' || kind === 'turn_unconfirmed') {
      turn.status = event.outcome?.kind ?? (kind === 'turn_unconfirmed' ? 'unconfirmed' : 'incomplete');
      turn.reply = turn.status === 'completed' ? event.finalReply ?? turn.excerpt : null;
      if (turn === active) active = null;
    } else if (kind === 'text_delta' && (!event.phase || event.phase === 'final_answer')) {
      if (turn.messageId !== event.messageId) turn.excerpt = '';
      turn.messageId = event.messageId;
      turn.excerpt += event.text ?? '';
    } else if (kind.startsWith('tool_call_') && callId != null) {
      const call = turn.calls.get(callId) ?? { input: '', output: '' };
      turn.calls.set(callId, call);
      if (kind === 'tool_call_started') {
        turn.excerpt = '';
        call.name = event.toolName ?? event.tool;
      }
      if ('input' in event) call.input = event.input;
      if (kind === 'tool_call_input_delta') call.input += event.delta ?? '';
      if (kind === 'tool_call_progress') call.output = (event.output ?? call.output) + (event.outputDelta ?? '');
      if (kind === 'tool_call_ended') Object.assign(call, { exitCode: event.exitCode, result: event.result,
        changes: event.fileChanges, output: event.content == null ? call.output : textOf(event.content) });
    }
  }
  return turns.map((turn, i) => oarTurn(turn, i + 1, cwd ?? header?.cwd ?? events[0]?.cwd));
}

export function digestText(turns) {
  const list = entries => entries.length ? entries.join('; ') : '—';
  const shown = value => value ?? '?';
  return turns.map(turn => [
    `Turn ${turn.index} · ${turn.status} · ${turn.coverage}`,
    `Reply ${turn.reply ?? '—'}`,
    `Files read ${list(turn.reads)}`,
    `Files written/edited ${list(turn.writes.map(write => `${write.path} [${write.state}` +
      (write.net === null ? ` +${shown(write.added)}/-${shown(write.deleted)}` : ` net ${write.net >= 0 ? '+' : ''}${write.net}`) + ']'))}`,
    `Commands${turn.commands.length ? '\n' + turn.commands.map(entry => `  [exit ${shown(entry.exitCode)}] ${entry.command}`).join('\n') : ' —'}`,
    `Tests${turn.tests.length ? '\n' + turn.tests.map(test => `  ${shown(test.total)} total, ${shown(test.passed)} pass, ${shown(test.failed)} fail, ${shown(test.skipped)} skip · ${test.command}`).join('\n') : ' —'}`,
  ].join('\n')).join('\n\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [mode, path, cwd] = process.argv.slice(2);
  if (!path || !['codex', 'agy', 'claude', 'oar'].includes(mode) || process.argv.length > 5) {
    console.error('Usage: node activity-digest.mjs <codex|agy|claude|oar> TRANSCRIPT.jsonl [CWD]');
    process.exitCode = 2;
  } else {
    const transcript = readTranscript(transcriptFor({ addr: mode, transcriptPath: resolve(path) }));
    const turns = mode === 'oar' ? oarDigests(transcript, cwd) : nativeDigests(mode, transcript, cwd);
    if (!turns.length) throw new Error('No turns found in the selected input');
    console.log(digestText(turns));
  }
}
