const defaults = {
  mode: 'explicit',
  cards: 10, subsystems: 4, compactions: 5, singleMainlineCards: 20, auditReturns: 3, corrections: 3,
  protectedRefs: [], verifyTimeoutMs: 30 * 60_000, firstReportTimeoutMs: 30 * 60_000,
  passiveBlockMs: 30 * 60_000, longIdleMs: 60 * 60_000,
  highWaterTokens: { claude: 675_000, codex: 210_000, agy: 420_000 },
  densityRequiresCompaction: false,
  subsystemPrefixes: {},
};

export function rotationSettings(policy) {
  return { ...defaults, ...policy.rotation, highWaterTokens: { ...defaults.highWaterTokens, ...policy.rotation?.highWaterTokens } };
}

export function validateRotation(config) {
  if (config === undefined) return;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const integer = value => Number.isSafeInteger(value) && value > 0;
  const clis = ['claude', 'agy', 'codex', 'opencode'];
  if (!object(config) || Object.entries(config).some(([name, value]) => {
    if (name === 'protectedRefs') return !Array.isArray(value) || new Set(value).size !== value.length ||
      value.some(ref => typeof ref !== 'string' || !/^refs\/heads\/[A-Za-z0-9_/-]+(?:\.[A-Za-z0-9_/-]+)*$/.test(ref));
    if (name === 'mode') return !['v2', 'explicit'].includes(value);
    if (name === 'subsystemPrefixes') return !object(value) || Object.entries(value).some(([prefix, subsystem]) =>
      !/^[\w.-]+(?:\/[\w.-]+)*$/.test(prefix) || typeof subsystem !== 'string' || !subsystem.trim());
    if (name === 'densityRequiresCompaction') return typeof value !== 'boolean';
    if (name === 'highWaterTokens') {
      return !object(value) || Object.entries(value).some(([cli, limit]) => !clis.includes(cli) || limit !== null && !integer(limit));
    }
    return !Object.hasOwn(defaults, name) || !integer(value);
  })) throw new Error('Invalid rotation policy configuration');
}
