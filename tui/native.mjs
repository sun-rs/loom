import { realpath } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path';
import { jsonlTail } from '../runtimes/tui/read-jsonl.mjs';
import { hookObservation } from './providers.mjs';

function inside(root, path) {
  const child = relative(root, path);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

export function nativeState(provider, { hookSink, evidenceRoot, cwd, sessionId, boundTranscript = false, resumedAt }) {
  const readHook = jsonlTail();
  const readTranscript = jsonlTail();
  const receipts = new Map();
  let transcript;
  let candidate;
  let state;
  let activeTurn;
  let activeSince;
  let activeInputId;
  let activeHookKey;
  let sessionChanged = false;
  let interruption = 0;
  let transcriptOrder = 0;
  let hookOrder = 0;
  const at = row => row.receivedAt ?? (Date.parse(row.timestamp ?? row.created_at) || Date.now());

  async function hooks() {
    const observations = [];
    for (const row of await readHook(hookSink)) {
      const event = hookObservation(provider, row);
      if (!event?.sessionId || row.cwd !== cwd || resumedAt !== undefined && !(row.receivedAt >= resumedAt)) continue;
      if (sessionId && event.sessionId !== sessionId) {
        sessionChanged = true;
        continue;
      }
      sessionId ??= event.sessionId;
      candidate ??= event.transcriptPath;
      const begin = ['PreInvocation', 'UserPromptSubmit'].includes(row.hook_event_name) && event.phase === 'busy';
      observations.push({ ...event, beginKey: begin ? event.key ?? hookOrder : undefined,
        startup: row.hook_event_name === 'SessionStart',
        observedAt: at(row), order: hookOrder++, source: 'hook' });
    }
    return observations;
  }

  function record(event) {
    if (event.inputId) {
      const sources = receipts.get(event.inputId) ?? new Map();
      const seen = sources.get(event.source) ?? new Map();
      seen.set(event.key ?? event.order, event);
      sources.set(event.source, seen);
      receipts.set(event.inputId, sources);
    }
    if (!event.phase || state && (event.observedAt < state.observedAt || event.startup && state.phase === 'busy')) return;
    if (event.phase === 'busy') {
      if (state?.phase !== 'busy' || event.turnId && activeTurn && event.turnId !== activeTurn ||
          event.inputId && activeInputId && event.inputId !== activeInputId ||
          event.beginKey != null && activeHookKey != null && event.beginKey !== activeHookKey) {
        activeSince = event.observedAt;
        activeInputId = undefined;
        activeHookKey = undefined;
      }
      activeTurn = event.turnId ?? activeTurn;
      activeInputId = event.inputId ?? activeInputId;
      activeHookKey = event.beginKey ?? activeHookKey;
    }
    if (event.phase === 'idle' || event.phase === 'unknown') {
      if (activeTurn && event.turnId && activeTurn !== event.turnId) return;
      activeTurn = undefined;
      activeSince = undefined;
      activeInputId = undefined;
      activeHookKey = undefined;
    }
    if (event.interrupted) interruption += 1;
    state = event;
  }

  function validTranscript(path) {
    if (!isAbsolute(path) || extname(path) !== '.jsonl' ||
        /(?:^|\/)(?:provider-homes|memories[^/]*|\.env[^/]*)(?:\/|$)/i.test(path)) return false;
    if (inside(evidenceRoot, path)) return true;
    if (!boundTranscript || !/^[a-z0-9_-]+$/i.test(sessionId ?? '')) return false;
    if (provider.id === 'claude') return path.includes('/projects/') && basename(path) === `${sessionId}.jsonl`;
    if (provider.id === 'codex') return path.includes('/sessions/') && path.endsWith(`-${sessionId}.jsonl`);
    return provider.id === 'agy' && path.includes(`/antigravity-cli/brain/${sessionId}/`) &&
      /^transcript(?:_full)?\.jsonl$/.test(basename(path));
  }

  return {
    async read() {
      const observations = await hooks();
      if (!transcript && typeof candidate === 'string' && validTranscript(candidate)) {
        const paths = provider.id === 'agy' ? [join(dirname(candidate), 'transcript_full.jsonl'), candidate] : [candidate];
        for (const path of paths) {
          const actual = await realpath(path).catch(error => {
            if (error.code !== 'ENOENT') throw error;
          });
          if (actual === path && validTranscript(actual)) { transcript = actual; break; }
        }
      }
      for (const row of await readTranscript(transcript)) {
        if (row.isSidechain || row.parent_tool_use_id || row.parentToolUseId ||
            row.sessionId && row.sessionId !== sessionId ||
            resumedAt !== undefined && !(Date.parse(row.timestamp ?? row.created_at) >= resumedAt)) continue;
        const event = provider.transcriptRow(row);
        if (event) observations.push({ ...event, sessionId, observedAt: at(row), order: transcriptOrder++, source: 'transcript' });
      }
      observations.push(...await hooks());
      observations.sort((a, b) => a.observedAt - b.observedAt || (a.source === b.source ? a.order - b.order : a.source === 'hook' ? 1 : -1));
      for (const observation of observations) record(observation);
      return {
        sessionId, phase: sessionChanged ? 'unknown' : state?.phase, source: state?.source, observedAt: state?.observedAt, interruption,
        activeTurn, activeSince, activeInputId, transcriptPath: transcript,
      };
    },
    confirmations(id) {
      const sources = receipts.get(id);
      const hook = [...(sources?.get('hook')?.values() ?? [])];
      const transcript = [...(sources?.get('transcript')?.values() ?? [])];
      const count = Math.max(hook.length, transcript.length);
      const anchor = hook[0] ?? transcript[0];
      return {
        count, hook: hook.length, transcript: transcript.length,
        ...(anchor && { source: anchor.source, at: anchor.observedAt, sessionId: anchor.sessionId, turnId: anchor.turnId }),
      };
    },
  };
}
