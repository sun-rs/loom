import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promptAndWait } from '@botiverse/oar/observe';
import { codexRuntime } from '@botiverse/oar/runtimes/codex';
import { antigravityRuntime } from '@botiverse/oar/runtimes/antigravity';
import { locate as locateAgy, parse as parseAgy } from '../../adapters/agy/transcript.mjs';
import { locate as locateCodex, parse as parseCodex } from '../../adapters/codex/transcript.mjs';
import { protocolEvents } from './events.mjs';

const runtimes = new Map([['codex', codexRuntime], ['agy', antigravityRuntime]]);
const unsafePath = /(?:^|\/)(?:provider-homes|memories[^/]*|\.env[^/]*)(?:\/|$)/;
const nonempty = value => typeof value === 'string' && value.trim() !== '';

function nativeHome(cli) {
  const path = cli === 'codex' ? process.env.CODEX_HOME || join(homedir(), '.codex') : join(homedir(), '.gemini');
  const absolute = isAbsolute(path) ? path : join(process.cwd(), path);
  let resolved;
  try { resolved = realpathSync(absolute); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (unsafePath.test(absolute) || resolved && unsafePath.test(resolved)) throw new Error('Native home is outside the permitted stores');
  return absolute;
}

function baseCommit(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
  } catch { return null; }
}

export async function spawnHeadless({ cli, model, effort, cwd, prompt, project, task, wave }, options = {}) {
  const runtime = runtimes.get(cli);
  if (!runtime || ![cwd, prompt, project, task, wave].every(nonempty)) {
    throw new TypeError('Expected codex or agy, cwd, prompt, project, task and wave');
  }
  const home = nativeHome(cli);
  cwd = realpathSync(cwd);
  const projectDir = realpathSync(options.projectDir ?? (isAbsolute(project) ? project : cwd));
  const child = relative(projectDir, cwd);
  if (isAbsolute(child) || child === '..' || child.startsWith('../')) throw new Error('cwd must be inside the relay project');
  const address = `oar-${randomUUID()}`;
  const dir = join(projectDir, '.project/relay');
  const indexDir = join(dir, 'oar');
  const eventDir = join(dir, 'events');
  const indexPath = join(indexDir, `${address}.json`);
  const eventsPath = join(eventDir, `${address}.jsonl`);
  mkdirSync(indexDir, { recursive: true, mode: 0o700 });
  mkdirSync(eventDir, { recursive: true, mode: 0o700 });
  const startedAt = Date.now();
  const index = {
    role: 'worker', project, task, wave, addr: address, backend: 'headless',
    runtimeId: runtime.id, cli, model: model ?? 'default',
    sessionId: null, transcriptPath: null, cwd, account: null, baseCommit: baseCommit(cwd),
    startedAt, endedAt: null, parent: options.parent ?? null,
  };
  const save = () => {
    writeFileSync(`${indexPath}.tmp`, JSON.stringify(index) + '\n', { mode: 0o600 });
    renameSync(`${indexPath}.tmp`, indexPath);
  };
  save();

  // These probes run the executable's version/help. Auth and account operations are outside the Session API we use.
  const env = {
    HC_TERMINAL_ID: null,
    ...(cli === 'agy' ? { AGY_CLI_DISABLE_AUTO_UPDATE: 'true', GEMINI_HOME: null } : { CODEX_HOME: home }),
  };
  const launchArgs = cli === 'codex' ? [
    '-c', 'features.memories=false', '-c', 'sandbox_mode="workspace-write"',
    '-c', `projects.${JSON.stringify(cwd)}.trust_level="trusted"`,
  ] : ['--sandbox', '--log-file', join(indexDir, `${address}.log`)];
  let session;
  try {
    const installation = await runtime.installation({ env });
    if (installation.kind !== 'available') throw new Error(`${cli} unavailable: ${installation.reason ?? installation.kind}`);
    session = await runtime.session(installation, { cwd, model, effort, env, launchArgs });
    index.sessionId = session.id;
    index.model = session.model().value ?? index.model;
    save();
  } catch (error) {
    if (session) await session.dispose();
    index.endedAt = Date.now();
    save();
    throw error;
  }

  const locate = () => cli === 'agy' ? locateAgy({ sessionId: session.id }) :
    locateCodex({ sessionId: session.id, cwd, codexHome: home });
  function bindTranscript(candidate) {
    if (!candidate || unsafePath.test(candidate) || candidate === index.transcriptPath) return;
    try {
      if (realpathSync(candidate) !== candidate) return;
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    index.transcriptPath = candidate;
    save();
  }
  async function updateTranscript() {
    if (cli === 'agy') return bindTranscript(locate());
    if (index.transcriptPath) return;
    const reported = await session.nativeSessionFile?.();
    bindTranscript(reported && !unsafePath.test(reported) ? reported : locate());
  }
  const exited = at => {
    if (index.endedAt !== null) return;
    index.endedAt = at;
    save();
  };
  const map = protocolEvents({
    addr: address, sessionId: session.id, cli, exited,
    write: event => appendFileSync(eventsPath, JSON.stringify(event) + '\n', { mode: 0o600 }),
    nativeReply: turn => {
      if (cli === 'agy' || !index.transcriptPath) bindTranscript(locate());
      if (!index.transcriptPath) return null;
      const parse = cli === 'agy' ? parseAgy : parseCodex;
      try {
        return parse(readFileSync(index.transcriptPath, 'utf8')).turns[turn - 1]?.reply;
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
  });
  let eventError;
  let unsubscribe;
  try {
    const afterSeq = session.records().at(-1)?.seq ?? -1;
    unsubscribe = session.events(event => {
      try { map(event); } catch (error) { eventError ??= error; }
    }, { cursor: { sessionId: session.id, afterSeq } });
  } catch (error) {
    await session.dispose();
    exited(Date.now());
    throw error;
  }

  let running = false;
  let closing;
  async function send(text, runOptions) {
    if (!nonempty(text)) throw new TypeError('Prompt must contain text');
    if (closing || index.endedAt !== null || running) throw new Error('Session is running or closed');
    running = true;
    try {
      const result = await promptAndWait(session, text, runOptions);
      await updateTranscript();
      if (eventError) throw eventError;
      return result;
    } finally { running = false; }
  }
  async function close() {
    await session.dispose();
    try {
      // The first native turn can finish before the file becomes visible.
      for (let attempt = 0; attempt < 10 && !index.transcriptPath; attempt++) {
        await updateTranscript();
        if (!index.transcriptPath) await delay(100);
      }
    } finally {
      unsubscribe();
      exited(Date.now());
    }
    if (eventError) throw eventError;
  }
  const firstTurn = send(prompt, options.firstTurnOptions);
  // Callers can attach after receiving the handle, even if the first input failed immediately.
  firstTurn.catch(() => {});
  return {
    get index() { return { ...index }; },
    get effort() { return session.effort().value; },
    indexPath, eventsPath, firstTurn, send,
    interrupt: () => session.abort(),
    close: () => (closing ??= close().catch(error => { closing = undefined; throw error; })),
  };
}
