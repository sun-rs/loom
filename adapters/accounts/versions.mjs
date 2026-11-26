// Recorded refresh and passive fixtures are the allowlist for verified versions.
const supported = {
  codex: new Set(['0.171.0', '0.172.0']),
  claude: new Set(['2.1.331']),
  agy: new Set(['1.5.17', '1.5.18']),
  opencode: new Set(['2.3.0']),
};

export const accountVersion = value => typeof value === 'string' &&
  /^v?\d{1,8}\.\d{1,8}\.\d{1,8}(?:-[a-z0-9.-]{1,48})?(?:\+[a-z0-9.-]{1,48})?$/i.test(value) ? value : null;
export const verifiedAccountVersion = (cli, value) => supported[cli]?.has(accountVersion(value)?.replace(/^v/i, '')) ?? false;
