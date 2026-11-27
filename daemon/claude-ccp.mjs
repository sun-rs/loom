import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { CommandError } from '../cli/sessions.mjs';

const nativeVersionsPattern = /\/\.local\/share\/claude\/versions\/|\/claude\/versions\//i;

export function defaultCcpClaudeEntry(env = process.env) {
  const configured = env.LOOM_CLAUDE_CCP_BIN;
  if (configured) {
    if (!isAbsolute(configured)) throw new CommandError('ccp-required', 'LOOM_CLAUDE_CCP_BIN must be an absolute path');
    return resolve(configured);
  }
  const home = env.HOME || homedir();
  return join(home, '.local', 'bin', 'claude');
}

export function isCcpClaudeEntry(entry, env = process.env) {
  if (typeof entry !== 'string' || !isAbsolute(entry) || /[\x00-\x1f\x7f]/.test(entry)) return false;
  if (nativeVersionsPattern.test(entry)) return false;
  const normalized = resolve(entry);
  const expected = defaultCcpClaudeEntry(env);
  return normalized === expected;
}

export function validateCcpClaudeEntry(entry, env = process.env) {
  const candidate = entry ?? defaultCcpClaudeEntry(env);
  if (!isCcpClaudeEntry(candidate, env)) {
    throw new CommandError('ccp-required',
      `Claude must launch through the CCP entry (${defaultCcpClaudeEntry(env)}); refusing ${candidate ?? '(unset)'}`);
  }
  return resolve(candidate);
}

export function claudeCcpNotReady(operation = 'Claude operation') {
  return new CommandError('not-ready',
    `${operation} via CCP depends on CCP-ROUTE-1 (not yet delivered); direct native Claude launch is forbidden`);
}

export function createClaudeCcpBridge(impl = {}) {
  const ready = Boolean(impl.ready);
  return {
    ready,
    async launchSuper(request = {}) {
      const entry = validateCcpClaudeEntry(request.entry, request.env);
      if (typeof impl.launchSuper === 'function') return impl.launchSuper({ ...request, entry });
      throw claudeCcpNotReady('Claude Super launch');
    },
    async resumeSuper(request = {}) {
      const entry = validateCcpClaudeEntry(request.entry, request.env);
      if (typeof impl.resumeSuper === 'function') return impl.resumeSuper({ ...request, entry });
      throw claudeCcpNotReady('Claude Super resume');
    },
    async resumeSession(request = {}) {
      const entry = validateCcpClaudeEntry(request.entry, request.env);
      if (typeof impl.resumeSession === 'function') return impl.resumeSession({ ...request, entry });
      throw claudeCcpNotReady('Claude session resume');
    },
  };
}
