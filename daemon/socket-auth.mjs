import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { inDirectory } from '../cli/project.mjs';
import { CommandError } from '../cli/sessions.mjs';
import { writeState } from './io.mjs';

export const socketAuthVersion = 1;
const externalSuper = Object.freeze({ role: 'super', external: true });
const superId = 'external-super';
const sessionId = /^(?:loom|oar)-[0-9a-f-]{36}$/;
const tokenPattern = /^(external-super|(?:loom|oar)-[0-9a-f-]{36})\.[0-9a-f]{64}$/;

function directory(project, env) {
  const state = env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  if (!isAbsolute(state)) throw new Error('Loom state directory must be absolute');
  return join(state, 'loom', 'socket-auth', createHash('sha256').update(project).digest('hex'));
}

function readCapability(path, id) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const info = fstatSync(fd);
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o7777) !== 0o600 || info.size > 128) {
      throw new Error('Loom capabilities require a user-owned regular file with mode 0600');
    }
    const value = readFileSync(fd, 'utf8').trimEnd();
    if (tokenPattern.exec(value)?.[1] !== id) throw new Error('Invalid Loom capability file');
    return value;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function clientCapability(project, env = process.env) {
  if (env.LOOM_CAPABILITY !== undefined || env.LOOM_ADDR) {
    if (env.LOOM_PROJECT === project) return env.LOOM_CAPABILITY;
    return;
  }
  if (env.LOOM_EXTERNAL_SUPER === '1') return readCapability(join(directory(project, env), superId), superId);
}

export function hasStoredSessionCapability(project, addr, env = process.env) {
  return typeof addr === 'string' && sessionId.test(addr) && readCapability(join(directory(project, env), addr), addr) !== undefined;
}

export function socketCapabilities(project, env = process.env) {
  const dir = directory(project, env);
  // Check the real existing ancestor before creating anything. XDG state can
  // itself be a symlink, and the project can be a linked Git worktree.
  let ancestor = dir;
  while (!lstatSync(ancestor, { throwIfNoEntry: false })) ancestor = dirname(ancestor);
  ancestor = realpathSync(ancestor);
  if (inDirectory(project, ancestor) || inDirectory(project, dir)) throw new Error('Loom capability state must be outside the project');
  for (let parent = ancestor;; parent = dirname(parent)) {
    if (lstatSync(join(parent, '.git'), { throwIfNoEntry: false })) throw new Error('Loom capability state must be outside Git worktrees');
    if (parent === dirname(parent)) break;
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const info = lstatSync(dir);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o7777) !== 0o700) {
    throw new Error('Loom capability directory must be user-owned with mode 0700');
  }

  function ensure(id) {
    const path = join(dir, id);
    const saved = readCapability(path, id);
    if (saved) return { path, token: saved };
    const token = `${id}.${randomBytes(32).toString('hex')}`;
    writeState(path, token + '\n');
    return { path, token };
  }

  ensure(superId);
  return {
    ensureSession: ensure,
    hasSession: addr => readCapability(join(dir, addr), addr) !== undefined,
    revokeSession: addr => rmSync(join(dir, addr), { force: true }),
    identify(token, liveSession) {
      const id = typeof token === 'string' && tokenPattern.exec(token)?.[1];
      if (!id) return;
      const actor = id === superId ? externalSuper : liveSession(id);
      if (!actor) return;
      const saved = readCapability(join(dir, id), id);
      if (saved && timingSafeEqual(Buffer.from(saved), Buffer.from(token))) return actor;
    },
  };
}

const readCommands = new Set(['hello', 'daemon-status', 'upgrade-status', 'board', 'status', 'ls', 'state', 'session-memory']);
const superCommands = new Set(['daemon-stop', 'upgrade-plan', 'upgrade-apply', 'upgrade-holder', 'layout-up', 'layout-adopt', 'switch', 'recover', 'resume', 'pause']);
const memoryCommands = new Set(['mem', 'memory-proposals', 'memory-review', 'memory-index', 'memory-show']);
export const mayUseLegacyCaller = command => !memoryCommands.has(command) &&
  (!readCommands.has(command) || command === 'state');

export function authorizeSocketCommand(command, args, actor) {
  const role = actor?.role;
  let allowed;
  if (readCommands.has(command)) return;
  if (superCommands.has(command)) allowed = role === 'super';
  else if (memoryCommands.has(command) && actor?.external) allowed = false;
  else if (command === 'mem') {
    allowed = ['leader', 'auditor', 'super'].includes(role) || role === 'worker' && args.action === 'show';
  } else if (command === 'memory-proposals' || command === 'memory-review') {
    allowed = role === 'auditor' || role === 'super';
  } else if (command === 'memory-index' || command === 'memory-show') allowed = role === 'super';
  else if (command === 'accounts-refresh') allowed = role === 'super' || role === 'worker';
  else if (command === 'grant') allowed = role === (args.request === true ? 'leader' : 'super');
  else if (command === 'spawn') {
    allowed = ['super', 'leader', 'auditor', 'worker'].includes(args.role) && (role === 'super' ||
      args['resume-session'] === undefined && role === 'leader' &&
      (args.role === 'worker' && (args.parent === undefined || args.parent === actor.addr || args.parent === actor.pane || args.parent === 'leader') ||
        args.role === 'auditor' && typeof args['handover-from'] === 'string'));
  } else if (command === 'gate-pack' || command === 'handover' || command === 'stop') {
    allowed = role === 'leader' || role === 'super';
  } else if (command === 'escalate') allowed = role === 'leader';
  else if (['rotate', 'rotation-policy'].includes(command)) allowed = ['leader', 'auditor', 'super'].includes(role);
  else if (['assign', 'keep', 'release'].includes(command)) allowed = role === 'leader' || role === 'super';
  else if (command === 'audit-findings') {
    allowed = [args.id, args.category, args.evidence, args.regression].every(value => value === undefined) || role === 'auditor';
  } else if (command === 'worker-check') allowed = role === 'worker';
  else if (command === 'worker-handoff') {
    allowed = args.target === undefined ? role === 'worker' : ['leader', 'auditor', 'super'].includes(role);
  }
  else if (command === 'senior-override') allowed = role === 'leader' || role === 'auditor';
  else if (command === 'notifications') {
    allowed = (!args.take || role === 'super') && (args.resolveDecision === undefined || role === 'super') &&
      (args.auditEscalation === undefined || role === 'auditor') &&
      (args.gateComplete === undefined || ['leader', 'super'].includes(role)) &&
      ([args.complete, args.phase, args.decision, args.kind].every(value => value === undefined) ||
        ['leader', 'auditor', 'super'].includes(role));
  } else if (command === 'send') {
    allowed = (args.from === undefined || actor && typeof args.from === 'string' && (args.from === actor.addr || args.from === actor.pane ||
      args.from === 'super' && role === 'super')) &&
      (args.batch === undefined && args.batchSize === undefined || role === 'leader') &&
      (args.mode === 'queue' || ['leader', 'auditor', 'super'].includes(role));
  } else throw new CommandError('invalid-arguments', 'Unknown loomd request');
  if (!allowed) throw new CommandError('forbidden', `This Loom caller is not authorized for ${command}`);
}
