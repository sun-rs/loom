import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import pty from 'node-pty';
import xterm from '@xterm/headless';
import { profile } from './launch.mjs';

const root = mkdtempSync('/private/tmp/loom-c1-');
const { binary, version, model, args, env: flags } = profile('C1', root, root);
const env = { ...process.env, ...flags, HOME: homedir(), TMPDIR: root, DISABLE_AUTOUPDATER: '1', TERM: 'xterm-256color' };
for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'HC_TERMINAL_ID']) delete env[key];
const routed = ['ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']
  .filter(name => Boolean(env[name]));
const login = spawnSync(binary, ['auth', 'status'], { env, cwd: root, encoding: 'utf8', timeout: 7000 });
const loginData = JSON.parse(login.stdout);
const auth = { signedIn: loginData.loggedIn === true, directSubscription: loginData.authMethod === 'claude.ai' &&
  loginData.apiProvider === 'firstParty', routingOverrides: routed };
const actual = spawnSync(binary, ['--version'], { env, cwd: root, encoding: 'utf8', timeout: 7000 }).stdout.match(/\d+\.\d+\.\d+/)?.[0];
if (actual !== version) throw new Error('Claude version differs from the trial plan');
const cwd = process.argv[2] ?? root;
const nativeConsent = process.argv.includes('--native-consent');
const standardFiles = ['.claude.json', '.claude/settings.json', '.codex/config.toml'];
const fingerprint = () => standardFiles.map(file => {
  const stat = lstatSync(join(env.HOME, file), { throwIfNoEntry: false });
  return stat ? `${stat.ino}:${stat.size}:${stat.mtimeMs}` : null;
});
const initial = fingerprint();
const config = (nativeConsent ? standardFiles.slice(1) : standardFiles)
  .map(path => `(literal ${JSON.stringify(join(env.HOME, path))})`).join(' ');
const sandbox = `(version 1)(allow default)(deny file-write* ${config})`;
const launch = [...args, '--strict-mcp-config', '--dangerously-skip-permissions', '--settings',
  '{"skipDangerousModePermissionPrompt":true}'];
const pane = pty.spawn('/usr/bin/sandbox-exec', ['-p', sandbox, binary, ...launch], { cwd, env, cols: 130, rows: 40 });
const terminal = new xterm.Terminal({ cols: 130, rows: 40, allowProposedApi: true });
const observations = new Set();
let visibleChoices = [];
let blockingBanner, atConsent;
let exited, code = 'not-observed', trustSelection = 0, consentSelection = 0, accepted = false;
pane.onExit(event => { exited = event; });
pane.onData(data => terminal.write(data));
terminal.onData(data => { if (!exited) pane.write(data); });
try {
  for (let i = 0; i < 100 && !exited; i++) {
    await delay(200);
    const buffer = terminal.buffer.active;
    const lines = Array.from({ length: terminal.rows }, (_, row) =>
      buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '');
    const screen = lines.join('\n');
    const choices = lines.map(line => line.trim()).filter(line =>
      /^(?:[❯›>]\s*)?(?:(?:\d[.)]\s*)?(?:No,? |Yes,? |Exit|Continue|Code Mode \(experimental\)))/i.test(line) &&
      !/(?:token|key|account|https?:)/i.test(line));
    if (choices.length) visibleChoices = choices.slice(0, 8);
    if (/Code Mode \(experimental\) is on|this session can be resumed only with Code Mode on/i.test(screen)) {
      code = 'enabled-banner';
      break;
    }
    const unavailable = lines.find(line => /Code Mode \(experimental\) isn.t available/i.test(line));
    if (unavailable) {
      const diagnostic = screen.replace(/\s+/g, ' ');
      blockingBanner = unavailable.match(/Code Mode \(experimental\) isn.t available[^\n]*/i)?.[0].trim()
        .split(/\s{2,}|[│┃]/)[0].slice(0, 195);
      if (blockingBanner && /(?:https?:|@|bearer|sk-[\w-]{8,})/i.test(blockingBanner)) blockingBanner = 'redacted banner';
      if (accepted && /couldn.t save your answer/i.test(diagnostic)) {
        code = 'consent-write-denied';
        break;
      }
    }
    for (const [kind, pattern] of [
      ['gateway', /isn.t offered yet through a gateway or proxy/i],
      ['model-unsupported', /(?:Code Mode[^\n]*model[^\n]*isn.t|doesn.t support Code Mode|isn.t available with this model)/i],
      ['settings-unavailable', /it needs settings that Claude Code downloads/i],
      ['account-ineligible', /it isn.t open to your account yet/i],
      ['unavailable-banner', /Code Mode \(experimental\) isn.t available/i],
      ['settings-write-error', /(?:\.claude\.json|config)[:\s].*(?:Operation not permitted|permission denied)|failed to save config/i],
    ]) if (pattern.test(screen)) observations.add(kind);
    if (/Quick safety check:/i.test(screen) && /Yes, I trust this folder/i.test(screen)) {
      observations.add('workspace-trust');
      if (nativeConsent) { code = 'requires-workspace-trust'; break; }
      if (!screen.includes(cwd)) { code = 'different-workspace'; break; }
      if (i >= 5 && i % 5 === 0 && trustSelection < 3 && /[❯›>]\s*No, exit/i.test(screen)) {
        pane.write(trustSelection++ === 1 ? '\x1bOB' : '\x1b[B');
        observations.add('moved-workspace-selection');
      } else if (/[❯›>]\s*Yes, I trust this folder/i.test(screen)) {
        pane.write('\r');
        observations.add('ephemeral-workspace-confirmed');
      }
      continue;
    }
    if (screen.includes('Yes, turn on Code Mode')) {
      observations.add('code-mode-consent');
      const yes = lines.findIndex(line => /Yes, turn on Code Mode/i.test(line));
      const no = lines.findIndex(line => /[❯›>]\s*(?:\d[.)]\s*)?No[,\s]/i.test(line));
      if (!accepted && /[❯›>]\s*(?:\d[.)]\s*)?Yes, turn on Code Mode/i.test(lines[yes])) {
        atConsent = fingerprint();
        pane.write('\r');
        accepted = true;
      } else if (i % 5 === 0 && consentSelection++ < 3 && no >= 0) {
        pane.write(yes < no ? '\x1b[A' : '\x1b[B');
        observations.add('moved-consent-selection');
      }
    } else if (/\? for shortcuts|bypass permissions on/i.test(screen)) {
      observations.add('ordinary-composer');
    }
  }
} finally {
  if (!exited) pane.kill();
  for (let i = 0; !exited && i < 20; i++) await delay(50);
  if (!exited) pane.kill('SIGKILL');
  terminal.dispose();
}
const after = fingerprint();
const record = { date: new Date().toISOString(), version, model, auth, nativeConsent, code, accepted, noTaskSubmitted: true,
  observations: [...observations], visibleChoices, blockingBanner,
  changedBeforeConsent: atConsent ? standardFiles.filter((_file, index) => atConsent[index] !== initial[index]) : [],
  changedFiles: standardFiles.filter((_file, index) => after[index] !== initial[index]) };
const receipts = fileURLToPath(new URL('./runs/', import.meta.url));
const suffix = nativeConsent ? 'native' : 'guarded';
writeFileSync(join(receipts, 'c1-activation-' + suffix + '.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(record));
