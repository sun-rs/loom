import { appendFileSync, constants, readFileSync } from 'node:fs';
import { claudePrompt } from '../../adapters/claude/hooks.mjs';
import claude from '../../adapters/claude/index.mjs';
import { deliveryId } from '../../inbox/message.mjs';
import { hostToolDenial } from '../../lib/host-tool-guard.mjs';
import { recordSeniorToolDenial } from '../../lib/senior-tool-guard.mjs';

// Keep the adapter's hook vocabulary and also capture the fields needed for
// the native session handshake, input correlation and StopFailure details.
const fields = [
  'hook_event_name', 'session_id', 'transcript_path', 'cwd', 'source', 'model',
  'prompt_id', 'prompt', 'turn_id', 'tool_name', 'tool_use_id', 'last_assistant_message',
  'is_interrupt', 'stop_hook_active', 'error', 'error_details', 'notification_type',
];

try {
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  const [sink, sessionId, cwd] = process.argv.slice(2);
  const event = payload.hook_event_name;
  const { LOOM_SENIOR_TOOL_LOG: guardLog, LOOM_SENIOR_TOOL_PROJECT: project } = process.env;
  if (event === 'PreToolUse' && (!sessionId || payload.session_id === sessionId)) {
    const denial = hostToolDenial(payload.tool_name, payload.tool_input) ??
      recordSeniorToolDenial(guardLog, project, payload.cwd ?? cwd, payload.tool_name, payload.tool_input);
    if (denial) process.stdout.write(JSON.stringify({ hookSpecificOutput: {
      hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: denial,
    } }));
  }
  const changed = event === 'SessionStart' && payload.source !== 'compact' &&
    typeof payload.session_id === 'string' && payload.session_id && payload.session_id !== sessionId;
  if (sessionId && !payload.agent_id && !payload.isSidechain && !payload.parent_tool_use_id && !payload.parentToolUseId &&
      (payload.session_id === sessionId || changed) &&
      (['SessionStart', 'SessionEnd', 'PreCompact', 'PostCompact'].includes(event) || claude.hooks.normalize(payload))) {
    const row = { receivedAt: Date.now(), deliveryId: deliveryId(payload.prompt) };
    const promptState = claudePrompt(payload);
    if (promptState) row.promptState = promptState;
    if (payload.tool_name === 'Bash' && payload.tool_input?.run_in_background === true) row.backgroundBash = true;
    for (const field of fields) {
      const value = payload[field];
      if (typeof value === 'string' || typeof value === 'boolean') row[field] = value;
    }
    if (changed) Object.assign(row, { hook_event_name: 'SessionBindingChanged', session_id: sessionId,
      observed_session_id: payload.session_id, transcript_path: undefined });
    appendFileSync(sink, JSON.stringify(row) + '\n', {
      flag: constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      mode: 0o600, flush: true,
    });
  }
} catch {
  // Observation must never block a Claude turn.
}
