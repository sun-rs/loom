import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { inspectHc, root, setup } from './probe.mjs';

const [host, cli] = process.argv.slice(2);
const testOnly = process.env.MATRIX_ONLY;
const agyRateTimeout = Number(process.env.MATRIX_AGY_RATE_MS ?? 90_000);
const output = join(root, `matrix-${host}-${cli}${process.env.MATRIX_SUFFIX ?? ''}.jsonl`);
const prompt = 'Reply only with TUI-HOST-0 OK. Do not use tools.';
const elapsed = start => Math.round(performance.now() - start);
const log = value => appendFile(output, JSON.stringify({ host, cli, ...value }) + '\n');
const results = new Set();

async function record(test, start, pass, details = {}) {
  results.add(test);
  await log({ test, pass, ms: elapsed(start), ...details });
}

async function observe(session, what, predicate, timeout = 8_000) {
  const start = performance.now();
  let state;
  do {
    state = await session.readState();
    if (predicate(state) || state.exit) break;
    await sleep(100);
  } while (elapsed(start) < timeout);
  await log({ observation: what, ms: elapsed(start), state });
  return state;
}

async function startup(session, main) {
  const start = performance.now();
  const state = await observe(session, 'cold first actionable', value =>
    ['trust-dialog', 'onboarding', 'auth-fail', 'picker'].includes(value.screen.kind) || value.ready);
  let handled;
  if (state.screen.kind === 'trust-dialog') {
    for (let attempt = 0; attempt < 9; attempt++) {
      handled = await session.dialog({ trust: true });
      if (!['dialog-changed', 'human-active'].includes(handled.code)) break;
      await sleep(150);
    }
  }
  const final = await observe(session, 'cold ready', value => value.ready || value.screen.kind === 'auth-fail');
  if (main) {
    await record('cold+trust', start, state.screen.kind === 'trust-dialog' && handled?.kind === 'advanced' && final.ready,
      { initial: state.screen.kind, dialog: handled?.kind, ready: final.ready, pane: session.id });
    const quietSince = performance.now();
    let streak = 0;
    const samples = [];
    for (let i = 0; i < 9 && streak < 3 && final.ready; i++) {
      await sleep(130);
      const next = await session.readState();
      samples.push({ ready: next.ready, source: next.source, view: next.screen.kind, outputAt: next.host.lastOutputAt });
      streak = next.ready ? streak + 1 : 0;
    }
    await record('idle', quietSince, streak === 3, { source: final.source, samples, hc: await inspectHc(session.id) });
  }
  return final.ready;
}

async function verifyDelivery(session, details) {
  const { id, reply } = details;
  const native = await session.confirmations(id);
  return { ...details, native, pass: reply.kind === 'confirmed' && native.count === 1 };
}

async function send(session, text, options) {
  const id = randomUUID();
  const start = performance.now();
  const reply = await session.submit({ id, text, ...options });
  return { id, reply, ms: elapsed(start), nativeMs: reply.confirmation?.at === undefined
    ? undefined : Math.max(0, reply.confirmation.at - (performance.timeOrigin + start)) };
}

async function draftTest(session, experiment) {
  const start = performance.now();
  const marker = 'DRAFTNEGATIVE';
  await experiment.input(session.id, [...marker.toLowerCase()]);
  const visible = await observe(session, 'draft', value => value.screen.text?.toLowerCase().includes(marker.toLowerCase()) ||
    JSON.stringify(value.screen.draft ?? '').toLowerCase().includes(marker.toLowerCase()));
  const appears = value => value.screen.text?.toLowerCase().includes(marker.toLowerCase()) ||
    JSON.stringify(value.screen.draft ?? '').toLowerCase().includes(marker.toLowerCase());
  const baseline = experiment.mock.requests.length;
  const response = await send(session, prompt);
  await sleep(250);
  const after = await session.readState();
  const native = await session.confirmations(response.id);
  const misfire = experiment.mock.requests.length - baseline;
  await record('draft', start, appears(visible) && response.reply.kind === 'refused' && appears(after) && !native.count && !misfire,
    { misfire, visible: appears(visible), preserved: appears(after), response, native, draftField: after.screen.draft ?? null });
  await experiment.input(session.id, ['ctrl+u']);
  let clean = await observe(session, 'draft cleared', value => value.ready, 1_500);
  if (!clean.ready) {
    await experiment.input(session.id, ['esc']);
    clean = await observe(session, 'draft cleared with Escape', value => value.ready, 1_500);
  }
  return clean.ready;
}

async function busyTest(session, experiment) {
  const start = performance.now();
  experiment.mock.mode('slow');
  const initial = await send(session, prompt);
  const busy = await observe(session, 'busy', value => value.screen.kind === 'busy', 4_000);
  const hc = await inspectHc(session.id);
  const denied = await send(session, prompt);
  const until = performance.now() + 3_000;
  while (!experiment.mock.requests.some(request => request.mode === 'slow') && performance.now() < until) await sleep(40);
  const startedSlow = experiment.mock.requests.some(request => request.mode === 'slow');
  experiment.mock.mode('ok');
  const deferred = await send(session, `${prompt} Deferred.`, { deferMs: 14_000 });
  await observe(session, 'after deferred prompt', value => value.ready);
  const busyNative = await session.confirmations(denied.id);
  const verified = await verifyDelivery(session, deferred);
  await record('busy', start, initial.reply.kind === 'confirmed' && busy.screen.kind === 'busy' && startedSlow &&
    denied.reply.kind === 'refused' && denied.reply.code === 'busy' && !busyNative.count && verified.pass,
    { misfire: busyNative.count, initial, denied, startedSlow, hc, deferred: verified });
}

async function sequenceTest(session) {
  const start = performance.now();
  const receipts = [];
  for (let i = 1; i <= 20; i++) {
    const item = await send(session, `${prompt} Sequence ${i}.`, { deferMs: 5_000 });
    receipts.push(item);
    await log({ item: i, ...item });
  }
  await observe(session, 'settle sequence for final audit', value => value.ready);
  await sleep(300);
  const verified = [];
  for (const item of receipts) verified.push(await verifyDelivery(session, item));
  const success = verified.filter(item => item.pass).length;
  const lost = verified.filter(item => item.native.count === 0).length;
  const duplicate = verified.reduce((sum, item) => sum + Math.max(0, item.native.count - 1), 0);
  const timings = verified.filter(item => item.pass).map(item => item.ms).sort((a, b) => a - b);
  const rerun = await session.submit({ id: verified[0].id, text: `${prompt} Sequence 1.` });
  await record('20 sequential', start, success === 20 && duplicate === 0 && rerun.kind === 'confirmed',
    { success, lost, duplicate, medianMs: timings[Math.floor(timings.length / 2)], maxMs: timings.at(-1),
      sources: Object.fromEntries(['hook', 'transcript'].map(s => [s, verified.filter(item => item.native.source === s).length])),
      finalCounts: verified.map(item => item.native), rerun: rerun.kind });
}

async function interruptTest(session, experiment) {
  const start = performance.now();
  experiment.mock.mode('slow');
  const initial = await send(session, prompt, { deferMs: 5_000 });
  const busy = await observe(session, 'before interruption', value => value.screen.kind === 'busy', 4_000);
  const deadline = performance.now() + 3_000;
  const priorSlow = experiment.mock.requests.filter(request => request.mode === 'slow').length;
  while (experiment.mock.requests.filter(request => request.mode === 'slow').length < Math.max(2, priorSlow) &&
      performance.now() < deadline) await sleep(40);
  await sleep(200);
  const cancellation = await session.interrupt();
  experiment.mock.mode('ok');
  const follow = await send(session, `${prompt} After cancellation.`, { deferMs: 5_000 });
  const verified = await verifyDelivery(session, follow);
  await record('interrupt+continue', start, initial.reply.kind === 'confirmed' && busy.screen.kind === 'busy' &&
    cancellation.kind === 'confirmed' && verified.pass, { initial, cancellation, follow: verified });
  await observe(session, 'settle before exit', value => value.ready);
}

async function exitTest(session, experiment) {
  const start = performance.now();
  const waiting = session.waitExit({ timeoutMs: 9_000 }).catch(error => ({ error: error.message, code: error.code }));
  await sleep(180);
  const slash = cli === 'agy' ? '/quit' : '/exit';
  await experiment.input(session.id, [...slash, 'enter']);
  const state = await waiting;
  await record('natural exit', start, state.phase === 'exited', { state });
}

async function diagnostic(session, experiment, mode) {
  const start = performance.now();
  experiment.mock.mode(mode);
  const sent = await send(session, prompt, { deferMs: 3_000 });
  const state = await observe(session, mode, value =>
    mode === 'rate' ? value.screen.kind === 'rate-limit' : ['error', 'auth-fail'].includes(value.screen.kind), mode === 'rate' && cli === 'agy' ? agyRateTimeout : 15_000);
  const result = await send(session, `${prompt} Must be refused.`);
  const native = await session.confirmations(result.id);
  const classified = mode === 'rate' ? state.screen.kind === 'rate-limit' : state.screen.kind === 'error';
  const initialNative = await session.confirmations(sent.id);
  await record(mode === 'rate' ? '429 screen' : '400 screen', start, initialNative.count === 1 && classified &&
    result.reply.kind === 'refused' && !native.count,
  { classified, state, misfire: native.count, sent, initialNative, denied: result });
}

async function withSession(callback) {
  const experiment = await setup(host, cli);
  let session;
  try {
    session = await experiment.launch({ trustWorkspace: false });
    await log({ launch: session.id, directory: experiment.dir, hookSink: session.hookSink });
    await inspectHc(session.id, true);
    await callback(session, experiment);
  } catch (error) {
    await log({ error: error.stack });
  } finally {
    try {
      if (session) await log({ closed: session.id, receipt: await session.close() });
    } catch (error) {
      await log({ cleanup: session.id, error: error.message, code: error.code });
    } finally {
      await log({ requests: experiment.mock.requests, endpoints: experiment.mock.endpoints });
      await experiment.mock.close();
    }
  }
}

if (!testOnly || testOnly === 'main') await withSession(async (session, experiment) => {
  if (!await startup(session, true)) return;
  if (!await draftTest(session, experiment)) return;
  await busyTest(session, experiment);
  await sequenceTest(session);
  await interruptTest(session, experiment);
  await exitTest(session, experiment);
});
for (const mode of ['rate', 'error']) {
  if (testOnly && testOnly !== mode) continue;
  await withSession(async (session, experiment) => {
    if (await startup(session, false)) await diagnostic(session, experiment, mode);
  });
}
if (!testOnly) for (const test of ['cold+trust', 'idle', 'draft', 'busy', '20 sequential', 'interrupt+continue', 'natural exit', '429 screen', '400 screen']) {
  if (!results.has(test)) await log({ test, blocked: true, pass: null, ms: null });
}
