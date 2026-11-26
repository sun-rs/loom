import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedVersion, smokePrompts } from '../adapters/prompt-smoke.mjs';
import { parseTuiVersion } from '../adapters/tui-version.mjs';
import { nativeClaude } from '../daemon/executables.mjs';
import { readText, writeState } from '../daemon/io.mjs';
import { absoluteCommand } from '../runtimes/tui/transport.mjs';
import { runtimeDirectory } from './project.mjs';

export async function promptDoctor(project, { changedOnly = false } = {}) {
  const directory = runtimeDirectory(project);
  const path = join(directory, 'prompt-smoke.json');
  const previous = JSON.parse(readText(path, '{}'));
  const root = await mkdtemp(join(await realpath(tmpdir()), 'lp-'));
  const warnings = [];
  try {
    const providers = await Promise.all(['claude', 'codex', 'agy', 'opencode'].map(async cli => {
      const fixture = join(root, cli);
      await mkdir(fixture, { mode: 0o700 });
      let binary;
      try { binary = cli === 'claude' ? nativeClaude() : await absoluteCommand(cli); }
      catch { return { cli, status: 'unavailable' }; }
      let version;
      try {
        const { stdout } = await isolatedVersion(binary, fixture);
        version = parseTuiVersion(cli, stdout);
      } catch { /* The binary exists but could not report its version. */ }
      if (!version) return { cli, status: 'unavailable', binary, reason: 'Installed CLI did not report a recognised version' };
      const prior = previous[cli];
      if (changedOnly && prior?.version === version && prior.binary === binary) return { ...prior, cached: true };
      try {
        return { cli, version, binary, status: 'passed', ...await smokePrompts(cli, binary, fixture) };
      } catch (error) {
        const reason = error.code === 'EPERM' || error.code === 'EACCES' ? 'sandbox-limited: cannot open a local smoke-test PTY or socket' : error.message;
        return { cli, version, binary, status: 'failed', reason };
      }
    }));
    for (const item of providers) {
      const old = previous[item.cli]?.version;
      if (changedOnly && item.version && old !== item.version) warnings.push(
        `${item.cli} ${item.version}${old ? ` (was ${old})` : ''}: prompt smoke ${item.status}.`);
      if (item.reason) warnings.push(`${item.cli}: ${item.reason}.`);
    }
    if (providers.some(item => !item.cached && item.version)) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      writeState(path, JSON.stringify({ ...previous, ...Object.fromEntries(providers.filter(item => item.version && !item.cached)
        .map(item => [item.cli, item])) }) + '\n');
    }
    return { ok: !providers.some(item => item.reason), providers, warnings };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
