import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const base = process.env.LOOM_FAULT_PROJECT;
const arm = join(base, 'fault.json');
const marker = join(base, 'fault-fired.json');
const write = fs.writeFileSync;
const matches = (stage, moment) => {
  if (!stage) return;
  let wanted;
  try { wanted = JSON.parse(fs.readFileSync(arm, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  return wanted.stage === stage && wanted.moment === moment ? wanted : undefined;
};
function fire(wanted) {
  if (!wanted) return;
  write(marker, JSON.stringify(wanted) + '\n', { flush: true });
  fs.unlinkSync(arm);
  process.kill(process.pid, 'SIGKILL');
  process.abort();
}
function selected(path, temporary) {
  if (!path.startsWith(base + '/.project/')) return;
  if (path.includes('/loomd/sessions/') && path.endsWith('.json')) {
    const job = JSON.parse(fs.readFileSync(temporary, 'utf8'));
    return job.paneBinding ? 'pane-binding' : job.stopping ? 'session-stop' : 'job';
  }
  if (path.endsWith('/watch/events.jsonl')) return 'watch-prepare';
  if (path.endsWith('/loomd/notifications.json')) return 'notification';
  if (path.endsWith('/workers.md')) return 'worker-view';
  if (path.includes('/replies/.turns/')) return 'reply-archive';
  if (path.includes('/.project/evidence/')) return path.endsWith('.json') ? 'evidence-json' : 'evidence-text';
  if (path.includes('/.project/handover/')) return 'retention';
  if (path.endsWith('/relay/state.json')) {
    const state = JSON.parse(fs.readFileSync(temporary, 'utf8'));
    const wave = Object.values(state.waves).find(value => value.id === 'FAULT-W');
    if (wave?.closed) return state.outbox.length ?
      Object.values(state.outbox[0].targets).includes('sent') ? 'outbox-sent' : 'outbox-intent' : 'outbox-prune';
    const result = state.queue.find(value => value.id === 'FAULT-WORKER');
    if (result) return result.published ? 'relay-published' : 'relay-result';
    if (wave) return 'wave-registration';
  }
  if (path.endsWith('/inbox/state.json')) {
    const { messages } = JSON.parse(fs.readFileSync(temporary, 'utf8'));
    const wave = messages.find(message => message.waveBatch);
    if (wave) return 'wave-inbox';
    const message = messages.find(value => value.text === 'FAULT REQUEST');
    if (message?.completion) return 'completion';
    if (message?.received) return 'receipt';
    if (message?.typedAt) return 'native-ack';
    if (message?.phase === 'sending') return 'attempt';
    if (message?.phase === 'queued') return 'accepted';
    if (messages.some(message => message.phase === 'stopped')) return 'stopped';
    if (messages.some(message => message.phase === 'stopping' && message.stopKeySent)) return 'abort-ack';
    if (messages.some(message => message.phase === 'stopping')) return 'abort-intent';
  }
}
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  const stage = selected(to, from);
  fire(matches(stage, 'before'));
  const result = rename(from, to);
  fire(matches(stage, 'after'));
  return result;
};
const link = fs.promises.link;
fs.promises.link = async (from, to) => {
  const stage = selected(to, from);
  fire(matches(stage, 'before'));
  const result = await link(from, to);
  fire(matches(stage, 'after'));
  return result;
};
const append = fs.appendFileSync;
fs.appendFileSync = (path, data, options) => {
  let stage;
  if (typeof path === 'string' && path.startsWith(base + '/.project/') && typeof data === 'string' && data[0] === '{') {
    const event = JSON.parse(data.trim().split('\n')[0]);
    if (path.endsWith('/watch/events.jsonl')) stage = 'watch-' + event.type;
    else if (path.includes('/relay/events/')) stage = event.type;
  }
  const torn = matches(stage, 'torn');
  if (torn) {
    append(path, data.slice(0, Math.floor(data.length / 2)), options);
    fire(torn);
  }
  fire(matches(stage, 'before'));
  const result = append(path, data, options);
  fire(matches(stage, 'after'));
  return result;
};
const prepare = DatabaseSync.prototype.prepare;
const exec = DatabaseSync.prototype.exec;
const inserting = new WeakSet();
DatabaseSync.prototype.prepare = function (sql) {
  if (/^INSERT INTO sessions /.test(sql)) inserting.add(this);
  return prepare.call(this, sql);
};
DatabaseSync.prototype.exec = function (sql) {
  const stage = sql === 'COMMIT' && inserting.has(this) ? 'index-insert' : undefined;
  fire(matches(stage, 'before'));
  const result = exec.call(this, sql);
  fire(matches(stage, 'after'));
  return result;
};
syncBuiltinESMExports();
