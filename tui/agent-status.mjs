import { promptKind } from '../adapters/prompt-state.mjs';

// Orca b7fd7caa3, shared/agent-status/title/agent-title-glyphs.ts and
// main/runtime/agent-state-rules/claude.json. Bare working directory titles
// and names carry no activity evidence. Native hooks keep their authority.
export function titlePhase(provider, title) {
  if (provider === 'claude') {
    if (/^(?:✳|\* )/.test(title)) return 'idle';
    if (/^[\u25d0-\u25d3\u2800-\u28ff]|^\. /.test(title)) return 'busy';
  }
  if (provider === 'codex' && /^codex (?:working|thinking)\b/i.test(title)) return 'busy';
}

export const isDialog = kind => Boolean(promptKind(kind)) || ['trust-dialog', 'onboarding'].includes(kind);
export const isStartupBlocker = kind => ['trust-dialog', 'overlay', 'draft-held'].includes(kind);
export const isFailure = kind => ['rate-limit', 'auth-fail', 'error'].includes(kind);
export const blocksInput = kind => isDialog(kind) || isFailure(kind) || ['busy', 'compacting', 'blocked'].includes(kind);

export function currentTitle(observation, native, observedAt) {
  const title = observation.title;
  if (title?.phase && observedAt - title.observedAt < 3000 && title.observedAt >= (native.observedAt ?? 0)) {
    return title.phase;
  }
}
