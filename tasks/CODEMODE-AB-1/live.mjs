import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import pty from 'node-pty';
import xterm from '@xterm/headless';
import { parseClaude } from '../../adapters/claude/parse.mjs';
import { parseCodex } from '../../adapters/codex/parse.mjs';
import { codexHookArgs } from '../../adapters/codex/launch.mjs';
import { collectRun, prepareRun } from './run-results.mjs';
import { nativeMetrics } from './metrics.mjs';
import { openClaudeShell } from './claude-shell.mjs';

const taskDir = fileURLToPath(new URL('.', import.meta.url));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const sessionIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const hook = `import { appendFileSync } from 'node:fs';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const row = JSON.parse(Buffer.concat(chunks).toString());
const { cwd, session_id, transcript_path, hook_event_name } = row;
appendFileSync(process.argv[2], JSON.stringify({ cwd, session_id, transcript_path, hook_event_name, at: new Date().toISOString() }) + '\\n', { mode: 0o600 });`;

const posixQuote = text => "'" + text.replaceAll("'", "'\\''") + "'";

function logRows(path) {
  if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) return [];
  const text = readFileSync(path, 'utf8');
  return text.slice(0, text.lastIndexOf('\n') + 1).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function transcript(hooks, plan, env, expectedClaudeId) {
  const claude = plan.arm.startsWith('C');
  const store = claude ? join(env.CLAUDE_CONFIG_DIR || env.HOME, env.CLAUDE_CONFIG_DIR ?
    'projects' : '.claude/projects') : join(env.CODEX_HOME || env.HOME, env.CODEX_HOME ? 'sessions' : '.codex/sessions');
  const event = hooks.findLast(row => row.cwd === plan.cwd && sessionIdPattern.test(row.session_id) &&
    (!claude || row.session_id === expectedClaudeId) && typeof row.transcript_path === 'string');
  const candidate = event?.transcript_path ?? (claude ? join(store, plan.cwd.replace(/[^a-z0-9]/gi, '-'), expectedClaudeId + '.jsonl') : '');
  if (!candidate || !isAbsolute(candidate) || !basename(candidate).endsWith(`${event?.session_id ?? expectedClaudeId}.jsonl`) ||
      !candidate.startsWith(store + '/') || !lstatSync(candidate, { throwIfNoEntry: false })?.isFile() ||
      realpathSync(candidate) !== candidate) return;
  const text = readFileSync(candidate, 'utf8');
  if (!text.includes(plan.cwd) || !text.includes(plan.prompt)) return;
  return text;
}

function setupFingerprint(home) {
  return Object.fromEntries(['.claude.json', '.claude/settings.json', '.codex/config.toml'].map(path => {
    const file = lstatSync(join(home, path), { throwIfNoEntry: false });
    return [path, file ? [file.ino, file.size, file.mtimeMs] : null];
  }));
}

function changedSetup(before, after) {
  return Object.keys(before).filter(path => JSON.stringify(before[path]) !== JSON.stringify(after[path]));
}

function auditScripts(vendor, text, plan) {
  const rows = text.trim().split('\n').map(line => JSON.parse(line));
  const candidates = [];
  const seen = new Set();
  for (const row of rows) {
    const calls = vendor === 'claude' && row.type === 'assistant' ? row.message.content :
      vendor === 'codex' && row.type === 'response_item' ? [row.payload] : [];
    for (const call of calls ?? []) {
      if (!['tool_use', 'function_call', 'custom_tool_call'].includes(call.type)) continue;
      const id = call.call_id ?? call.id;
      if (seen.has(id)) continue;
      seen.add(id);
      if (['Bash', 'REPL', 'exec', 'exec_command', 'shell_command', 'apply_patch'].includes(call.name)) {
        candidates.push({ tool: call.name, input: call.input ?? call.arguments });
      }
    }
  }
  save(join(plan.directory, 'script-audit-inputs.json'), candidates);
  const outsideWorkingCopy = candidates.filter(call => {
    const input = JSON.stringify(call.input);
    return /(?:\/Users\/|\/private\/tmp\/loom-ab-run-|\/Volumes\/)/.test(input.replaceAll(plan.cwd, 'WORK')) ||
      /(?:~\/|\.\.\/(?:\.\.\/)*\.(?:codex|claude|env|ssh))/.test(input);
  }).length;
  return { checked: Math.max(candidates.length, nativeMetrics(vendor, text).scriptCalls ?? 0), outsideWorkingCopy };
}

async function run(arm, task, repetition) {
  const plan = prepareRun(arm, task, repetition);
  const { vendor, binary, version, args, env: flags } = plan.launch;
  const claude = vendor === 'claude';
  const temporary = join(plan.directory, 'tmp');
  mkdirSync(temporary, { mode: 0o700 });
  const env = { ...process.env, HOME: homedir(), PATH: '/opt/homebrew/bin:/usr/bin:/bin', TERM: 'xterm-256color',
    TMPDIR: temporary, DISABLE_AUTOUPDATER: '1', ...flags };
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'LOOM_ADDR', 'LOOM_PROJECT', 'HC_TERMINAL_ID']) delete env[key];
  if (arm === 'C0') delete env.CLAUDE_CODE_EXPERIMENTAL_CODE_MODE;
  const actualVersion = execFileSync(binary, ['--version'], { cwd: plan.cwd, env, encoding: 'utf8' }).match(/\d+\.\d+\.\d+/)?.[0];
  if (actualVersion !== version) throw new Error('native-version-mismatch');
  const hookFile = join(plan.directory, 'capture.mjs');
  const hookSink = join(plan.directory, 'hooks.jsonl');
  writeFileSync(hookFile, hook, { mode: 0o600 });
  const words = [process.execPath, hookFile, hookSink];
  const id = randomUUID();
  const sessionEvents = ['SessionStart', 'UserPromptSubmit', 'Stop', 'StopFailure'];
  const settings = {
    skipDangerousModePermissionPrompt: true,
    permissions: { blockReadsOutsideWorkingDirectories: true, blockWritesOutsideWorkingDirectories: true,
      denyInsteadOfPrompting: true },
    sandbox: { enabled: false },
    hooks: Object.fromEntries(sessionEvents.map(event => [event, [{ hooks: [{
      type: 'command', command: words.map(posixQuote).join(' '), timeout: 5,
    }] }]])),
  };
  const argv = claude ? [...args, '--session-id', id, '--strict-mcp-config',
    '--dangerously-skip-permissions', '--disallowedTools', 'AskUserQuestion',
    '--settings', JSON.stringify(settings)] :
    [...args, '--cd', plan.cwd, '--no-daemon', '--no-alt-screen', '--ask-for-approval', 'never', '-c', 'check_for_update_on_startup=false',
      '-c', 'web_search="disabled"', '-c', 'default_permissions="bench"',
      '-c', 'shell_environment_policy.set.PATH="/opt/homebrew/bin:/usr/bin:/bin"',
      '-c', `permissions.bench.filesystem={":minimal"="read","/opt/homebrew/bin"="read","/opt/homebrew/Cellar"="read",${JSON.stringify(plan.cwd)}="write",${JSON.stringify(temporary)}="write"}`,
      ...codexHookArgs(words, { SessionStart: 'session_start', UserPromptSubmit: 'user_prompt_submit', Stop: 'stop' })];
  const before = setupFingerprint(env.HOME);
  const started = new Date().toISOString();
  const shell = claude ? await openClaudeShell(plan, temporary, env.HOME) : undefined;
  if (shell) env.CLAUDE_CODE_SHELL = shell.executable;
  const configPaths = ['.claude.json', '.claude/settings.json', '.codex/config.toml'].map(path =>
    `(literal ${JSON.stringify(join(env.HOME, path))})`).join(' ');
  const seatbelt = `(version 1) (allow default) (deny file-write* ${configPaths})`;
  const launchArgs = [...argv, '--', plan.prompt];
  const pane = pty.spawn(claude ? '/usr/bin/sandbox-exec' : binary,
    claude ? ['-p', seatbelt, binary, ...launchArgs] : launchArgs,
    { cwd: plan.cwd, env, cols: 140, rows: 40 });
  const terminal = new xterm.Terminal({ cols: 140, rows: 40, allowProposedApi: true });
  let exited;
  let consent = arm === 'C1' ? 'previously-accepted' : 'not-applicable';
  let consentFiles = [];
  let trust = false;
  let movedTrustChoice = 0;
  let movedConsentChoice = false;
  pane.onExit(event => { exited = event; });
  pane.onData(data => terminal.write(data));
  terminal.onData(data => { if (!exited) pane.write(data); });
  const status = new Set();
  try {
    for (let i = 0; i < 750; i++) {
      await delay(400);
      const hooks = logRows(hookSink);
      const text = transcript(hooks, plan, env, id);
      if (text) {
        status.add('transcript');
        const parsed = (claude ? parseClaude : parseCodex)(text);
        const turn = parsed.turns.at(-1);
        const stop = hooks.findLast(row => row.hook_event_name === 'Stop');
        if (turn?.status === 'completed' && turn.reply && stop) {
          const metadata = {
            cliVersion: actualVersion, startedAt: hooks.find(row => row.hook_event_name === 'UserPromptSubmit')?.at ?? started,
            finishedAt: stop.at, humanInterventions: 0, codeModeConsent: consent,
            scriptAudit: auditScripts(vendor, text, plan),
          };
          writeFileSync(plan.nativeTranscript, text, { mode: 0o600, flag: 'wx' });
          save(plan.metadata, metadata);
          const result = { ...collectRun(plan, metadata, text), consentFiles, workspaceTrustSetup: trust,
            codeModeBanner: status.has('code-mode-enabled'), changedGlobalConfigFiles: changedSetup(before, setupFingerprint(env.HOME)) };
          if (arm === 'C1' && !result.codeModeBanner && result.replCalls === 0) throw new Error('code-mode-unverified');
          const output = `run-${arm}-${task}-${repetition}.json`;
          save(join(taskDir, 'runs', output), result);
          return { arm, task, repetition, state: 'recorded', checker: result.checker, wallMs: result.wallMs,
            modelRequests: result.modelRequests, toolCalls: result.toolCalls, scriptAudit: result.scriptAudit, runDir: plan.directory };
        }
      }
      const buffer = terminal.buffer.active;
      const screen = Array.from({ length: terminal.rows }, (_, line) =>
        buffer.getLine(buffer.viewportY + line)?.translateToString(true) ?? '').join('\n');
      if (/Code Mode \(experimental\) is on|this session can be resumed only with Code Mode on/i.test(screen)) {
        status.add('code-mode-enabled');
      }
      if (i % 5 === 0 || exited) {
        const display = screen.split('\n').map(row => row.trim()).filter(row =>
          /^(?:error:|warning:|quick safety check:|accessing workspace:|welcome(?: to)?|code mode|yes, turn on|sandbox-exec:|.*trust this (?:directory|folder))/i.test(row) &&
          !/(?:token|credential|password|api key|http|authorization)/i.test(row)).slice(0, 8);
        writeFileSync(join(plan.directory, 'progress.json'), JSON.stringify({ arm, hookEvents: hooks.map(row => row.hook_event_name),
          nativeTranscript: Boolean(text), nonemptyLines: screen.split('\n').filter(row => row.trim()).length, display,
          flags: [...status] }), { mode: 0o600 });
      }
      if (/select login method|choose how to log in|sign in with chatgpt|log in to claude/i.test(screen)) throw new Error('login-required');
      if (!trust && i >= 5 && i % 5 === 0 && /Quick safety check:/i.test(screen) && screen.includes(plan.cwd) &&
          /[❯>]\s*No, exit/i.test(screen) && /Yes, I trust this folder/i.test(screen) && movedTrustChoice < 3) {
        pane.write(movedTrustChoice++ === 1 ? '\x1bOB' : '\x1b[B');
      }
      if (!trust && /Quick safety check:/i.test(screen) && screen.includes(plan.cwd) &&
          /[❯>]\s*Yes, I trust this folder/i.test(screen)) {
        pane.write('\r');
        trust = true;
      }
      if (arm === 'C1' && consent !== 'accepted' && /Code Mode \(experimental\)/i.test(screen)) {
        const choices = screen.split('\n');
        const yes = choices.findIndex(line => /Yes, turn on Code Mode/i.test(line));
        const no = choices.findIndex(line => /[❯›>]\s*(?:\d[.)]\s*)?No[,\s]/i.test(line));
        if (yes >= 0 && no >= 0 && !movedConsentChoice) {
          pane.write(yes < no ? '\x1b[A' : '\x1b[B');
          movedConsentChoice = true;
        }
        if (yes >= 0 && /[❯›>]\s*(?:\d[.)]\s*)?Yes, turn on Code Mode/i.test(choices[yes])) {
          pane.write('\r');
          consent = 'accepted';
          await delay(500);
          consentFiles = changedSetup(before, setupFingerprint(env.HOME));
          status.add('code-mode-consent');
        }
      }
      if (/you.ve hit your limit|out of extra usage|rate limit reached|rate limit exceeded/i.test(screen)) throw new Error('provider-limit');
      if (/error: unexpected argument|error: invalid value|failed to load configuration|cannot be used with/i.test(screen)) {
        throw new Error('native-launch-config-error');
      }
      if (i >= 75 && !hooks.length && !text) throw new Error('startup-timeout');
      if (exited) throw new Error('native-client-exited');
    }
    throw new Error('native-turn-timeout');
  } catch (error) {
    const category = /^[a-z-]+$/.test(error.message) ? error.message : 'capture-error';
    if (category === 'capture-error') {
      const location = error.stack?.match(/\/live\.mjs:(\d+:\d+)/)?.[1] ?? null;
      save(join(plan.directory, 'capture-failure.json'), { location, name: error.name });
    }
    const evidence = { arm, task, repetition, state: category, runDir: plan.directory, flags: [...status], workspaceTrustSetup: trust,
      hookEvents: logRows(hookSink).map(row => row.hook_event_name), consent, consentFiles, exitCode: exited?.exitCode };
    save(join(plan.directory, 'blocked.json'), evidence);
    return evidence;
  } finally {
    if (!exited) pane.kill();
    for (let i = 0; !exited && i < 20; i++) await delay(50);
    if (!exited) pane.kill('SIGKILL');
    terminal.dispose();
    shell?.close();
  }
}

const [task, ordinal, ...arms] = process.argv.slice(2);
for (const arm of arms) {
  const result = await run(arm, task, Number(ordinal));
  console.log(JSON.stringify(result));
  if (result.state !== 'recorded') process.exitCode = 1;
}
