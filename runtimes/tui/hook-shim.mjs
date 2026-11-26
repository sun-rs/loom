// Installed in .project/loomd. Keep the native hook arguments intact.
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

try {
  let root = process.env.LOOM_HOOK_RELEASE;
  let fd;
  try {
    fd = openSync(new URL('./release.json', import.meta.url),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) throw new Error('Expected the Loom release pointer');
    root = JSON.parse(readFileSync(fd, 'utf8')).current?.root ?? root;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (typeof root === 'string' && isAbsolute(root)) {
    await import(pathToFileURL(join(root, 'runtimes/tui/capture-hook.mjs')).href);
  }
} catch {
  // Observation must leave the CLI running even when the release is unavailable.
}
