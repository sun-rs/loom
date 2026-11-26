import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import pty from 'node-pty';
import xterm from '@xterm/headless';
import { base, prepare } from './fixtures.mjs';
import { profile } from './launch.mjs';

const sandbox = '/usr/bin/sandbox-exec';
const here = fileURLToPath(new URL('.', import.meta.url));
const root = mkdtempSync('/private/tmp/loom-ab-preflight-');
const arms = process.argv.slice(2);
const quote = value => JSON.stringify(value);

async function probe(arm) {
  assert.match(arm, /^[CX][012]$/);
  const directory = join(root, arm);
  mkdirSync(directory, { mode: 0o700 });
  const cwd = prepare(join(directory, 'work'), 'survey');
  const [home, data, tmp, logs] = ['home', 'data', 'tmp', 'logs'].map(name => join(directory, name));
  for (const dir of [home, data, tmp, logs]) mkdirSync(dir, { mode: 0o700 });
  const { vendor, binary, version, model, args, env: flags } = profile(arm, cwd, logs);
  const env = {
    PATH: '/opt/homebrew/bin:/usr/bin:/bin', TERM: 'xterm-256color', HOME: home, TMPDIR: tmp,
    XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: data, XDG_STATE_HOME: join(home, 'state'),
    XDG_CACHE_HOME: join(home, 'cache'), DISABLE_AUTOUPDATER: '1', LOOM_HERDR_LAYOUT: '0',
    ...(vendor === 'claude' ? { CLAUDE_CONFIG_DIR: data } : { CODEX_HOME: data, RUST_LOG: 'trace' }),
    ...flags,
  };
  const binaryAccess = vendor === 'claude' ? `(literal ${quote(binary)})` : `(subpath ${quote(dirname(binary))})`;
  const seatbelt = `(version 1)
(allow default)
(deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.securityd.xpc")
                  (global-name "com.apple.security.agent") (global-name "com.apple.SecurityServer"))
(deny file-read* (subpath "/Users/sun") (subpath "/Library/Keychains")
                 (subpath "/System/Library/Keychains") (subpath "/Library/Application Support/ClaudeCode"))
(allow file-read* ${binaryAccess})
(deny file-write*)
(allow file-write* (subpath ${quote(directory)}) (literal "/dev/null")
                   (regex #"^/dev/ttys[0-9]+$"))`;
  let authStatus = null;
  if (vendor === 'codex') {
    const check = spawnSync(sandbox, ['-p', seatbelt, binary, '-c', 'cli_auth_credentials_store="file"', 'login', 'status'],
      { cwd, env, timeout: 5_000, encoding: 'utf8' });
    authStatus = /not logged in/i.test(check.stdout + check.stderr) ? 'not-logged-in' : 'unclassified';
  }
  const t = new xterm.Terminal({ cols: 110, rows: 36, allowProposedApi: true });
  const started = performance.now();
  const pane = pty.spawn(sandbox, ['-p', seatbelt, binary, ...args], { cwd, env, cols: 110, rows: 36 });
  let exit;
  pane.onExit(receipt => { exit = receipt; });
  pane.onData(data => t.write(data));
  t.onData(data => { if (!exit) pane.write(data); });
  const setup = [];
  let state = 'startup-timeout';
  try {
    for (let tick = 0; tick < 70; tick++) {
      await delay(200);
      const screen = Array.from({ length: t.rows }, (_, line) =>
        t.buffer.active.getLine(t.buffer.active.viewportY + line)?.translateToString(true) ?? '').join('\n');
      if (/select login method|login method|sign in with chatgpt|claude account with subscription|log in to claude|claude console account/i.test(screen)) {
        state = 'login-required';
        break;
      }
      if (/choose the text style|choose a theme|choose a color theme/i.test(screen) && !setup.includes('default-theme')) {
        pane.write('\r');
        setup.push('default-theme');
      }
      if (/do you trust|trust this folder/i.test(screen) && !setup.includes('workspace-trust')) {
        pane.write('\r');
        setup.push('workspace-trust');
      }
      if (/enable code mode|code mode.*experimental/i.test(screen) && /confirm|continue|enable/i.test(screen)) {
        state = 'code-mode-consent';
        break;
      }
      if (exit) {
        if (/unable to connect to anthropic services|failed to connect to api\.anthropic\.com/i.test(screen)) {
          state = 'provider-connectivity-failure';
        } else {
          state = /operation not permitted|sandbox/i.test(screen) ? 'sandbox-startup-failure' : 'process-exited';
        }
        break;
      }
    }
  } finally {
    if (!exit) pane.kill();
    for (let tick = 0; !exit && tick < 25; tick++) await delay(40);
    if (!exit) pane.kill('SIGKILL');
    t.dispose();
  }
  return {
    arm, kind: 'startup-preflight', base, date: new Date().toISOString(), vendor,
    version, modelRequested: model, modelObserved: null,
    task: null, state, authStatus, setup, exitCode: exit?.exitCode ?? null,
    taskSubmitted: false, codeModeConsentAccepted: false,
    taskHumanInterventions: 0, startupWallMs: Math.round(performance.now() - started), taskWallMs: null,
    modelRequests: null, inputTokens: null, cachedTokens: null, outputTokens: null, peakContextTokens: null,
    toolCalls: null, replCalls: null, scriptCalls: null, checker: null, generatedScriptAudit: 'no-task-submitted',
  };
}

await Promise.all(arms.map(async arm => {
  const result = await probe(arm);
  writeFileSync(join(here, 'runs', `preflight-${arm}.json`), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ arm, state: result.state, authStatus: result.authStatus, setup: result.setup }));
}));
