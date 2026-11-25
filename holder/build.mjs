import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { holderName, manifestHeader, platforms, sha256 } from './assets.mjs';

const root = import.meta.dirname;
const [archive, officialDigest] = process.argv.slice(2);
if (process.platform !== 'darwin' || process.arch !== 'arm64' || !archive ||
    !isAbsolute(archive) || !/^[a-f\d]{64}$/.test(officialDigest ?? '') || sha256(readFileSync(archive)) !== officialDigest) {
  throw new Error('Usage on macOS arm64: node holder/build.mjs /absolute/path/to/zig.tar.xz official-sha256');
}
const stage = mkdtempSync(join(root, '.build-'));
try {
  // Use both the compiler and its bundled libc from the authenticated archive.
  const toolchain = join(stage, 'toolchain');
  mkdirSync(toolchain);
  execFileSync('/usr/bin/tar', ['-xf', archive, '-C', toolchain, '--strip-components=1']);
  const zig = join(toolchain, 'zig');
  const out = join(root, 'bin');
  mkdirSync(out, { recursive: true });
  const options = ['-Wall', '-Wextra', '-Werror', '-Os', join(root, 'holder.c'), join(root, 'sha256.c')];
  const env = { ...process.env, ZIG_GLOBAL_CACHE_DIR: join(stage, 'global'), ZIG_LOCAL_CACHE_DIR: join(stage, 'local') };
  function build(platform, command, args) {
    const path = join(stage, holderName(platform));
    execFileSync(command, [...args, ...options, '-o', path], { stdio: 'inherit', env });
  }
  build('darwin-arm64', '/usr/bin/clang', []);
  build('linux-arm64', zig, ['cc', '-target', 'aarch64-linux-musl', '-static', '-s']);
  build('linux-x64', zig, ['cc', '-target', 'x86_64-linux-musl', '-static', '-s']);
  const entries = platforms.map(platform => {
    const name = holderName(platform);
    return `${name} ${sha256(readFileSync(join(stage, name)))}`;
  });
  for (const platform of platforms) renameSync(join(stage, holderName(platform)), join(out, holderName(platform)));
  writeFileSync(join(stage, 'manifest'), [manifestHeader, ...entries, ''].join('\n'));
  renameSync(join(stage, 'manifest'), join(out, 'manifest'));
} finally {
  rmSync(stage, { recursive: true, force: true });
}
