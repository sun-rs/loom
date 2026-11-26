import { readArtifacts, sessionProject } from './artifacts.mjs';
import { adapterFor, readTranscript, transcriptFor } from './sessions.mjs';
import { transcriptRows } from './turns.mjs';

const numeric = (...values) => values.find(Number.isFinite) ?? null;
const codexWindow = raw => raw.findLast(row => row.payload?.type === 'token_count' &&
  Number.isFinite(row.payload.info?.model_context_window))?.payload.info;

export function reportedContext(result, root, raw) {
  const journal = root.findLast(row => row.contextUsage || row.context || row.usage?.context);
  const reported = result.signals?.context ?? result.contextUsage ?? result.runtimeStatus?.contextUsage ??
    journal?.contextUsage ?? journal?.context ?? journal?.usage?.context;
  const context = reported?.value ?? reported;
  const codex = codexWindow(raw);
  const tokens = reported != null ? numeric(context?.tokens, context?.contextTokens) :
    numeric(codex?.last_token_usage?.total_tokens);
  const contextWindow = reported != null ? numeric(context?.contextWindow, context?.window) :
    numeric(codex?.model_context_window);
  const percent = numeric(context?.percent, tokens !== null && contextWindow > 0 ? 100 * tokens / contextWindow : null);
  return { tokens, contextWindow, percent };
}

export function nativeCallContext(session, { parsed, raw }, runtime) {
  const call = parsed.turns.findLast(turn => turn.calls?.length)?.calls.at(-1);
  const transcript = raw.map(({ row }) => row);
  let model = session.model;
  let window;
  let estimate;
  let input = call?.inputTokens;
  if (session.cli === 'codex') {
    const usage = codexWindow(transcript);
    window = usage?.model_context_window;
    input ??= usage?.last_token_usage?.input_tokens;
  } else if (session.cli === 'claude') {
    const assistant = call?.id && transcript.findLast(row => row.type === 'assistant' && !row.isSidechain && row.message?.id === call.id);
    model = assistant?.message?.model ?? model;
    if (model) {
      window = transcript.findLast(row => row.type === 'result' && row.modelUsage?.[model]?.contextWindow > 0)
        ?.modelUsage[model].contextWindow;
      // Published maximum for the resolved model, used when the CLI has not reported its window.
      // https://www.anthropic.com/claude/sonnet
      if (/^claude-sonnet-5-5(?:-\d{8})?$/.test(model)) estimate = 1_000_000;
    }
  } else if (session.cli === 'agy') {
    const step = call?.id != null && transcript.findLast(row => row.source === 'MODEL' &&
      row.type === 'PLANNER_RESPONSE' && String(row.step_index) === call.id);
    model = step?.model ?? model;
    // Published maximum for Neon, including Antigravity CLI effort variants.
    // https://antigravity.google/docs/models#gemini-4-neon
    if (/^gemini-4-neon(?:-(?:low|medium|high|xhigh))?$/.test(model)) estimate = 512 * 1024;
  }
  return { tokens: numeric(input, runtime?.tokens), window: runtime?.contextWindow > 0 ? runtime.contextWindow : window, estimate };
}

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
  const compactEvents = root.filter(row => row.type === 'compaction_ended' || row.hook_event_name === 'PostCompact');
  const compactRows = raw.filter(row => !row.isSidechain && row.parent_tool_use_id == null && row.parentToolUseId == null &&
    (row.type === 'compacted' || row.type === 'compact_boundary' || row.type === 'system' && row.subtype === 'compact_boundary'));
  const journalTurns = root.filter(row => row.type === 'turn-start' || row.hook_event_name === 'UserPromptSubmit' ||
    row.hook_event_name === 'PreInvocation' && Number(row.invocationNum ?? 0) === 0);
  return { ...result, signals: { ...signal, context: reportedContext(result, root, raw),
    compactions: numeric(signal.compactions, result.compactions, raw.length || root.length ?
      Math.max(compactEvents.length, compactRows.length) : null),
    turns: numeric(signal.turns, result.turns, journalTurns.length || null, transcript?.turns.length),
    usage: signal.usage ?? result.usage ?? root.findLast(row => row.type === 'usage')?.usage ?? transcript?.usage ?? null,
  } };
}
