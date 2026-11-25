import { createHash } from 'node:crypto';
import { accessSync, constants, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const manifestHeader = 'LOOM-HOLDER 3 1';
export const pipeManifestHeader = 'LOOM-HOLDER PIPES 1';
export const platforms = ['darwin-arm64', 'linux-arm64', 'linux-x64'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const holderName = platform => `loom-holder-${platform}`;

export function holderAssets(root) {
  const bin = join(root, 'holder', 'bin');
  if (realpathSync(bin) !== bin) throw new Error('Holder bin must be release-local');
  const manifest = join(bin, 'manifest');
  if (!lstatSync(manifest).isFile()) throw new Error('Invalid holder manifest');
  const [header, ...rows] = readFileSync(manifest, 'utf8').trimEnd().split('\n');
  if (header !== manifestHeader || rows.length !== platforms.length) throw new Error('Incompatible holder manifest');
  return Object.fromEntries(platforms.map((platform, i) => {
    const name = holderName(platform);
    const [file, digest, ...extra] = rows[i].split(' ');
    const path = join(bin, name);
    if (file !== name || !/^[a-f\d]{64}$/.test(digest) || extra.length) throw new Error('Invalid holder manifest entry');
    const stat = lstatSync(path);
    if (!stat.isFile() || !(stat.mode & 0o100) || stat.size <= 0 || stat.size > 4 * 1024 * 1024 ||
        sha256(readFileSync(path)) !== digest) throw new Error(`Holder digest or mode mismatch: ${name}`);
    return [platform, { name, path, digest }];
  }));
}

export function holderAsset(root) {
  const asset = holderAssets(root)[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error('Unsupported holder OS and architecture');
  accessSync(asset.path, constants.X_OK);
  return asset;
}

export async function checkHolder(root, { pipes = false } = {}) {
  const asset = holderAsset(root);
  const header = pipes ? pipeManifestHeader : manifestHeader;
  if (pipes) {
    const stamp = join(root, 'holder', 'bin', 'pipes');
    const base = readFileSync(join(root, 'holder', 'bin', 'manifest'), 'utf8');
    if (!lstatSync(stamp, { throwIfNoEntry: false })?.isFile() ||
        readFileSync(stamp, 'utf8') !== base.replace(manifestHeader, header)) {
      throw new Error('Release does not advertise this pipe holder');
    }
  }
  const { stdout } = await exec(asset.path, [pipes ? '--self-check-pipes' : '--self-check'], { timeout: 5000, maxBuffer: 256 });
  if (stdout !== `${header}\n${asset.name}\n`) throw new Error('Holder self-check mismatch');
  return asset;
}
