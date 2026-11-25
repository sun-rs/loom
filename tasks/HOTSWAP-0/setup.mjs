import { execFile, execFileSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const exec = promisify(execFile);
export const hcBinary = '/Users/sun/.local/bin/hc';
const codexBinary = '/opt/homebrew/Caskroom/codex/0.171.0/bin/codex';
const npm = '/opt/homebrew/bin/npm';
export const experiment = process.env.LOOM_HOTSWAP_BASELINE === '1'
  ? '/Users/sun/Code/exp-relay/hotswap-0' : '/Users/sun/Code/exp-relay/hotswap-1';
export const repository = fileURLToPath(new URL('../..', import.meta.url));
const code = ['adapters', 'bin', 'cli', 'daemon', 'evidence', 'handover', 'inbox', 'index', 'lib', 'relay',
  'runtimes', 'schema', 'tui', 'watch', 'package.json', 'package-lock.json'];
export const previousOar = '0.130.0';

const systemPath = [dirname(process.execPath), '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
const shell = value => "'" + value.replaceAll("'", "'\\''") + "'";
const forbidden = name => /^\.(?:env|test-)/i.test(name) || /^(?:SKILL\.md|skills|auth\.json|memories.*|provider-homes)$/i.test(name);
export const mkdir = path => mkdirSync(path, { mode: 0o700, recursive: true });
export const read = path => readFileSync(path, 'utf8');
export const write = (path, content) => writeFileSync(path, content, { mode: 0o600, flush: true });

export function requireExperiment(path) {
  if (!resolve(path).startsWith(experiment + '/') || realpathSync(dirname(path)) !== dirname(path)) {
    throw new Error('Not inside the experiment workspace: ' + path);
  }
}

export function snapshot(destination, source = repository) {
  requireExperiment(destination);
  mkdir(destination);
  for (const name of code) {
    cpSync(join(source, name), join(destination, name), {
      recursive: true, filter: source => !forbidden(basename(source)) && !lstatSync(source).isSymbolicLink(),
    });
  }
}

export function replaceText(path, before, after) {
  requireExperiment(path);
  const source = read(path);
  if (source.split(before).length !== 2) throw new Error('Expected exactly one patch anchor in ' + path);
  const pending = path + '.new';
  writeFileSync(pending, source.replace(before, () => after), { mode: lstatSync(path).mode & 0o777, flush: true });
  renameSync(pending, path);
}

export function isolatedEnvironment(root, port) {
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const env = { HOME: home, CODEX_HOME: join(home, 'codex'), TMPDIR: join(root, 'tmp'), PATH: bin + ':' + systemPath,
    TERM: 'xterm-256color', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', NO_PROXY: '127.0.0.1,localhost',
    XDG_CONFIG_HOME: join(home, 'config'), XDG_STATE_HOME: join(home, 'state'), XDG_DATA_HOME: join(home, 'data'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', OAR_CODEX_BIN: join(bin, 'codex'), LOOM_CODEX_BIN: join(bin, 'codex'),
    LOOM_WAVE_WINDOW_MS: '90000', LOOM_WAVE_SEAL_MS: '60000', LOOM_DESKTOP_NOTIFY: '0' };
  for (const path of [bin, env.CODEX_HOME, env.TMPDIR, env.XDG_CONFIG_HOME, env.XDG_STATE_HOME, env.XDG_DATA_HOME]) mkdir(path);
  if (!port) return env;

  write(join(env.CODEX_HOME, 'config.toml'), [
    'model = "gpt-6.2-sol"', 'model_provider = "loopback"', 'model_reasoning_effort = "low"',
    'check_for_update_on_startup = false', 'cli_auth_credentials_store = "file"',
    'skip_model_catalog_refresh_on_startup = true',
    '[analytics]', 'enabled = false', '[feedback]', 'enabled = false',
    '[model_providers.loopback]', 'name = "HOTSWAP loopback"', 'base_url = ' + JSON.stringify(port),
    'wire_api = "responses"', 'requires_openai_auth = false', 'request_max_retries = 0', 'stream_max_retries = 0',
  ].join('\n') + '\n');
  const codexEnv = Object.entries(env).map(([key, value]) => shell(key + '=' + value)).join(' ');
  writeFileSync(join(bin, 'codex'),
    '#!/bin/sh\nexec /usr/bin/env -i ' + codexEnv +
    ' "LOOM_PROJECT=${LOOM_PROJECT-}" "LOOM_ADDR=${LOOM_ADDR-}" ' + shell(codexBinary) + ' "$@"\n', { mode: 0o700 });
  writeFileSync(join(bin, 'hc'),
    '#!/bin/sh\nexec /usr/bin/env -i ' + shell('HOME=' + homedir()) + ' ' + shell('PATH=' + systemPath) +
    ' ' + shell(hcBinary) + ' "$@"\n', { mode: 0o700 });
  return env;
}

export async function installDependencies(run, source, versions) {
  const deps = join(run, 'deps');
  mkdir(deps);
  const env = { ...isolatedEnvironment(deps), npm_config_userconfig: join(deps, 'user.npmrc'),
    npm_config_globalconfig: join(deps, 'global.npmrc'),
    npm_config_cache: join(deps, 'npm-cache'), npm_config_registry: 'https://registry.npmjs.org/' };
  const lockedOar = JSON.parse(read(join(source, 'package.json'))).dependencies['@botiverse/oar'];
  const locations = {};
  for (const version of new Set(versions)) {
    const directory = join(deps, version);
    mkdir(directory);
    for (const name of ['package.json', 'package-lock.json']) cpSync(join(source, name), join(directory, name));
    const args = version === lockedOar ? ['ci'] : ['install', '--save-exact', '@botiverse/oar@' + version];
    const result = await exec(npm, [...args, '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: directory, env, timeout: 90_000, maxBuffer: 1024 * 1024 });
    write(join(directory, 'install.log'), result.stdout + result.stderr);
    const modules = join(directory, 'node_modules');
    const actual = JSON.parse(read(join(modules, '@botiverse/oar/package.json'))).version;
    if (actual !== version) throw new Error('Unexpected OAR version ' + actual);
    const prebuilds = join(modules, 'node-pty', 'prebuilds');
    for (const name of readdirSync(prebuilds).filter(name => name.startsWith('darwin-'))) {
      const helper = join(prebuilds, name, 'spawn-helper');
      execFileSync('/bin/chmod', ['u+x', helper]);
    }
    locations[version] = modules;
  }
  return locations;
}
