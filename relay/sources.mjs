import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { parseAgyTranscriptLine } from '../adapters/agy/transcript.mjs';
import { parseTranscriptRow } from '../adapters/claude/parse.mjs';
import { parseCodexTranscriptLine } from '../adapters/codex/transcript.mjs';

const grace = 2500;
const oarAddress = /^oar-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/;
const nonempty = value => typeof value === 'string' && value.trim() ? value : undefined;
const within = (parent, path) => path === parent || path?.startsWith(`${parent}/`);
function existingPath(path) {
  try { return path && realpathSync(path); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
function jsonl(path) {
  if (!path) return [];
  try {
    const lines = readFileSync(path, 'utf8').split('\n');
    return lines.slice(0, -1).flatMap(line => {
      try { const row = JSON.parse(line); return row && typeof row === 'object' ? [row] : []; }
      catch { return []; }
    });
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

// A native Stop associates the path with the worker. The no-hook path must be inside its cwd.
function transcriptPath(provider, cwd, terminal, stop) {
  const supplied = stop?.transcript_path ?? stop?.transcriptPath;
  if (typeof supplied === 'string' && supplied.startsWith('/')) {
    const names = provider === 'agy' ? /^(transcript_full|transcript)\.jsonl$/ : /^[a-z0-9][a-z0-9-]*\.jsonl$/i;
    const paths = provider === 'agy' ? [join(dirname(supplied), 'transcript_full.jsonl'), supplied] : [supplied];
    const path = paths.map(existingPath).find(path => path && names.test(basename(path)));
    const store = { codex: '/.codex/sessions/', claude: '/.claude/projects/', agy: '/.gemini/antigravity-cli/brain/' }[provider];
    if (path && !/\/(provider-homes|memories[^/]*)\//.test(path) && (within(cwd, path) || path.includes(store))) return path;
  }
  const names = [`${terminal.address}.jsonl`, ...(provider === 'agy' ? ['transcript_full.jsonl'] : []), 'transcript.jsonl'];
  for (const name of names) {
    const path = existingPath(join(cwd, '.project/relay', name));
    if (within(cwd, path) && basename(path) === name) return path;
  }
  const args = terminal.argv ?? [];
  const session = args[args.indexOf('--session-id') + 1];
  if (provider === 'claude' && args.includes('--session-id') && /^[\da-f-]{36}$/i.test(session ?? '')) {
    const path = join(homedir(), '.claude/projects', cwd.replace(/[^a-z0-9]/gi, '-'), `${session}.jsonl`);
    if (existingPath(path) === path) return path;
  }
}

export function terminalEvents(project, addr, terminal) {
  const cwd = existingPath(terminal.cwd);
  if (!within(project, cwd)) return [];
  const path = join(project, '.project/relay/events', `${addr}.jsonl`);
  if (existingPath(path) !== path) return [];
  return jsonl(path).map(row => ({
    ...row.payload, ...row, receivedAt: typeof row.receivedAt === 'number' ? row.receivedAt : Date.parse(row.receivedAt),
  })).filter(row => (row.cwd === cwd || row.workspacePaths?.includes(cwd)) &&
    Number.isFinite(row.receivedAt) && row.receivedAt >= terminal.created_ms);
}

export function boundTranscript(provider, terminal, stop) {
  return jsonl(transcriptPath(provider, realpathSync(terminal.cwd), terminal, stop));
}

export function finalFromStop(provider, stop, rows) {
  const direct = provider === 'codex' && nonempty(stop.last_assistant_message) ||
    provider === 'agy' && nonempty(stop.finalReply);
  if (direct) return { body: direct, source: `${provider} Stop` };
  const text = transcriptReply(provider, rows, stop);
  if (text) return { ...text, source: `${provider} Stop + transcript` };
}

export function transcriptReply(provider, rows, stop = {}) {
  let last;
  let turn = stop.turn_id;
  for (const [index, row] of rows.entries()) {
    const timestamp = Date.parse(row.timestamp ?? row.created_at ?? '');
    if (Number.isFinite(timestamp) && timestamp > stop.receivedAt) continue;
    if (provider === 'codex') {
      const payload = row.payload ?? {};
      if (payload.type === 'task_started') {
        turn = payload.turn_id;
        if (!stop.turn_id || turn === stop.turn_id) last = undefined;
      }
      if (stop.turn_id && turn !== stop.turn_id) continue;
      const body = payload.type === 'task_complete' ? payload.last_agent_message :
        payload.type === 'agent_message' && payload.phase !== 'commentary' ? payload.message : undefined;
      if (nonempty(body)) last = { body, at: timestamp };
      for (const item of parseCodexTranscriptLine(row)) {
        if (item.kind === 'user') last = undefined;
        if (item.kind === 'assistant' && item.raw.phase !== 'commentary') last = { body: item.text, at: timestamp };
      }
    } else if (provider === 'agy') {
      for (const item of parseAgyTranscriptLine(row)) {
        if (item.kind === 'user') last = undefined;
        if (item.kind === 'assistant' && !(row.tool_calls?.length || row.toolCalls?.length)) {
          last = { body: item.text, messageId: `${row.step_index ?? index}:${row.created_at ?? ''}`, at: timestamp };
        }
      }
    } else if (!row.isSidechain && !row.parent_tool_use_id && !row.parentToolUseId) {
      if (row.type === 'user' && !(Array.isArray(row.message?.content) &&
        row.message.content.some(part => part.type === 'tool_result'))) last = undefined;
      const items = parseTranscriptRow(row);
      if (items.some(item => item.kind === 'tool_use')) last = undefined;
      else {
        const body = items.filter(item => item.kind === 'assistant_text').map(item => item.text).join('\n');
        const messageId = row.message?.id ?? row.uuid;
        if (nonempty(body)) last = { body: messageId && last?.messageId === messageId ? `${last.body}\n${body}` : body, messageId, at: timestamp };
      }
    }
  }
  return last;
}

export async function observe(project, worker, progress, hc, now = Date.now(), withEvidence = false) {
  const { addr, provider, id, status } = worker;
  if (oarAddress.test(addr)) {
    const path = join(project, '.project/relay/events', `${addr}.jsonl`);
    if (existingPath(path) !== path) return [];
    const observed = progress.events ??= {};
    return jsonl(path).flatMap(event => {
      if (event.addr !== addr || event.type !== 'turn-end' || !Number.isFinite(event.at) ||
        typeof event.eventId !== 'string' || !event.eventId.startsWith(`${addr}:`) || observed[event.eventId] ||
        !(event.finalReply === null || nonempty(event.finalReply))) return [];
      observed[event.eventId] = true;
      return [{
        key: event.eventId, at: event.at, source: 'OAR turn-end',
        body: event.finalReply ?? `FAILED ${id}\n无原生最终回复`,
        failed: event.finalReply === null,
        ...(withEvidence && { evidenceInput: { nativeTurnIndex: event.turn, sessionId: event.sessionId } }),
      }];
    });
  }
  const terminal = await hc('get', addr);
  const cwd = existingPath(terminal.cwd);
  if (!within(project, cwd)) return [];
  const events = terminalEvents(project, addr, terminal).filter(row =>
    provider === 'agy' ? row.fullyIdle === true && row.conversationId && row.executionNum != null :
      ['Stop', 'StopFailure'].includes(row.hook_event_name) && !row.agent_id);
  const observed = progress.events ??= {};
  const frame = `${terminal.created_ms}:${terminal.turn}`;
  if (!progress.frame && status !== 'dispatched') {
    progress.frame = frame;
    progress.since = now;
  }
  const replies = [];
  for (const stop of events) {
    const session = stop.session_id ?? stop.conversationId;
    const native = stop.turn_id;
    const event = `event:${session}:${native ?? stop.receivedAt}`;
    if (observed[event] || stop.receivedAt <= progress.since) continue;
    const stillFinishing = terminal.status?.state === 'working' && terminal.status_ms <= stop.receivedAt;
    if (stillFinishing && now - stop.receivedAt < grace) continue;
    const covered = stillFinishing ? `${terminal.created_ms}:${terminal.turn + 1}` : frame;
    const rows = provider === 'codex' && nonempty(stop.last_assistant_message) ? [] : boundTranscript(provider, terminal, stop);
    const text = finalFromStop(provider, stop, rows);
    const failed = stop.hook_event_name === 'StopFailure' || Boolean(stop.error) ||
      /(?:ERROR|USER_CANCELED|MAX_(?:FORCED_)?INVOCATIONS|MAX_TOKEN_BUDGET_EXCEEDED)$/.test(stop.terminationReason ?? '');
    if (!text && !failed) continue;
    const key = `turn:${session}:${native ?? text?.messageId ?? stop.receivedAt}`;
    if (observed[key] && now - stop.receivedAt < grace) continue;
    if (!observed[key] && !(progress.fallback === covered && stop === events.at(-1))) {
      const source = text?.source ?? `${provider} Stop failure`;
      replies.push({ key, body: text?.body ?? `FAILED ${id}\n${stop.terminationReason ?? source}`, source, failed,
        at: stop.receivedAt, sessionId: session, turnId: native,
        ...(withEvidence && { evidenceInput: { cwd, sessionId: session, nativeTurnId: native, argv: terminal.argv,
          transcriptPath: () => transcriptPath(provider, cwd, terminal, stop) } }),
      });
    }
    observed[event] = observed[key] = true;
    progress.frame = covered;
    progress.lastReceipt = stop.receivedAt;
  }
  const statusWord = terminal.status?.state;
  const exit = terminal.state === 'finished';
  const stopped = exit || ['blocked', 'error', 'done'].includes(statusWord) || statusWord === 'idle' && terminal.turn > 0;
  if (replies.length || !stopped || progress.frame === frame || now - (terminal.finished_ms ?? terminal.status_ms) < grace) return replies;
  const wait = await hc('wait', addr, '--timeout', '1');
  if (!wait.ended || !['status', 'exit'].includes(wait.reason) || wait.turn !== terminal.turn) return replies;
  const parsed = transcriptReply(provider, jsonl(transcriptPath(provider, cwd, terminal, events.at(-1))));
  const text = parsed?.at <= progress.lastReceipt ? undefined : parsed;
  const failed = wait.status === 'error' || wait.status === 'blocked' || exit && terminal.exit_code !== 0;
  let body = text?.body;
  if (!body) {
    const screen = (await hc('read', addr, '--lines', '30')).text ?? '';
    body = screen.trimEnd().split('\n').slice(-30).join('\n') || 'No reply available';
  }
  progress.frame = progress.fallback = frame;
  progress.lastReceipt = terminal.status_ms ?? terminal.finished_ms ?? now;
  replies.push({ key: `hc:${frame}`, body, source: text ? 'hc wait + transcript' : 'fallback: hc read',
    failed: failed || !text, at: terminal.finished_ms ?? terminal.status_ms ?? now,
    ...(withEvidence && { evidenceInput: { cwd, argv: terminal.argv,
      transcriptPath: () => transcriptPath(provider, cwd, terminal, events.at(-1)) } }),
  });
  return replies;
}
