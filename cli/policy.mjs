import { validateRotation } from '../lib/rotation-settings.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText, writeState } from '../daemon/io.mjs';
import { CommandError, resolveTarget } from './sessions.mjs';
import { roles } from '../index/index.mjs';
import { tierTarget, workerTiers } from '../lib/worker-tiers.mjs';
import { projectIndex, runtimeDirectory } from './project.mjs';

export const providers = ['codex', 'agy', 'claude', 'opencode'];
const keys = ['cli', 'model', 'effort'];
const modes = ['tui', 'headless'];
const hasText = value => typeof value === 'string' && Boolean(value.trim());
const matches = (profile, filter) => keys.every(key => filter[key] == null || profile[key] === filter[key]);
const example = fileURLToPath(new URL('../examples/policy.json', import.meta.url));
const defaultMaxActiveWorkers = 3;
const hardMaxActiveWorkers = 4;
export const defaultCoalesceMs = 45_000;
export const defaultReplyBytes = 600;
export const workerWarmMs = (policy, cli) => policy.workers?.warmMs?.[cli] ?? policy.workers?.idleRetainMs ?? 10 * 60_000;
export const workerReuseLimits = policy => ({
  contextPercent: 100 * (policy.workers?.reuseMaxContext ?? 0.6),
  compactions: policy.workers?.reuseMaxCompactions ?? 1,
});
export const workerHandoffLimits = policy => ({
  remainingPercent: 100 * (policy.workers?.handoffMinRemaining ?? 0.15),
  compactions: policy.workers?.handoffMinCompactions ?? 1,
});
const nonnegativeMs = value => Number.isSafeInteger(value) && value >= 0;
function validWorkerPolicy(key, value) {
  if (key === 'idleRetainMs' || key === 'reuseMaxCompactions') return nonnegativeMs(value);
  if (key === 'reuseMaxContext' || key === 'handoffMinRemaining') return Number.isFinite(value) && value >= 0 && value <= 1;
  if (key === 'handoffMinCompactions') return Number.isSafeInteger(value) && value >= 1;
  return key === 'warmMs' && value && typeof value === 'object' && !Array.isArray(value) &&
    Object.entries(value).every(([cli, ms]) => providers.includes(cli) && nonnegativeMs(ms));
}
export const costPriceFields = ['freshInput', 'cacheWrite', 'cacheRead', 'output'];
export const driftDefaults = Object.freeze({
  netLines: null, budgetRaises: 2, slowCommandFactor: 2, slowCommandSamples: 1,
  planLines: 120, repeatedFailures: 2, factMiss: true, sampleIntervalMs: 30_000,
});
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
        entry.fast !== undefined && typeof entry.fast !== 'boolean' ||
        Object.keys(entry).some(key => ![...keys, 'mode', 'fast'].includes(key))) throw new Error('Invalid preferred profile');
  }
  for (const entry of deny) {
    if (!entry || !Object.keys(entry).length ||
        Object.entries(entry).some(([key, value]) => !keys.includes(key) || !hasText(value)) ||
        entry.cli && !providers.includes(entry.cli)) throw new Error('Invalid deny selector');
  }
}

const warnedReviewerPolicies = new Set();

export function readPolicy(project, { optional = false, warn = console.error } = {}) {
  const path = join(project, '.project', 'policy.json');
  try {
    const source = readText(path, null);
    if (source === null && optional) return {};
    if (source === null) throw new Error(`Required project policy is missing. See ${example}`);
    const policy = JSON.parse(source);
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('Expected a policy object');
    if (Object.hasOwn(policy, 'maxActiveWorkers')) throw new Error('Set maxActiveWorkers under roles.leader');
    validateProfiles(policy);
    validateRotation(policy.rotation);
    if (policy.cost !== undefined) {
      const prices = policy.cost?.prices;
      if (!prices || typeof prices !== 'object' || Array.isArray(prices) ||
          Object.keys(policy.cost).some(key => key !== 'prices') ||
          Object.entries(prices).some(([cli, rate]) => !providers.includes(cli) ||
            !rate || typeof rate !== 'object' || Array.isArray(rate) ||
            Object.entries(rate).some(([field, value]) => !costPriceFields.includes(field) ||
              !Number.isFinite(value) || value < 0))) {
        throw new Error('Expected cost.prices with nonnegative USD rates per million tokens, keyed by CLI');
      }
    }
    if (policy.delivery !== undefined && (!policy.delivery || typeof policy.delivery !== 'object' ||
        Array.isArray(policy.delivery) || Object.entries(policy.delivery).some(([key, value]) =>
          !Number.isSafeInteger(value) || (['coalesceMs', 'stallMs'].includes(key) ? value < 0 : key !== 'replyBytes' || value < 160)))) {
      throw new Error('Expected nonnegative integer delivery.coalesceMs or delivery.stallMs, or delivery.replyBytes (≥ 160)');
    }
    if (policy.workers !== undefined && (!policy.workers || typeof policy.workers !== 'object' ||
        Array.isArray(policy.workers) || Object.entries(policy.workers).some(([key, value]) => !validWorkerPolicy(key, value)))) {
      throw new Error('Invalid worker cache, reuse or handoff settings');
    }
    if (policy.drift !== undefined) {
      if (!policy.drift || typeof policy.drift !== 'object' || Array.isArray(policy.drift)) throw new Error('Expected a drift object');
      for (const [key, value] of Object.entries(policy.drift)) {
        if (key === 'deferAuditorNotices' && typeof value === 'boolean') continue;
        if (!Object.hasOwn(driftDefaults, key) ||
            (key === 'factMiss' ? typeof value !== 'boolean' :
              key === 'slowCommandFactor' ? value !== null && !(Number.isFinite(value) && value > 1) :
              !(value === null && !['sampleIntervalMs', 'slowCommandSamples'].includes(key)) &&
                !(Number.isSafeInteger(value) && value >= (['netLines', 'sampleIntervalMs'].includes(key) ? 0 : 1)))) {
          throw new Error(`Invalid drift.${key}`);
        }
      }
    }
    if (policy.roles !== undefined) {
      if (!policy.roles || typeof policy.roles !== 'object' || Array.isArray(policy.roles)) throw new Error('Expected a roles object');
      if (Object.hasOwn(policy.roles, 'reviewer')) {
        if (!warnedReviewerPolicies.has(path)) {
          warn(`${path}: Remove roles.reviewer. The Auditor now checks evidence at phase boundaries.`);
          warnedReviewerPolicies.add(path);
        }
        delete policy.roles.reviewer;
      }
      for (const [role, entry] of Object.entries(policy.roles)) {
        if (!roles.includes(role) || !entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Invalid role policy: ${role}`);
        validateProfiles(entry);
        validateGuidance(role, entry.guidance);
        if (entry.tiers !== undefined && (role !== 'worker' || !entry.tiers || typeof entry.tiers !== 'object' ||
            Array.isArray(entry.tiers) || Object.entries(entry.tiers).some(([wave, tier]) =>
              !tierTarget.test(wave) || !workerTiers.includes(tier)))) {
          throw new Error('Expected roles.worker.tiers to map exact wave names to sandbox, integration or host');
        }
        const rotates = ['leader', 'auditor'].includes(role);
        if (entry.rotateAtCompactions !== undefined && (!['super', 'leader', 'auditor'].includes(role) ||
            !Number.isSafeInteger(entry.rotateAtCompactions) || entry.rotateAtCompactions < 1)) {
          throw new Error(`Expected a positive resident compaction limit for roles.${role}.rotateAtCompactions`);
        }
        if (entry.toolGuard !== undefined && (!rotates || typeof entry.toolGuard !== 'boolean')) {
          throw new Error('Expected roles.leader.toolGuard or roles.auditor.toolGuard to be a boolean');
        }
        if (entry.rotateAt !== undefined && (!rotates || entry.rotateAt !== 'gate')) {
          throw new Error('Expected roles.leader.rotateAt or roles.auditor.rotateAt to be gate');
        }
        for (const key of ['maxContextFraction', 'minRemainingAfterCompaction']) {
          if (entry[key] !== undefined && (!rotates || !Number.isFinite(entry[key]) || entry[key] <= 0 || entry[key] > 1)) {
            throw new Error(`Invalid roles.${role}.${key}: expected a fraction in (0, 1] for Leader or Auditor`);
          }
        }
        for (const [key, min] of [['maxWakesPerGate', 0], ['maxContextTokens', 1]]) {
          const allowed = key === 'maxWakesPerGate' ? role === 'auditor' : rotates;
          if (Object.hasOwn(entry, key) && (!allowed || !Number.isSafeInteger(entry[key]) || entry[key] < min)) {
            throw new Error(`Invalid roles.${role}.${key}: expected an integer >= ${min} for a role with that budget`);
          }
        }
        if (entry.trustWorkspace !== undefined && typeof entry.trustWorkspace !== 'boolean') {
          throw new Error(`Expected roles.${role}.trustWorkspace to be a boolean`);
        }
        if (entry.allowNativeQuestions !== undefined && typeof entry.allowNativeQuestions !== 'boolean') {
          throw new Error(`Expected roles.${role}.allowNativeQuestions to be a boolean`);
        }
        if (entry.auth !== undefined && !['subscription', 'api-key'].includes(entry.auth)) {
          throw new Error(`Expected roles.${role}.auth to be subscription or api-key`);
        }
        if (entry.claude !== undefined && (!entry.claude || typeof entry.claude !== 'object' ||
            Array.isArray(entry.claude) || entry.claude.idleCompaction !== undefined &&
            typeof entry.claude.idleCompaction !== 'boolean')) {
          throw new Error(`Expected roles.${role}.claude to be an object with an optional boolean idleCompaction`);
        }
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

export const allowNativeQuestions = (project, role) =>
  role === 'super' && readPolicy(project, { optional: true }).roles?.super?.allowNativeQuestions !== false;

export const claudeAuthMode = (project, role) =>
  readPolicy(project, { optional: true }).roles?.[role]?.auth ?? 'subscription';

export const claudeIdleCompaction = (project, role) =>
  readPolicy(project, { optional: true }).roles?.[role]?.claude?.idleCompaction ?? false;

export function enforceDeny(profile, deny) {
  if (deny.some(filter => matches(profile, filter))) {
    throw new CommandError('policy-denied', `Project policy denies ${profile.cli} / ${profile.model ?? '?'} / ${profile.effort ?? '?'}`);
  }
}

const workerOverrideFile = project => join(runtimeDirectory(project), 'worker-profile.json');
const preferredFor = (policy, role) => policy.roles?.[role]?.preferred ?? policy.preferred ?? [];

function parseChoice(choice, preferred) {
  if (/^[1-9]\d*$/.test(choice ?? '') && preferred[Number(choice) - 1]) {
    return { profile: preferred[Number(choice) - 1], number: Number(choice) };
  }
  const [cli, model, effort, fast, extra] = String(choice ?? '').split('/');
  if (!providers.includes(cli) || !hasText(model) || !hasText(effort) ||
      fast !== undefined && fast !== 'fast' || extra !== undefined) {
    throw new CommandError('invalid-arguments', 'Select a 1-based preferred entry or cli/model/effort[/fast]');
  }
  return { profile: { cli, model, effort, ...(fast && { fast: true }) } };
}

export function setWorkerProfile(project, choice) {
  const profile = spawnProfile(project, { role: 'worker', profileChoice: choice });
  writeState(workerOverrideFile(project), JSON.stringify({ ...profile.selected,
    ...(profile.fastRequested !== undefined && { fast: profile.fastRequested }) }) + '\n');
  return profile;
}

export function fastModeSupported(cli, model) {
  return cli === 'codex' || cli === 'claude' &&
    /^(?:claude-)?opus(?:[-.](?:5(?:[-.]5)?|4[-.]8))?(?:-\d{8})?(?:\[1m\])?$/i.test(model);
}

function checkWorkerCapacity(project, input, limit, owner, occupies = () => true) {
  const rows = projectIndex(project).query();
  const caller = input.workerCaller && rows.find(row => row.pane === input.workerCaller || row.addr === input.workerCaller);
  const parent = input.parent ? rows.find(row => row.pane === input.parent) ??
    resolveTarget(rows, input.parent, caller?.addr) : caller;
  const projects = new Set(rows.map(row => row.project));
  const name = parent?.project ?? (projects.size === 1 ? projects.values().next().value : project);
  const addr = parent?.addr ?? null;
  const active = rows.filter(row => row.role === 'worker' && row.project === name &&
    (owner?.(row.parent) ?? row.parent) === (owner?.(addr) ?? addr) && row.endedAt === null && occupies(row)).length;
  if (active >= limit) {
    throw new CommandError('worker-capacity', `Parent ${addr ?? '(none)'} in ${name} has ${active} active workers (limit ${limit}). Wait for a result or stop an active worker before spawning another.`);
  }
}

export function spawnProfile(project, input, owner, occupies) {
  const requested = Object.fromEntries([...keys, 'mode'].map(key => [key, input[key] ?? null]));
  const policy = readPolicy(project);
  const role = policy.roles?.[input.role];
  const preferred = preferredFor(policy, input.role);
  const deny = [...(policy.deny ?? []), ...(role?.deny ?? [])];
  const choice = input.profileChoice !== undefined ? parseChoice(input.profileChoice, preferred) : undefined;
  const override = input.role === 'worker' && !choice && JSON.parse(readText(workerOverrideFile(project), 'null'));
  const matching = preferred.filter(entry => matches(entry, requested));
  const matched = matching.find(entry => !deny.some(filter => matches(entry, filter))) ?? matching[0];
  const profile = choice?.profile ?? (override && matches(override, requested) ? override : matched);
  const selected = Object.fromEntries(keys.map(key => [key, choice ? profile[key] : requested[key] ?? profile?.[key]]));
  if (!keys.every(key => hasText(selected[key]))) {
    throw new CommandError('invalid-policy', 'Set matching defaults in .project/policy.json preferred (including roles.<role>.preferred), or specify --cli, --model and --effort');
  }
  enforceDeny(selected, deny);
  selected.mode = requested.mode ?? profile?.mode ?? input.defaultMode ??
    (input.role === 'worker' ? 'headless' : 'tui');
  const fastRequested = profile?.fast;
  const number = choice?.number ?? preferred.findIndex(entry => matches(entry, selected) &&
    (entry.fast ?? false) === (fastRequested ?? false)) + 1;
  const warnings = [];
  if (number > 1) warnings.push({ code: 'preferred-fallback',
    message: input.role + ' selected preferred entry ' + number + ' (' + keys.map(key => selected[key]).join('/') + ')' });
  if (fastRequested !== undefined) {
    if (!fastRequested && ['codex', 'claude'].includes(selected.cli) || fastModeSupported(selected.cli, selected.model)) selected.fast = fastRequested;
    else warnings.push({ code: 'fast-unsupported', message: selected.cli + ' / ' + selected.model + ' does not support the fast setting' });
  }
  // loomd calls this before registering the new worker, inside its serialized spawn handler.
  if (input.role === 'worker' && Object.hasOwn(input, 'workerCaller')) {
    checkWorkerCapacity(project, input, workerLimit(policy), owner, occupies);
  }
  return { requested, selected, deny, fastRequested, warnings, trustWorkspace: role?.trustWorkspace ?? true };
}

export const workerLimit = policy => policy.roles?.leader?.maxActiveWorkers ?? defaultMaxActiveWorkers;

export const toolGuardEnabled = (project, role) => ['leader', 'auditor'].includes(role) &&
  (() => {
    const policy = readPolicy(project, { optional: true });
    return policy.rotation?.mode === 'v2' || policy.roles?.[role]?.toolGuard !== false;
  })();
