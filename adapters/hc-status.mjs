import { approval, choice } from './prompt-state.mjs';

const apps = new Map([['antigravity', 'agy'], ['claude-code', 'claude'], ['opencode-mini', 'opencode']]);
const states = new Set(['idle', 'working', 'done', 'blocked', 'error']);
const kinds = new Set(['permission', 'question', 'auth']);

export function hcStatus(terminal, provider) {
  const { status, status_ms: at, created_ms: created } = terminal;
  const app = typeof status?.app === 'string' && status.app.toLowerCase();
  if (!app || (apps.get(app) ?? app) !== provider || !states.has(status.state) ||
      !Number.isFinite(at) || at < (created ?? 0)) return;
  return { app, state: status.state, at, ...(status.state === 'blocked' && kinds.has(status.kind) && { kind: status.kind }) };
}

export function corroboratePrompt(prompt, status, nativeAt = 0) {
  if (!prompt || !status || status.at < Math.max(nativeAt, prompt.since ?? 0)) return prompt;
  const kind = { permission: approval, question: choice }[status.kind];
  return kind && prompt.kind === kind ? { ...prompt, corroboratedBy: 'hc-osc7501' } : prompt;
}
