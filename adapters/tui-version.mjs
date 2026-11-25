import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const verifiedTuiVersions = Object.freeze({
  claude: '2.1.331',
  codex: '0.171.0',
  agy: '1.5.16',
});

const versions = {
  claude: /^(\d+\.\d+\.\d+(?:[-+][\w.-]+)?) \(Claude Code\)$/m,
  codex: /^codex-cli (\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/m,
  agy: /^(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/m,
};

export function parseTuiVersion(provider, stdout) {
  return Object.hasOwn(versions, provider) ? versions[provider].exec(stdout.trim())?.[1] : undefined;
}

export async function tuiVersionLabels(provider, command, { cwd, env } = {}) {
  if (!Object.hasOwn(verifiedTuiVersions, provider)) return {};
  let version = 'unknown';
  try {
    const { stdout } = await exec(command, ['--version'], { cwd, env, timeout: 3_000, maxBuffer: 16_384 });
    version = parseTuiVersion(provider, stdout) ?? version;
  } catch {
    // An unavailable probe must not prevent the actual launch from trying.
  }
  return {
    'loom-tui-provider': provider,
    'loom-tui-version': version,
  };
}

export function versionWarnings(labels) {
  const provider = labels?.['loom-tui-provider'];
  const version = labels?.['loom-tui-version'];
  const verified = Object.hasOwn(verifiedTuiVersions, provider) && verifiedTuiVersions[provider];
  return verified && version && verified !== version
    ? [{ code: 'UNVERIFIED_VERSION', provider, version, verified }]
    : [];
}
