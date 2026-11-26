import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClaude } from '../../adapters/claude/parse.mjs';
import { parseCodex } from '../../adapters/codex/parse.mjs';
import { base, check, prepare } from './fixtures.mjs';
import { profile } from './launch.mjs';
import { nativeMetrics } from './metrics.mjs';

const card = fileURLToPath(new URL('.', import.meta.url));
const prompts = JSON.parse(readFileSync(join(card, 'prompts.json'), 'utf8'));
const arms = ['C0', 'C1', 'X0', 'X2'];
const tasks = ['survey', 'diagnosis'];
const repetitions = [1, 2];
const runPrefix = '/private/tmp/loom-ab-run-';
const runFile = /^run-(C[01]|X[02])-(survey|diagnosis)-([12])\.json$/;
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const writePrivate = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });

function requireRun(arm, task, repetition) {
  if (!arms.includes(arm) || !tasks.includes(task) || !repetitions.includes(repetition)) {
    throw new Error('Expected an arm C0, C1, X0 or X2, a task survey|diagnosis, and repetition 1 or 2');
  }
}

export function prepareRun(arm, task, repetition) {
  requireRun(arm, task, repetition);
  const directory = mkdtempSync(runPrefix);
  const cwd = prepare(join(directory, 'work'), task);
  const logs = join(directory, 'logs');
  mkdirSync(logs, { mode: 0o700 });
  const launch = profile(arm, cwd, logs);
  const manifest = { arm, task, repetition, base, directory, cwd, logs, launch,
    prompt: prompts[task], nativeTranscript: join(directory, 'native.jsonl'),
    metadata: join(directory, 'run-meta.json') };
  writePrivate(join(directory, 'plan.json'), manifest);
  return manifest;
}

function body(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(item => ['text', 'input_text'].includes(item.type)).map(item => item.text).join('\n');
}

export function collectRun(plan, metadata, nativeText) {
  const { arm, task, repetition, launch } = plan;
  requireRun(arm, task, repetition);
  const { vendor, version, model } = profile(arm, plan.cwd, plan.logs);
  if (plan.base !== base || launch.vendor !== vendor || launch.version !== version || launch.model !== model ||
      metadata.cliVersion !== version) throw new Error('Installed CLI, launch plan, or baseline differs from the experiment');
  const { startedAt, finishedAt, humanInterventions, codeModeConsent, scriptAudit } = metadata;
  const wallMs = Date.parse(finishedAt) - Date.parse(startedAt);
  if (!(wallMs >= 0) || !Number.isInteger(humanInterventions) || humanInterventions < 0) throw new Error('Invalid run timings or intervention count');
  if (arm === 'C1' ? !['accepted', 'previously-accepted'].includes(codeModeConsent) : codeModeConsent !== 'not-applicable') {
    throw new Error('Record the Code Mode consent outcome for the arm');
  }
  if (!Number.isInteger(scriptAudit?.outsideWorkingCopy) || scriptAudit.outsideWorkingCopy < 0 ||
      !Number.isInteger(scriptAudit.checked) || scriptAudit.checked < scriptAudit.outsideWorkingCopy) {
    throw new Error('Record how many scripts were reviewed and how many accessed paths outside the working copy');
  }
  const claude = vendor === 'claude';
  const records = nativeText.trim().split(/\r?\n/).map(line => {
    try { return JSON.parse(line); } catch { throw new Error('Invalid native transcript record'); }
  });
  const nativeModel = records.flatMap(record => {
    const value = claude ? record.type === 'assistant' && record.message?.model :
      record.type === 'turn_context' && record.payload?.model;
    return typeof value === 'string' && value !== '<synthetic>' ? [value] : [];
  });
  if (!nativeModel.length || nativeModel.some(value => value !== model)) throw new Error('Could not verify the fixed model in the native transcript');
  const submitted = records.some(record => {
    const text = claude ? record.type === 'user' && body(record.message?.content) :
      record.type === 'response_item' && record.payload?.role === 'user' ? body(record.payload.content) :
        record.type === 'event_msg' && record.payload?.type === 'user_message' && record.payload.message;
    return text === prompts[task];
  });
  const parsed = (claude ? parseClaude : parseCodex)(nativeText);
  if (!submitted || parsed.turns.length !== 1) throw new Error('Expected exactly one native turn with the fixed task prompt');
  const [turn] = parsed.turns;
  const metrics = nativeMetrics(vendor, nativeText);
  if (metrics.scriptCalls > scriptAudit.checked) throw new Error('Script audit omits a native script call');
  let checker = { passed: false, reason: 'native-turn-incomplete' };
  if (turn.status === 'completed' && turn.reply) {
    try { checker = check(plan.cwd, task, turn.reply); }
    catch { checker = { passed: false, reason: 'automatic-check-failed' }; }
  }
  return { kind: 'benchmark-run', arm, task, repetition, base, vendor, version, model, startedAt, finishedAt,
    wallMs, ...metrics, humanInterventions, codeModeConsent,
    scriptAudit: { checked: scriptAudit.checked, outsideWorkingCopy: scriptAudit.outsideWorkingCopy },
    outcome: turn.status, checker };
}

function runData(directory, file) {
  const path = join(directory, file);
  if (realpathSync(path) !== path || !lstatSync(path).isFile()) throw new Error('Expected a file directly in the private run directory');
  return readFileSync(path, 'utf8');
}

function recordRun(input) {
  const directory = resolve(input);
  if (!directory.startsWith(runPrefix) || directory.slice(runPrefix.length).includes('/') || realpathSync(directory) !== directory) {
    throw new Error('Expected a private run directory from the prepare command');
  }
  const plan = JSON.parse(runData(directory, 'plan.json'));
  if (plan.directory !== directory || plan.cwd !== join(directory, 'work') || plan.logs !== join(directory, 'logs') ||
      realpathSync(plan.cwd) !== plan.cwd) {
    throw new Error('The saved launch plan does not match this run directory');
  }
  const record = collectRun(plan, JSON.parse(runData(directory, 'run-meta.json')), runData(directory, 'native.jsonl'));
  writePrivate(join(card, 'runs', `run-${record.arm}-${record.task}-${record.repetition}.json`), record);
  return { arm: record.arm, task: record.task, repetition: record.repetition, checker: record.checker, wallMs: record.wallMs };
}

const metricNames = ['modelRequests', 'inputTokens', 'cachedTokens', 'cacheWriteTokens', 'outputTokens', 'peakContextTokens',
  'toolCalls', 'replCalls', 'scriptCalls', 'wallMs', 'humanInterventions'];

function spread(values) {
  const n = values.length;
  const mean = n ? values.reduce((sum, value) => sum + value, 0) / n : null;
  const sampleSD = n > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)) : null;
  return { n, mean, sampleSD };
}

function stats(records) {
  return {
    runs: records.length, passed: records.filter(record => record.checker.passed).length,
    correctness: spread(records.map(record => Number(record.checker.passed))),
    outsideWorkingCopy: records.reduce((total, record) => total + record.scriptAudit.outsideWorkingCopy, 0),
    metrics: Object.fromEntries(metricNames.map(key => [key, spread(records.map(record => record[key]).filter(Number.isFinite))])),
  };
}

export function summarize(directory) {
  const records = readdirSync(directory).filter(file => runFile.test(file)).map(file => {
    const [, arm, task, ordinal] = runFile.exec(basename(file));
    const row = readJson(join(directory, file));
    const { vendor, model, version } = profile(arm, '', '');
    if (row.kind !== 'benchmark-run' || row.arm !== arm || row.task !== task || row.repetition !== Number(ordinal) ||
        row.base !== base || row.vendor !== vendor || row.model !== model || row.version !== version) {
      throw new Error(`Inconsistent benchmark receipt ${file}`);
    }
    return row;
  });
  const expectedCount = arms.length * tasks.length * repetitions.length;
  return {
    base, sampleCount: records.length, expectedCount,
    complete: records.length === expectedCount,
    arms: Object.fromEntries(arms.map(arm => {
      const rows = records.filter(record => record.arm === arm);
      return [arm, { ...stats(rows), tasks: Object.fromEntries(tasks.map(task => [task, stats(rows.filter(row => row.task === task))])) }];
    })),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, arg, task, repetition] = process.argv.slice(2);
    const result = command === 'prepare' ? prepareRun(arg, task, Number(repetition)) :
      command === 'record' ? recordRun(arg) : command === 'summary' ? summarize(join(card, 'runs')) : null;
    if (!result) throw new Error('Use prepare ARM TASK REPETITION, record RUN_DIR, or summary');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
