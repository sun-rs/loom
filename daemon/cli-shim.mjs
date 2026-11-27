import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

function metadata(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) throw new Error('Expected Loom release metadata');
    return JSON.parse(readFileSync(fd, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const [, , dir, fallback, ...args] = process.argv;
const active = metadata(join(dir, 'release.json'));
const upgrade = metadata(join(dir, 'upgrade.json'));
const release = upgrade?.phase === 'switching' && active?.upgradeId === upgrade.id ? upgrade.current : active?.current;
const root = release?.root ?? fallback;
if (!isAbsolute(root)) throw new Error('Invalid active Loom release');
const node = release?.nodeRuntime?.path;
if (node && node !== process.execPath) {
  if (!isAbsolute(node)) throw new Error('Invalid active Loom Node path');
  process.execve(node, [node, ...process.argv.slice(1)], process.env);
}
const { main } = await import(pathToFileURL(join(root, 'cli', 'loom.mjs')).href);
process.exitCode = await main(args);
