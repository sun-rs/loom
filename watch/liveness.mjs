import { lstat } from 'node:fs/promises';
import { jsonlTail } from '../runtimes/tui/read-jsonl.mjs';
import { stopFailure } from '../runtimes/tui/failure.mjs';
import { processTable } from '../daemon/processes.mjs';
import { screenProgress } from './observation.mjs';
import { parseResetAt } from './reset.mjs';

const quota = /^(?:rate[-_ ]limit(?:ed|_error)?|quota(?:[-_ ](?:wait|exhausted|exceeded))?|resource_exhausted|429)$/i;
const auth = /^(?:auth(?:entication)?(?:[-_ ](?:expired|fail(?:ed)?|error))?|unauthenticated|unauthorized|invalid_api_key|401)$/i;
const atOf = row => {
  const value = row.receivedAt ?? row.at ?? row.timestamp ?? row.created_at;
  return typeof value === 'number' ? value : Date.parse(value);
};
const classifyFailure = value => quota.test(value) ? 'quota-wait' : auth.test(value) ? 'auth-expired' : undefined;
const reasonFor = {
  'quota-wait': 'CLI reported a rate or usage limit',
  'auth-expired': 'CLI login or authentication failed',
  'silent-hang': 'Spinner is moving while native records, tokens, hooks and screen content stand still',
  'waiting-poll': 'Shell loop is polling Loom without model progress',
};

function failureOf(row) {
  if (row.hook_event_name === 'StopFailure' || row.isApiErrorMessage) {
    const reason = row.error_details ?? row.message?.content?.find?.(part => part.type === 'text')?.text;
    return { kind: classifyFailure(stopFailure({ error: row.error ?? row.apiError, error_details: reason }).failure), reason };
  }
  const payload = row.payload ?? row;
  const outcome = payload.outcome;
  if (outcome?.kind === 'failed' || ['stuck', 'error', 'ERROR', 'turn-end'].includes(payload.type ?? row.type)) {
    const reason = outcome?.reason ?? payload.message ?? payload.error?.message;
    const value = outcome?.failure ?? payload.failure ?? payload.reason ?? payload.code ?? payload.error?.code ?? payload.status;
    const kind = classifyFailure(value) ?? (typeof reason === 'string' &&
      (/\b429\b|rate limit|quota (?:exhausted|exceeded)/i.test(reason) ? 'quota-wait' :
        /\b401\b|authentication failed|(?:oauth|login|auth) token expired/i.test(reason) ? 'auth-expired' : undefined));
    return { kind, reason, retryAt: outcome?.retryAt ?? payload.retryAt ?? payload.retry_at };
  }
  return {};
}

function counterOf(row) {
  const data = row.payload?.info?.total_token_usage ?? row.message?.usage ??
    row.usage?.total ?? row.usage?.tokens ?? row.usage ?? row;
  const output = data.outputTokens ?? data.output_tokens ?? data.output;
  const calls = data.calls ?? data.modelCalls;
  if (!Number.isFinite(output) && !Number.isFinite(calls)) return;
  const id = row.message?.id ?? row.step_index ?? row.payload?.call_id ?? row.eventId;
  return { key: row.payload?.info?.total_token_usage ? 'total' : id ?? row.type, output: output ?? 0, calls: calls ?? 0 };
}

function shellLoop(command) {
  return typeof command === 'string' && /\b(?:while|until|for)\b/.test(command) &&
    (/(?:\bloom(?:["'])?|\bLOOM_BIN\}?(?:["'])?)\s+(?:["'])?state\b/.test(command) ||
      /\bdo\s+sleep\s+[^;\n]+[;\n]\s*done\b/.test(command));
}

function tool(row) {
  const data = row.payload ?? row.toolCall ?? row.tool_call ?? row;
  let input = data.input ?? data.args ?? data.arguments ?? row.tool_input;
  if (typeof input === 'string' && input.startsWith('{')) {
    try { input = JSON.parse(input); } catch { /* A partial tool-input row. */ }
  }
  return { id: data.call_id ?? data.callId ?? data.id ?? row.tool_use_id,
    command: input?.command ?? input?.CommandLine ?? input };
}

function rootRows(row) {
  if (row.isSidechain || row.agent_id || row.parent_tool_use_id || row.parentToolUseId) return [];
  const content = row.message?.content;
  return Array.isArray(content) ? [row, ...content.filter(part => part.type === 'tool_use' || part.type === 'tool_result')
    .map(part => ({ ...part, at: atOf(row) }))] : [row];
}

function readRows(entry, rows, session, at, native) {
  for (const raw of rows.flatMap(rootRows)) {
    const eventAt = atOf(raw);
    const when = Number.isFinite(eventAt) ? eventAt : at;
    const id = raw.sessionId ?? raw.session_id ?? raw.conversationId;
    if (id && session.sessionId && id !== session.sessionId || when < session.startedAt || when > at) continue;
    const kind = raw.hook_event_name ?? raw.payload?.type ?? raw.type;
    const failure = failureOf(raw);
    if (failure.kind) {
      const retryAt = typeof failure.retryAt === 'string' ? Date.parse(failure.retryAt) : failure.retryAt;
      if (when >= (entry.nativeFailure?.since ?? 0)) entry.nativeFailure = { status: failure.kind, since: when,
        ...(failure.kind === 'quota-wait' && { retryAt: Number.isFinite(retryAt) ? retryAt :
          parseResetAt(`quota ${typeof failure.reason === 'string' ? failure.reason : ''}`, when) }) };
      entry.poll = undefined;
      continue;
    }
    if (!native) entry.hookAt = Math.max(entry.hookAt, when);
    const input = tool(raw);
    if (/^(?:PreToolUse|tool_call_started|tool_call_input|tool_use|function_call|custom_tool_call)$/.test(kind) &&
        shellLoop(input.command)) entry.poll = { since: entry.poll?.since ?? when, id: input.id };
    const wasPolling = Boolean(entry.poll);
    if (entry.poll && (/^(?:UserPromptSubmit|PreInvocation|Stop|StopFailure|turn-start|turn-end|task_complete|turn_completed)$/.test(kind) ||
        /^(?:PostToolUse(?:Failure)?|tool_call_ended|function_call_output|custom_tool_call_output|tool_result)$/.test(kind) &&
        (!entry.poll.id || entry.poll.id === (raw.tool_use_id ?? input.id)))) entry.poll = undefined;
    const count = counterOf(raw);
    if (count) {
      const previous = entry.counts.get(count.key);
      if (count.output > (previous?.output ?? 0) || count.calls > (previous?.calls ?? 0)) {
        entry.counterAt = Math.max(entry.counterAt, when);
        entry.realAt = Math.max(entry.realAt, when);
      }
      entry.counts.set(count.key, count);
      if (entry.counts.size > 256) entry.counts.delete(entry.counts.keys().next().value);
    }
    if (!wasPolling && (/^(?:assistant|agent_message|reasoning|text_delta|model-progress|PLANNER_RESPONSE|PostToolUse|tool_call_ended|function_call_output)$/.test(kind) ||
        kind === 'turn-end' && raw.outcome?.kind === 'completed')) entry.realAt = Math.max(entry.realAt, when);
  }
}

export function createLiveness({ now = Date.now, hangMs = 45_000 } = {}) {
  const entries = new Map();
  return {
    remove(addr) { entries.delete(addr); },
    async observe(row, snapshot, durable) {
      const at = now();
      let entry = entries.get(row.addr);
      if (!entry) {
        entry = { hookAt: row.startedAt, counterAt: 0, realAt: 0, progressAt: durable?.lastProgressAt ?? row.startedAt,
          counts: new Map(), read: jsonlTail(), hooks: 0, screenFailure: durable?.screenFailure,
          health: durable?.health, initializedAt: at };
        entries.set(row.addr, entry);
      }
      if (!snapshot) return { lastProgressAt: entry.progressAt, health: entry.health, screenFailure: entry.screenFailure };
      const rows = snapshot.events ?? [];
      if (rows.length < entry.hooks) entry.hooks = 0;
      readRows(entry, rows.slice(entry.hooks), row, at, false);
      entry.hooks = rows.length;
      if (row.transcriptPath) {
        const stat = await lstat(row.transcriptPath).catch(() => undefined);
        if (stat?.isFile()) {
          if (entry.file?.path === row.transcriptPath && (stat.size > entry.file.size ||
              stat.ino !== entry.file.ino && stat.mtimeMs > entry.file.modified)) entry.nativeAt = at;
          entry.file = { path: row.transcriptPath, size: stat.size, ino: stat.ino, modified: stat.mtimeMs };
          readRows(entry, await entry.read(row.transcriptPath), row, at, true);
        }
      }
      const screen = snapshot.livenessScreen;
      if (typeof screen?.text === 'string') {
        const stable = screenProgress(screen.text);
        if (entry.stable && stable !== entry.stable) entry.screenAt = at;
        if (stable === entry.stable && screen.text !== entry.raw && screen.kind === 'busy') entry.animationAt = at;
        entry.stable = stable;
        entry.raw = screen.text;
        const failure = classifyFailure(screen.kind);
        const prior = entry.screenFailure;
        if (failure) {
          const sameIncident = prior?.status === failure && (prior.visible !== false || entry.realAt <= prior.since);
          const since = sameIncident ? prior.since : at;
          entry.screenFailure = { status: failure, since, visible: true, ...(failure === 'quota-wait' &&
            { retryAt: (sameIncident && prior.retryAt) || parseResetAt(screen.text, at) }) };
        } else if (prior?.visible !== false && prior) entry.screenFailure = { ...prior, visible: false };
      }
      const waiting = entry.poll && entry.poll.since >= entry.counterAt &&
        (snapshot.active || screen?.kind === 'busy' || snapshot.state === 'busy');
      entry.progressAt = Math.max(entry.progressAt, waiting ? entry.poll.since :
        Math.max(entry.nativeAt ?? 0, entry.hookAt, entry.counterAt, entry.screenAt ?? 0));
      const failure = [entry.nativeFailure, entry.screenFailure].filter(Boolean).sort((a, b) => a.since - b.since)[0];
      const newestFailure = Math.max(entry.nativeFailure?.since ?? 0, entry.screenFailure?.since ?? 0);
      let health;
      if (failure && newestFailure >= entry.realAt) {
        const latest = entry.nativeFailure?.since === newestFailure ? entry.nativeFailure : entry.screenFailure;
        health = { status: latest.status, since: entry.health?.status === latest.status ? entry.health.since : failure.status === latest.status ?
          failure.since : latest.since, reason: reasonFor[latest.status] };
        if (latest.status === 'quota-wait') health.retryAt = latest.retryAt ??
          (entry.screenFailure?.status === latest.status ? entry.screenFailure.retryAt : null) ?? null;
      } else if (waiting) {
        health = { status: 'waiting-poll', since: entry.poll.since, reason: reasonFor['waiting-poll'],
          zeroProgressMs: Math.max(0, at - entry.poll.since) };
      } else if (screen?.kind === 'busy' && (entry.health?.status === 'silent-hang' && entry.health.since === entry.progressAt ||
          entry.animationAt >= entry.progressAt && at - Math.max(entry.progressAt, entry.initializedAt) >= hangMs &&
          at - entry.animationAt <= hangMs)) {
        health = { status: 'silent-hang', since: entry.progressAt, reason: reasonFor['silent-hang'] };
      }
      // Screen sampling can follow an OSC report by one observation interval.
      // Record agreement without letting OSC establish an incident or reset liveness.
      const osc = snapshot.hcStatus;
      if (osc && health && osc.at <= at && osc.at >= Math.max(row.startedAt, health.since - 2_000) &&
          (health.status === 'auth-expired' && osc.kind === 'auth' ||
           health.status === 'silent-hang' && osc.state === 'working')) health.corroboratedBy = 'hc-osc7501';
      entry.health = health;
      return { lastProgressAt: entry.progressAt, health, screenFailure: entry.screenFailure };
    },
  };
}

export async function returnedToShell(terminal, text, lookup = processTable) {
  const pid = terminal.foreground?.pid ?? terminal.pid;
  if (!Number.isSafeInteger(pid) || !/(?:^|\n)[^\n]{0,120}[%$#❯]\s*$/.test(text ?? '')) return false;
  const parent = terminal.pid;
  const rows = await lookup(pid === parent ? [pid] : [pid, parent]);
  const shell = rows.get(pid);
  return shell?.uid === process.getuid() && (pid === parent || shell.ppid === parent) &&
    /(?:^|\/)-?(?:zsh|bash|sh|fish|ksh|dash)$/.test(shell.executable);
}
