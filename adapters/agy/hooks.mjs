import { replyForStop } from './transcript.mjs';

// Orca b7fd7caa3: src/main/antigravity/hook-events.ts:3-22 (events used by loom).
const events = [
  { eventName: 'PreInvocation', schema: 'direct' },
  { eventName: 'Stop', schema: 'direct' },
  { eventName: 'PreToolUse', schema: 'tool' },
  { eventName: 'PostToolUse', schema: 'tool' },
];

// Orca b7fd7caa3: src/main/agent-hooks/installation/configuration/hook-config-schema.ts:26.
const MANAGED_HOOK_TIMEOUT_SECONDS = 10;

// Orca b7fd7caa3: src/main/antigravity/hooks-json-bundle.ts:68-76, buildEventDefinition.
function buildEventDefinition(event, command) {
  const handler = { type: 'command', command, timeout: MANAGED_HOOK_TIMEOUT_SECONDS };
  if (event.schema === 'tool') {
    return {
      matcher: '*',
      hooks: [handler],
    };
  }
  return handler;
}

export function hookConfig(commandForEvent) {
  const bundle = Object.fromEntries(events.map(event => [
    event.eventName, [buildEventDefinition(event, commandForEvent(event.eventName))],
  ]));
  return { 'loom-agy': bundle };
}

// Orca b7fd7caa3: src/main/antigravity/hook-events.ts:25-32.
/** The no-op reply the managed script prints, for paths that skip the script. */
export function getAntigravityNoOpStdout(eventName) {
  // Empty PreToolUse output leaves the decision to agy; any JSON, even {}, overrides its reviewer.
  if (eventName === 'PreToolUse') {
    return undefined;
  }
  return eventName === 'Stop' ? '{"decision":""}' : '{}';
}

// Orca b7fd7caa3: src/shared/agent-hook-listener/providers/antigravity/antigravity-event-rules.ts:4-6.
function isAntigravityStopStillBusy(hookPayload) {
  return hookPayload.fullyIdle === false || hookPayload.fully_idle === false;
}

const eventTypes = new Map([
  ['PreInvocation', 'turn-start'],
  ['PreToolUse', 'tool'],
  ['PostToolUse', 'tool'],
  ['Stop', 'turn-end'],
  ['StopFailure', 'stop-failure'],
]);
const string = value => typeof value === 'string' && value.trim() ? value : undefined;
const reasonFailed = /(?:^|_)(?:ERROR|USER_CANCEL(?:L)?ED|CANCEL(?:L)?ED|INTERRUPTED|ABORTED|MAX_STEPS_EXCEEDED|MAX_(?:FORCED_)?INVOCATIONS|MAX_TOKEN_BUDGET_EXCEEDED)$/i;

function hookName(payload) {
  const name = payload.hookEventName ?? payload.eventName ?? payload.hook_event_name ?? payload.event;
  if (name) return name;
  // Older agy payloads omit the event label. The legacy relay retains these Stop fields.
  if ('fullyIdle' in payload || 'fully_idle' in payload || 'terminationReason' in payload || 'termination_reason' in payload) return 'Stop';
  if (payload.toolCall || payload.tool_call) return 'PreToolUse';
  if ('invocationNum' in payload || 'invocation_num' in payload) return 'PreInvocation';
}

export function normalize(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const eventName = hookName(payload);
  let type = eventTypes.get(eventName);
  if (!type) return null;
  if (type === 'turn-start') {
    const invocation = payload.invocationNum ?? payload.invocation_num;
    if (invocation != null && invocation !== 0 && invocation !== '0') return null;
  }
  if (eventName === 'Stop') {
    if (isAntigravityStopStillBusy(payload)) return null;
    const reason = payload.terminationReason ?? payload.termination_reason ?? '';
    if (payload.error || reasonFailed.test(reason)) type = 'stop-failure';
  }
  const event = {
    type,
    sessionId: string(payload.conversationId ?? payload.conversation_id ?? payload.sessionId ?? payload.session_id) ?? null,
    transcriptPath: string(payload.transcriptPath ?? payload.transcript_path) ?? null,
  };
  if (type === 'turn-end') {
    const reply = string(payload.finalReply ?? payload.lastAssistantMessage) ??
      (typeof payload.transcriptText === 'string' ? replyForStop(payload.transcriptText, payload) : undefined);
    if (reply !== undefined) event.finalReply = reply;
  }
  return event;
}
