import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifiedTuiVersions, versionWarnings } from '../adapters/tui-version.mjs';

const exec = promisify(execFile);

export async function withTuiVersionWarnings(result, session) {
  if (session?.backend !== 'tui' || !Object.hasOwn(verifiedTuiVersions, session.cli) || !session.pane) return result;
  try {
    const { stdout } = await exec('hc', ['get', '--json', '--', session.pane], { timeout: 1_500, maxBuffer: 256 * 1024 });
    const { address, labels } = JSON.parse(stdout);
    if (address !== session.pane || labels?.['loom-tui-provider'] !== session.cli) return result;
    const warnings = versionWarnings(labels);
    if (warnings.length) return { ...result, warnings: [...(result.warnings ?? []), ...warnings] };
  } catch {
    // The version label is optional metadata and does not affect the operation.
  }
  return result;
}
