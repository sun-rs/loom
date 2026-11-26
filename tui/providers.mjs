import { promptDetails, questionDetails } from '../adapters/prompt-state.mjs';
import { claudePrompt } from '../adapters/claude/hooks.mjs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import claude from '../adapters/claude/index.mjs';
import { matchesPastePlaceholder } from '../adapters/claude/screen.mjs';
import codex from '../adapters/codex/index.mjs';
import agy from '../adapters/agy/index.mjs';
import { hasHeldComposer } from '../adapters/agy/screen.mjs';
import opencode from '../adapters/opencode/index.mjs';
import { parseAgyTranscriptLine } from '../adapters/agy/transcript.mjs';
import { screenEvidence, stopFailure } from '../runtimes/tui/failure.mjs';
import { claudeNativeDigest, deliveryId } from '../inbox/message.mjs';
import { addCodexStartHook } from '../runtimes/tui/codex-start.mjs';
import { agentResumeArgs } from './resume.mjs';

const capture = fileURLToPath(new URL('../runtimes/tui/capture-hook.mjs', import.meta.url));
const agyActivityCapture = fileURLToPath(new URL('./agy-activity-hook.mjs', import.meta.url));
const content = input => typeof input === 'string' ? input :
  Array.isArray(input) ? input.filter(block => ['text', 'input_text'].includes(block?.type)).map(block => block.text).join('\n') : undefined;
const agyScreen = text => text.trimEnd().replace(/\n[ \t]*(?:accept-edits|auto|plan|yolo) · [^·\n]+$/i, '');
const abortReason = /cancel|interrupt|abort/i;
const input = (value, key) => ({ inputId: deliveryId(value), key });
const activity = (phase, extra) => ({ phase, ...extra });

export const providers = {
  claude: {
    ...claude,
    screenInterrupt: true,
    restoresInterruptedDraft: true, // Escape can return the just-submitted prompt to the composer.
    screen: {
      ...claude.screen,
      pastePlaceholder: matchesPastePlaceholder,
      classify(text) {
        if (/^\s*[⏺⎿]\s+API Error:\s+401\b/m.test(text)) return 'auth-fail';
        if (/^\s*[⏺⎿]\s+API Error:\s+4(?!29)\d{2}\b/m.test(text)) return 'error';
        if (/^\s*[✻✳✶✢✽✺✹✸✷✴✵]\s+429\b[^\n]*retrying in /m.test(text)) return 'rate-limit';
        return screenEvidence(text).kind;
      },
      interruptions: text => screenEvidence(text).interruption,
    },
    async start(options) {
      const sessionId = options.resume ?? randomUUID();
      const { argv, env } = claude.launch({
        ...options, extraArgs: [...(options.resume ? agentResumeArgs('claude', sessionId) : ['--session-id', sessionId]),
          '--prompt-suggestions', 'off', ...(options.extraArgs ?? [])],
      });
      const index = argv.indexOf('--settings') + 1;
      const settings = JSON.parse(argv[index]);
      if (options.fast !== undefined) settings.fastMode = options.fast;
      const observer = { ...settings.hooks.Stop[0].hooks[0], args: [options.hookRunner ?? capture, options.hookSink, sessionId, options.cwd] };
      for (const entries of Object.values(settings.hooks)) for (const entry of entries) entry.hooks = [observer];
      for (const event of ['SessionStart', 'SessionEnd', 'PreCompact', 'PostCompact']) {
        settings.hooks[event] = [{ hooks: [observer] }];
      }
      argv[index] = JSON.stringify(settings);
      return { argv, env, sessionId };
    },
    hook(row) {
      if (row.hook_event_name === 'SessionStart' && row.source !== 'compact') return activity('idle');
      if (row.hook_event_name === 'SessionEnd') return activity('unknown');
      if (row.is_interrupt === true) return activity('idle', { interrupted: true });
      if (row.hook_event_name === 'PreCompact') return activity('compacting');
      if (row.hook_event_name === 'PostCompact') return { compactionFinished: true };
      if (row.hook_event_name === 'StopFailure') {
        const { failure } = stopFailure(row);
        return activity(failure === 'rate_limited' || failure === 'quota' ? 'rate-limit' : 'error');
      }
      const prompt = row.promptState ?? claudePrompt(row);
      if (prompt) return { prompt, promptTool: row.tool_name,
        genericApproval: row.notification_type === 'permission_prompt' };
      if (row.hook_event_name === 'Notification' && /^elicitation_(?:complete|response)$/.test(row.notification_type)) {
        return { clearPrompt: true };
      }
      if (/^PostToolUse(?:Failure)?$/.test(row.hook_event_name)) return { clearPrompt: row.tool_name };
    },
    transcriptRow(row, expectedPayload) {
      if (row.isCompactSummary === true || row.type === 'system' && row.subtype === 'compact_boundary') {
        return { compactionFinished: true };
      }
      if (row.type === 'system' && row.subtype === 'informational' && /^Compacted while idle\b/i.test(row.content)) {
        return activity('idle');
      }
      if (row.type === 'user' && !row.isMeta && !row.isCompactSummary && !row.isVisibleInTranscriptOnly) {
        const message = content(row.message?.content);
        if (row.interruptedMessageId || /^\[Request interrupted by user/.test(message ?? '')) return activity('idle', { interrupted: true });
        const id = deliveryId(message);
        if (id) return { ...input(message, row.uuid), payloadDigest: claudeNativeDigest(message, id, expectedPayload?.(id)), phase: 'busy' };
      }
      if (row.type === 'assistant' && row.isApiErrorMessage) {
        const { failure } = stopFailure({ error: row.apiError ?? row.error, error_details: content(row.message?.content) });
        return activity(failure === 'rate_limited' || failure === 'quota' ? 'rate-limit' : 'error');
      }
      if (row.type === 'system' && row.subtype === 'turn_aborted') return activity('idle', { interrupted: true });
    },
  },
  codex: {
    ...codex,
    screenStartup: true, // The native SessionStart hook runs inside the first turn.
    start(options) {
      const spec = codex.launch(options);
      addCodexStartHook(spec.argv, options.hookSink, options.cwd, options.hookRunner);
      if (options.trustWorkspace === false) {
        const config = spec.argv.findIndex(arg => arg.startsWith('projects='));
        if (config > 0) spec.argv.splice(config - 1, 2);
      }
      if (options.resume) {
        const positional = spec.argv.lastIndexOf('--');
        spec.argv.splice(positional < 0 ? spec.argv.length : positional, 0, ...agentResumeArgs('codex', options.resume));
        spec.sessionId = options.resume;
      }
      return spec;
    },
    hook(row) {
      if (row.hook_event_name === 'SessionStart') return row.source === 'compact' ?
        { compactionFinished: true } : activity('idle');
      if (row.hook_event_name === 'Interrupt') return activity('idle', { interrupted: true });
    },
    transcriptRow({ type, payload }) {
      if (type !== 'event_msg') return;
      switch (payload?.type) {
        case 'task_started': return activity('busy', { turnId: payload.turn_id });
        case 'task_complete': return activity('idle', { turnId: payload.turn_id });
        case 'turn_aborted': return activity('idle', { interrupted: true, turnId: payload.turn_id });
        case 'user_message': return { ...input(payload.message, payload.id), phase: 'busy' };
      }
    },
  },
  agy: {
    ...agy,
    screenStartup: true, // agy emits its first root hook at PreInvocation.
    screenInterrupt: true, // agy can cancel without emitting Stop.
    screen: {
      ...agy.screen,
      classify(text) {
        if (/^\s*⚠ request failed \(code 429\):/m.test(text)) return 'rate-limit';
        if (/^\s*⚠ request failed \(code [45]\d{2}\):/m.test(text)) return 'error';
        return this.dialogKeys('onboarding', text).length ? 'onboarding' : agy.screen.classify(agyScreen(text));
      },
      interruptions: text => (text.match(/^\s*(?:⎿\s*)?Interrupted · What should Antigravity CLI do instead\?\s*$/gm) ?? []).length,
      hasEmptyComposer: text => agy.screen.hasEmptyComposer(agyScreen(text)),
      hasHeldComposer,
      dialogKeys(kind, text) {
        if (kind !== 'onboarding') return agy.screen.dialogKeys(kind, agyScreen(text));
        return /^\s*Welcome to Antigravity CLI!\s*$/m.test(text) && /^\s*Choose your color scheme:/m.test(text) &&
          /^\s*> terminal\s+│/m.test(text) && /^\s*\[Next\]\s*$/m.test(text) &&
          /^\s*↑\/↓ Navigate · enter Confirm\s*$/m.test(text) ? ['enter'] : [];
      },
    },
    start(options) {
      const spec = agy.launch({ ...options,
        captureScript: options.boundTranscript === false ? agyActivityCapture : options.hookRunner,
        ...(options.resume && { expectedSessionId: options.resume, extraArgs: [...agentResumeArgs('agy', options.resume), ...(options.extraArgs ?? [])] }),
      });
      if (options.resume) spec.sessionId = options.resume;
      if (options.trustWorkspace === false) {
        const index = spec.argv.indexOf('--settings') + 1;
        const settings = JSON.parse(spec.argv[index]);
        settings.trustedWorkspaces = settings.trustedWorkspaces.filter(path => path !== options.cwd);
        spec.argv[index] = JSON.stringify(settings);
      }
      return spec;
    },
    hook(row) {
      if (abortReason.test(row.terminationReason ?? '')) return activity('idle', { interrupted: true });
      if (row.hook_event_name === 'Stop' && row.fullyIdle !== true) return activity('busy');
      if (row.toolName === 'ask_question') {
        if (row.hook_event_name === 'PreToolUse' && !row.questionDenied) return { prompt: row.promptState ?? questionDetails(), promptTool: row.toolName };
        if (row.hook_event_name === 'PostToolUse') return { clearPrompt: row.toolName };
      }
    },
    transcriptRow(row) {
      const user = parseAgyTranscriptLine(row, { preserveUserWhitespace: true }).find(event => event.kind === 'user');
      if (user) return { ...input(user.text, row.step_index), userText: user.text, phase: 'busy' };
    },
  },
  opencode: {
    ...opencode,
    screen: { ...opencode.screen, hasEmptyComposer: text => opencode.screen.classify(text) === 'idle' },
    start: options => ({ ...opencode.launch(options), sessionId: options.sessionId }),
    hook(row) {
      if (row.hook_event_name === 'SessionStart') return activity('idle');
      if (row.hook_event_name === 'PromptOpened') {
        const { kind, summary, options } = row.promptState ?? {};
        return { prompt: promptDetails(kind, summary, options), promptTool: row.requestId };
      }
      if (row.hook_event_name === 'PromptClosed') return { clearPrompt: row.requestId };
    },
    transcriptRow: () => undefined,
  },
};

export function hookObservation(provider, row, expectedPayload) {
  if (row.agent_id || row.isSidechain) return;
  const native = provider.hooks.normalize(row);
  const detail = provider.hook(row);
  if (!native?.type && !detail) return;
  const { type } = native ?? {};
  const start = type === 'turn-start';
  const interrupted = row.is_interrupt === true;
  const inputId = start ? row.deliveryId ?? deliveryId(row.prompt) : undefined;
  return {
    phase: start || type === 'tool' || type === 'turn-paused' ? 'busy' :
      type === 'turn-end' ? 'idle' : type === 'stop-failure' ? 'error' : undefined,
    ...detail,
    interrupted: detail?.interrupted ?? interrupted,
    inputId,
    ...(inputId && provider.id === 'claude' && { payloadDigest: claudeNativeDigest(row.prompt, inputId, expectedPayload?.(inputId)) }),
    key: row.turn_id ?? row.prompt_id ?? row.initialNumSteps,
    turnId: row.turn_id ?? row.prompt_id ?? (row.executionNum == null ? undefined : String(row.executionNum)),
    sessionId: native?.sessionId ?? row.session_id ?? row.conversationId,
    transcriptPath: native?.transcriptPath ?? row.transcript_path,
  };
}

export function hostPhase(value) {
  switch (value) {
    case 'working': case 'busy': case 'running': case 'thinking': return 'busy';
    case 'idle': case 'done': case 'ready': case 'resting': return 'idle';
    case 'blocked': case 'waiting': case 'needs-input': return 'blocked';
    case 'error': case 'errored': return 'error';
  }
}
