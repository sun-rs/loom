import { chmodSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// node-pty 1.1.0's macOS npm prebuild ships its exec helper without the executable bit.
if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url);
  const packageDir = dirname(require.resolve('node-pty/package.json'));
  const helper = join(packageDir, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper');
  const metadata = statSync(helper, { throwIfNoEntry: false });
  if (metadata && !(metadata.mode & 0o100)) chmodSync(helper, (metadata.mode & 0o777) | 0o111);
}
