import { isAbsolute } from 'node:path';

export const workerTiers = Object.freeze(['sandbox', 'integration', 'host']);
export const tierTarget = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function tierError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function requestedWorkerTier({ tier, integration }) {
  if (tier !== undefined && !workerTiers.includes(tier) ||
      integration && tier !== undefined && tier !== 'integration') {
    throw tierError('invalid-arguments', '--tier must be sandbox, integration or host. --integration is an alias for --tier integration.');
  }
  return tier ?? (integration ? 'integration' : 'sandbox');
}

export const storedWorkerTier = job => job?.workerTier ?? requestedWorkerTier({ integration: job?.integration });

export function hostGrantSpec({ target, tier, reason, ttl, uses = '1', write = [], wave = false, request = false }) {
  const duration = typeof ttl !== 'string' ? null : /^([1-9]\d*)([smh]?)$/.exec(ttl);
  const ttlMs = duration && Number(duration[1]) * ({ s: 1000, m: 60_000, h: 3_600_000 }[duration[2]] ?? 1000);
  const count = typeof uses === 'string' && /^[1-9]\d*$/.test(uses) ? Number(uses) : NaN;
  const safeText = value => typeof value === 'string' && value.trim() && !/[\x00-\x1f\x7f-\x9f]/.test(value);
  if (tier !== 'host' || typeof target !== 'string' || !tierTarget.test(target) || !safeText(reason) || reason.length > 512 ||
      ttl !== undefined && (typeof ttl !== 'string' || !Number.isSafeInteger(ttlMs)) ||
      !Number.isSafeInteger(count) || typeof wave !== 'boolean' || typeof request !== 'boolean' || !Array.isArray(write) ||
      write.some(path => !safeText(path) || !isAbsolute(path)) || wave && write.length) {
    throw tierError('invalid-arguments', 'Grant requires a task or wave, host, a reason, a positive use limit and TTL, and absolute task write paths.');
  }
  return { target, tier, reason: reason.trim(), uses: count, ...(ttlMs != null && { ttlMs }), write: [...new Set(write)], wave, request };
}
