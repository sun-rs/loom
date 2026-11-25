import { accessSync, constants, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

export const codexFastArgs = fast => fast === undefined ? [] : ['-c', 'service_tier="' + (fast ? 'fast' : 'default') + '"'];

function executable(path) {
  try {
    const resolved = realpathSync(path);
    if (/(?:^|[/\\])ccp(?:[/\\]|$)|claude-protected/i.test(resolved)) return;
    if (!statSync(resolved).isFile()) return;
    accessSync(resolved, constants.X_OK);
    return resolved;
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) throw error;
  }
}

export function nativeClaude() {
  const override = process.env.LOOM_CLAUDE_BIN || process.env.OAR_CLAUDE_BIN;
  if (override) {
    const binary = isAbsolute(override) && executable(override);
    if (binary) return binary;
    throw new Error('LOOM_CLAUDE_BIN must name an absolute native Claude executable');
  }
  const dir = join(homedir(), '.local/share/claude/versions');
  let versions = [];
  try { versions = readdirSync(dir).filter(name => /^\d+\.\d+\.\d+$/.test(name)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  versions.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  const candidates = [...versions.map(version => join(dir, version)),
    ...process.env.PATH?.split(delimiter).filter(isAbsolute).map(dir => join(dir, 'claude')) ?? []];
  for (const file of candidates) {
    const binary = executable(file);
    if (binary) return binary;
  }
  throw new Error('Native Claude executable not found. Set LOOM_CLAUDE_BIN to its absolute path.');
}
