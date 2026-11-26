import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { parseAgyTranscriptLine } from '../adapters/agy/transcript.mjs';
import { isClaudeTranscriptEnd, parseClaude, parseTranscriptRow } from '../adapters/claude/parse.mjs';
import { parseCodexTranscriptLine } from '../adapters/codex/transcript.mjs';
import { deliveryId } from '../inbox/message.mjs';

const grace = 2500;
const oarAddress = /^oar-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/;
const nonempty = value => typeof value === 'string' && value.trim() ? value : undefined;
const within = (parent, path) => path === parent || path?.startsWith(`${parent}/`);
const claudeTurnCache = new Map();
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

export const provesClaudeTurnEnd = turn => turn.status === 'completed' && turn.boundary && Boolean(turn.reply) && !turn.pendingTools;

export function completedClaudeTurns(path, id) {
  const stat = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!stat?.isFile()) return [];
  const revision = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`;
  const cached = claudeTurnCache.get(path);
  if (cached?.revision === revision && cached.id === id) return cached.turns;
  const rows = jsonl(path).filter(row => row.sessionId === id && !row.agent_id && !row.isSidechain && !row.parent_tool_use_id && !row.parentToolUseId);
  const boundaries = new Set(rows.filter(isClaudeTranscriptEnd).map(row => row.timestamp));
  const turns = parseClaude(rows.map(row => JSON.stringify(row)).join('\n')).turns
    .map(turn => ({ ...turn, boundary: boundaries.has(turn.endedAt) }));
  claudeTurnCache.delete(path);
  if (claudeTurnCache.size >= 16) claudeTurnCache.delete(claudeTurnCache.keys().next().value);
  claudeTurnCache.set(path, { revision, id, turns });
  return turns;
}

export function withClaudeTranscriptStops(terminal, events, sessionId) {
  const bound = events.filter(row => !row.agent_id && !row.isSidechain && row.session_id);
  const id = sessionId ?? bound.at(-1)?.session_id;
  if (!id) return events;
  const session = bound.filter(row => row.session_id === id);
  const starts = [];
  const byPrompt = new Map();
  for (const row of session) {
    const key = row.prompt_id ?? row.turn_id;
    if (row.hook_event_name === 'UserPromptSubmit') {
      const entry = { row, key };
      starts.push(entry);
      if (key) byPrompt.set(key, entry);
    } else if (['Stop', 'StopFailure', 'Interrupt'].includes(row.hook_event_name)) {
      const entry = key ? byPrompt.get(key) : starts.at(-1);
      if (entry) entry.ended = true;
    }
  }
  const binding = session.findLast(row => row.transcript_path ?? row.transcriptPath);
  const path = binding?.transcript_path ?? binding?.transcriptPath ?? terminal.transcriptPath;
  if (typeof path !== 'string' || basename(path) !== `${id}.jsonl` || existingPath(path) !== path ||
      transcriptPath('claude', realpathSync(terminal.cwd), terminal, { transcript_path: path }) !== path) return events;
  const turns = completedClaudeTurns(path, id);
  if (!turns.length) return events;
  function decorate(stop, turn) {
    if (turn.status === 'paused') return { ...stop, paused: true };
    if (!turn.backgroundPrompts || turn.status !== 'completed') return stop;
    const ids = turn.backgroundPrompts.map(deliveryId).filter(Boolean);
    const original = starts.find(({ row }) => ids.includes(row.deliveryId ?? deliveryId(row.prompt)));
    return { ...stop, backgroundDeliveryIds: ids, backgroundPromptId: original?.key,
      backgroundReply: turn.reply, nativeTurnId: turn.id };
  }
  const decorated = events.map(row => {
    if (row.session_id !== id || row.hook_event_name !== 'Stop') return row;
    const anchor = byPrompt.get(row.prompt_id ?? row.turn_id)?.row;
    const turn = turns.findLast(turn => Date.parse(turn.startedAt) <= row.receivedAt &&
      (!anchor?.prompt || turn.prompts.some(prompt => prompt === anchor.prompt.trim() ||
        deliveryId(prompt) && deliveryId(prompt) === deliveryId(anchor.prompt))));
    const pendingHook = session.some(event => event.backgroundBash && event.receivedAt <= row.receivedAt &&
      (anchor ? event.receivedAt >= anchor.receivedAt : row.prompt_id && event.prompt_id === row.prompt_id));
    if (pendingHook && !turn) return { ...row, paused: true };
    return turn ? decorate(row, turn) : row;
  });
  const stops = starts.flatMap(({ row, key, ended }, index) => {
    if (ended) return [];
    const next = starts[index + 1]?.row.receivedAt ?? Infinity;
    const marker = row.deliveryId ?? deliveryId(row.prompt);
    const turn = turns.find(({ endedAt, prompts, status, boundary, reply, pendingTools }) =>
      (status === 'paused' || provesClaudeTurnEnd({ status, boundary, reply, pendingTools })) &&
      Date.parse(endedAt) >= row.receivedAt && Date.parse(endedAt) < next && prompts.some(prompt =>
        marker ? deliveryId(prompt) === marker : prompt === row.prompt?.trim()));
    if (!turn) return [];
    return [decorate({ cwd: terminal.cwd, session_id: id, prompt_id: key, receivedAt: Date.parse(turn.endedAt),
      hook_event_name: 'Stop', deliveryId: marker, last_assistant_message: turn.reply, source: 'claude transcript turn_duration',
      ...(provesClaudeTurnEnd(turn) && { hookGap: true }) }, turn)];
  });
  for (const turn of turns) {
    if (!provesClaudeTurnEnd(turn) || !turn.backgroundPrompts ||
        [...decorated, ...stops].some(stop => stop.nativeTurnId === turn.id && stop.backgroundDeliveryIds)) continue;
    stops.push(decorate({ cwd: terminal.cwd, session_id: id, receivedAt: Date.parse(turn.endedAt), hook_event_name: 'Stop' }, turn));
  }
  return stops.length ? [...decorated, ...stops].sort((a, b) => a.receivedAt - b.receivedAt) : decorated;
}

export function finalFromStop(provider, stop, rows) {
  if (stop.paused || stop.fullyIdle === false) return;
  const direct = provider === 'codex' && nonempty(stop.last_assistant_message) ||
    provider === 'agy' && nonempty(stop.finalReply) || provider === 'claude' && nonempty(stop.backgroundReply);
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
  const hooks = terminalEvents(project, addr, terminal);
  const activity = provider === 'claude' ? withClaudeTranscriptStops(terminal, hooks) : hooks;
  const events = activity.filter(row =>
    provider === 'agy' ? row.fullyIdle === true && row.conversationId && row.executionNum != null :
      ['Stop', 'StopFailure'].includes(row.hook_event_name) && !row.agent_id && !row.paused);
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
  const latestStop = activity.findLast(row => row.hook_event_name === 'Stop' || row.fullyIdle !== undefined);
  if (!exit && (latestStop?.paused || latestStop?.fullyIdle === false)) return replies;
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
