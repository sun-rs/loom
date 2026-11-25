import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText } from '../daemon/io.mjs';
import { CommandError, resolveTarget } from './sessions.mjs';
import { roles } from '../index/index.mjs';
import { projectIndex } from './project.mjs';

export const providers = ['codex', 'agy', 'claude', 'opencode'];
const keys = ['cli', 'model', 'effort'];
const modes = ['tui', 'headless'];
const hasText = value => typeof value === 'string' && Boolean(value.trim());
const matches = (profile, filter) => keys.every(key => filter[key] == null || profile[key] === filter[key]);
const example = fileURLToPath(new URL('../examples/policy.json', import.meta.url));
const defaultMaxActiveWorkers = 3;
const hardMaxActiveWorkers = 5;
const guidanceFields = {
  super: { preferLongPromptCacheTtl: 'boolean' },
  leader: { modelTier: 'strong', effort: ['medium', 'high'], preferLongPromptCacheTtl: 'boolean' },
  auditor: { modelTier: 'strong', vendorFamily: 'different-from-workers', preferLongPromptCacheTtl: 'boolean' },
  worker: { routineEffort: ['low', 'medium'], hardEffort: ['high', 'xhigh'] },
};

function validateGuidance(role, guidance) {
  if (guidance === undefined) return;
  if (!guidance || typeof guidance !== 'object' || Array.isArray(guidance)) throw new Error(`Invalid roles.${role}.guidance`);
  for (const [key, value] of Object.entries(guidance)) {
    const field = guidanceFields[role][key];
    const valid = Array.isArray(field) ? Array.isArray(value) && value.length > 0 &&
      new Set(value).size === value.length && value.every(item => field.includes(item)) :
      field === 'boolean' ? typeof value === 'boolean' : typeof field === 'string' && field === value;
    if (!valid) throw new Error(`Invalid roles.${role}.guidance.${key}`);
  }
}

function validateProfiles({ preferred = [], deny = [] }) {
  if (!Array.isArray(preferred) || !Array.isArray(deny)) throw new Error('Expected preferred and deny arrays');
  for (const entry of preferred) {
    if (!entry || !keys.every(key => hasText(entry[key])) || !providers.includes(entry.cli) ||
        entry.mode !== undefined && !modes.includes(entry.mode) ||
        Object.keys(entry).some(key => ![...keys, 'mode'].includes(key))) throw new Error('Invalid preferred profile');
  }
  for (const entry of deny) {
    if (!entry || !Object.keys(entry).length ||
        Object.entries(entry).some(([key, value]) => !keys.includes(key) || !hasText(value)) ||
        entry.cli && !providers.includes(entry.cli)) throw new Error('Invalid deny selector');
  }
}

function settings(project) {
  const path = join(project, '.project', 'policy.json');
  try {
    const source = readText(path, null);
    if (source === null) throw new Error(`Required project policy is missing. See ${example}`);
    const policy = JSON.parse(source);
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('Expected a policy object');
    if (Object.hasOwn(policy, 'maxActiveWorkers')) throw new Error('Set maxActiveWorkers under roles.leader');
    if (policy.keepAlive !== undefined && typeof policy.keepAlive !== 'boolean') throw new Error('Expected keepAlive to be a boolean');
    validateProfiles(policy);
    if (policy.roles !== undefined) {
      if (!policy.roles || typeof policy.roles !== 'object' || Array.isArray(policy.roles)) throw new Error('Expected a roles object');
      for (const [role, entry] of Object.entries(policy.roles)) {
        if (!roles.includes(role) || !entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Invalid role policy: ${role}`);
        validateProfiles(entry);
        validateGuidance(role, entry.guidance);
        if (Object.hasOwn(entry, 'maxActiveWorkers') && (role !== 'leader' ||
            !Number.isInteger(entry.maxActiveWorkers) || entry.maxActiveWorkers < 1 || entry.maxActiveWorkers > hardMaxActiveWorkers)) {
          throw new Error(`Expected roles.leader.maxActiveWorkers to be an integer from 1 to ${hardMaxActiveWorkers}`);
        }
      }
    }
    return policy;
  } catch (error) {
    throw new CommandError('invalid-policy', `${path}: ${error.message}`);
  }
}

export function enforceDeny(profile, deny) {
  if (deny.some(filter => matches(profile, filter))) {
    throw new CommandError('policy-denied', `Project policy denies ${profile.cli} / ${profile.model ?? '?'} / ${profile.effort ?? '?'}`);
  }
}

function checkWorkerCapacity(project, input, limit) {
  const rows = projectIndex(project).query();
  const caller = input.workerCaller && rows.find(row => row.pane === input.workerCaller || row.addr === input.workerCaller);
  const parent = input.parent ? rows.find(row => row.pane === input.parent) ??
    resolveTarget(rows, input.parent, caller?.addr) : caller;
  const projects = new Set(rows.map(row => row.project));
  const name = parent?.project ?? (projects.size === 1 ? projects.values().next().value : project);
  const addr = parent?.addr ?? null;
  const active = rows.filter(row => row.role === 'worker' && row.project === name && row.parent === addr && row.endedAt === null).length;
  if (active >= limit) {
    throw new CommandError('worker-capacity', `Parent ${addr ?? '(none)'} in ${name} has ${active} live workers (limit ${limit}). Stop a finished worker or wait for a worker to exit before spawning another.`);
  }
}

export function spawnProfile(project, input) {
  const requested = Object.fromEntries([...keys, 'mode'].map(key => [key, input[key] ?? null]));
  const policy = settings(project);
  const role = policy.roles?.[input.role];
  const preferred = role?.preferred ?? policy.preferred ?? [];
  const deny = [...(policy.deny ?? []), ...(role?.deny ?? [])];
  const profile = preferred.find(entry => matches(entry, requested));
  const selected = Object.fromEntries(keys.map(key => [key, requested[key] ?? profile?.[key]]));
  if (!keys.every(key => hasText(selected[key]))) {
    throw new CommandError('invalid-policy', 'Set matching defaults in .project/policy.json preferred (including roles.<role>.preferred), or specify --cli, --model and --effort');
  }
  enforceDeny(selected, deny);
  selected.mode = requested.mode ?? profile?.mode ?? (input.role === 'worker' ? 'headless' : 'tui');
  // loomd calls this before registering the new worker, inside its serialized spawn handler.
  if (input.role === 'worker' && Object.hasOwn(input, 'workerCaller')) {
    checkWorkerCapacity(project, input, policy.roles?.leader?.maxActiveWorkers ?? defaultMaxActiveWorkers);
  }
  return { requested, selected, deny };
}
