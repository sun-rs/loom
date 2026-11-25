import { readArtifacts, sessionProject } from './artifacts.mjs';
import { adapterFor, readTranscript, transcriptFor } from './sessions.mjs';
import { transcriptRows } from './turns.mjs';

const numeric = (...values) => values.find(Number.isFinite) ?? null;

export function presentState(result, session, directory) {
  const project = sessionProject(directory, session);
  const artifacts = project && readArtifacts(project);
  const events = artifacts?.journal(session.addr) ?? [];
  const root = events.filter(row => !row.agent_id && !row.isSidechain &&
    (!session.sessionId || (row.session_id ?? row.sessionId ?? row.conversationId) === session.sessionId));
  let transcript = null;
  let raw = [];
  try {
    const path = transcriptFor(session);
    const text = readTranscript(path);
    transcript = adapterFor(session).transcript.parse(text);
    raw = transcriptRows(text).map(item => item.row);
  } catch { /* The daemon can still report current signals without a bound transcript. */ }

  const signal = result.signals ?? {};
  const journalContext = root.findLast(row => row.contextUsage || row.context)?.contextUsage ??
    root.findLast(row => row.context)?.context;
  const codexContext = raw.findLast(row => row.payload?.type === 'token_count' &&
    Number.isFinite(row.payload.info?.model_context_window))?.payload.info;
  const reported = signal.context ?? result.contextUsage ?? result.runtimeStatus?.contextUsage ?? journalContext;
  const context = reported?.value ?? reported;
  const tokens = reported !== undefined && reported !== null ? numeric(context?.tokens, context?.contextTokens) :
    numeric(codexContext?.last_token_usage?.total_tokens);
  const contextWindow = reported !== undefined && reported !== null ? numeric(context?.contextWindow, context?.window) :
    numeric(codexContext?.model_context_window);
  const percent = numeric(context?.percent, tokens !== null && contextWindow > 0 ? 100 * tokens / contextWindow : null);
  const compactEvents = root.filter(row => row.type === 'compaction_ended' || row.hook_event_name === 'PostCompact');
  const compactRows = raw.filter(row => !row.isSidechain && row.parent_tool_use_id == null && row.parentToolUseId == null &&
    (row.type === 'compacted' || row.type === 'compact_boundary' || row.type === 'system' && row.subtype === 'compact_boundary'));
  const journalTurns = root.filter(row => row.type === 'turn-start' || row.hook_event_name === 'UserPromptSubmit' ||
    row.hook_event_name === 'PreInvocation' && Number(row.invocationNum ?? 0) === 0);
  return { ...result, signals: { ...signal, context: { tokens, contextWindow, percent },
    compactions: numeric(signal.compactions, result.compactions, raw.length || root.length ?
      Math.max(compactEvents.length, compactRows.length) : null),
    turns: numeric(signal.turns, result.turns, journalTurns.length || null, transcript?.turns.length),
    usage: signal.usage ?? result.usage ?? root.findLast(row => row.type === 'usage')?.usage ?? transcript?.usage ?? null,
  } };
}
