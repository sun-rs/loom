import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { syncDirectory, writeState } from '../daemon/io.mjs';
import { isBlockedReply } from '../inbox/message.mjs';
import { observe } from './sources.mjs';

export const address = '[A-Za-z0-9][A-Za-z0-9_.-]*';
const rowPattern = new RegExp(`^\\s*\\|?\\s*(?<id>${address})\\s*\\|\\s*(?<addr>${address})\\s*\\|\\s*(?<provider>codex|agy|claude|opencode)\\s*\\|\\s*(?<status>dispatched|done|failed|blocked|unconfirmed|superseded)\\s*\\|(?<tail>.*)$`);
const wavePattern = new RegExp(String.raw`(?:^|[^\\])\|\s*wave=(${address})\s*\|?\s*$`);
const refusals = new Set(['blocked', 'status_mismatch', 'finished', 'not_found']);
const firstLine = body => body.trimStart().split(/\r?\n/, 1)[0];
const sameWorker = ({ id, addr }) => `${id}/${addr}`;
const registration = worker => `${worker.wave ?? ''}/${sameWorker(worker)}`;
const terminalText = body => body.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
export const managedWaveKey = (parent, project, wave, mode = 'wave') => `${mode}:${parent ?? ''}/${encodeURIComponent(project)}/${wave}`;

function atomic(path, value, beforeRename = () => true) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, value, { mode: 0o600, flush: true });
  if (beforeRename()) {
    renameSync(temp, path);
    syncDirectory(join(path, '..'));
    return;
  }
  rmSync(temp);
}

function read(path, missing = '') {
  try { return readFileSync(path, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return missing;
  }
}

function parseWorker(line) {
  const fields = line.match(rowPattern)?.groups;
  if (!fields) return;
  const { tail, ...worker } = fields;
  return { ...worker, wave: tail.match(wavePattern)?.[1] };
}

export function workers(text) {
  const rows = text.split(/\r?\n/).flatMap(line => parseWorker(line) ?? []);
  return [...new Map(rows.map(worker => [registration(worker), worker])).values()];
}

function publish(project, file, reply, managed) {
  atomic(reply.path, reply.body);
  if (managed) return;
  atomic(join(project, '.project/replies', `${reply.id}.md`), reply.body);
  const result = terminalText(firstLine(reply.body)).replaceAll('|', '\\|');
  for (;;) {
    const previous = read(file);
    const updated = previous.split(/(\r?\n)/).map(line => {
      const row = parseWorker(line);
      if (!row || registration(row) !== registration(reply)) return line;
      const wave = row.wave ? ` | wave=${row.wave}` : '';
      const fields = `${row.id} | ${row.addr} | ${row.provider} | ${reply.outcome.toLowerCase()} | ${result}${wave}`;
      return line.trimStart().startsWith('|') ? `| ${fields} |` : fields;
    }).join('');
    if (updated === previous) return;
    let matched;
    atomic(file, updated, () => (matched = read(file) === previous));
    if (matched) return;
  }
}

export function format(replies) {
  const limit = Math.min(4000, Math.floor(32_000 / replies.length));
  return replies.map(reply => {
    const lines = terminalText(reply.body).trimEnd().split('\n');
    const excerpt = lines.slice(0, 16).join('\n');
    const more = lines.length > 16 || excerpt.length > limit ? `\n… 完整内容 ${reply.path}` : '';
    const label = reply.source === 'fallback: hc read' ? ' [fallback: hc read]' : '';
    const evidence = reply.evidence ? `\n${terminalText(reply.evidence)}` : '';
    return `${reply.id} ${reply.addr} ${reply.outcome}${label}\n${excerpt.slice(0, limit)}${more}${evidence}`;
  }).join('\n\n');
}

function enqueue(state, replies, wave, pending = [], recipients, metadata = {}) {
  const heading = wave ? `波次 ${wave}${pending.length ? '（超时）' : ''}` : '';
  const missing = pending.length ? `未完成：${pending.map(item => item.replace('/', ' ')).join('、')}` : '';
  const message = [heading, replies.length ? format(replies) : '', missing].filter(Boolean).join('\n\n');
  state.outbox.push({ id: randomUUID(), count: replies.length, message,
    failed: replies.some(reply => reply.outcome === 'FAILED' || reply.mismatch), targets: {}, recipients, ...metadata });
}

function resultKind(reply) {
  if (reply.failed) return 'FAILED';
  if (reply.unconfirmed) return 'UNCONFIRMED';
  if (isBlockedReply(reply.body)) return 'BLOCKED';
  return /^\**FAILED(?:\s|$)/i.test(firstLine(reply.body)) ? 'FAILED' : 'DONE';
}

function managedView(rows, state) {
  return rows.map(row => {
    const result = state.progress[sameWorker(row)]?.result;
    const status = row.managed.superseded && result ? 'superseded' :
      result?.outcome.toLowerCase() ?? (state.progress[sameWorker(row)]?.first ? 'done' : 'dispatched');
    return `${row.id} | ${row.addr} | ${row.provider} | ${status} | ${result?.summary ?? ''} | wave=${row.wave}\n`;
  }).join('');
}

function waveForReply(waves, reply) {
  if (reply.wave) return waves[reply.waveKey ?? `wave:${reply.wave}`];
  if (waves.legacy?.members.includes(sameWorker(reply))) return waves.legacy;
}

export function relay(project, targets, window, call, report = console.log, inboxRoutes = () => undefined, {
  withEvidence = false, managedWorkers, deliver, index, sealWindow = window, partialWindow, blockedWindow = 60_000,
  onBatch, parentFor = addr => addr,
} = {}) {
  const work = join(project, '.project/workers.md');
  const dir = join(project, '.project/relay');
  const archive = join(project, '.project/replies/.turns');
  mkdirSync(archive, { recursive: true, mode: 0o700 });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'state.json');
  const state = JSON.parse(read(file, '{"progress":{},"queue":[],"outbox":[]}'));
  state.waves ??= {};
  const save = () => atomic(file, JSON.stringify(state) + '\n');
  const recipients = batch => batch.recipients ?? (batch.failed === false ? targets.slice(0, 1) : targets);
  function addManaged(waveKey, wave, replies, label, waveKind, pending = [], metadata) {
    const fields = { waveKey, waveKind, resultWorkers: replies.map(reply => reply.addr), ...metadata, ...(wave.forcedSeal && { forcedSeal: true }) };
    const blocked = !wave.blockedNotified && replies.some(reply => reply.outcome === 'BLOCKED');
    if (wave.parent || pending.length || blocked) enqueue(state, replies, label, pending, wave.parent ? [wave.parent] : [], {
      ...fields,
      ...(pending.length && { timeout: { project: wave.project, addr: wave.parent, at: metadata?.streamAt ?? wave.deadline } }),
      ...(blocked && { blocked: { project: wave.project, addr: wave.parent } }),
    });
  }

  async function step(now = Date.now()) {
    const rows = managedWorkers ? await managedWorkers() : workers(read(work));
    const before = JSON.stringify(state);
    if (state.wave) {
      state.waves.legacy = { deadline: state.wave.at + window, members: state.wave.members };
      delete state.wave;
    }
    const waveKey = row => row.managed ? managedWaveKey(row.managed.parent, row.managed.project,
      row.managed.barrier ?? row.wave, row.managed.deliver) : `wave:${row.wave}`;
    const groups = Map.groupBy(rows.filter(row => row.wave), waveKey);
    for (const [key, group] of groups) {
      const managed = group[0].managed;
      if (!state.waves[key] && (managed || group.some(row => row.status === 'dispatched'))) {
        state.waves[key] = { id: managed?.barrier ?? group[0].wave, deadline: managed ? null : now + window, members: group.map(sameWorker),
          ...(managed && { parent: managed.parent, project: managed.project, managed: true, delivered: [], deliver: managed.deliver }) };
      }
      const wave = state.waves[key];
      if (managed) wave.project ??= managed.project;
      if (wave?.managed) wave.parent = parentFor(wave.parent);
      if (wave?.deliver === 'stream') {
        wave.members = group.map(sameWorker);
        continue;
      }
      if (wave && managed && wave.deadline === null && !wave.closed) {
        wave.members = group.map(sameWorker);
        wave.sealDeadline ??= Math.min(...group.map(row => row.managed.startedAt)) + sealWindow;
        const nativeSeal = group.every(row => row.managed.sealed);
        if (nativeSeal || now >= wave.sealDeadline) {
          if (!nativeSeal) wave.forcedSeal = true;
          wave.sealedAt = Math.min(now, wave.sealDeadline);
          wave.deadline = wave.sealedAt + window;
        }
      }
    }
    const current = [...new Map(rows.map(worker => [sameWorker(worker), worker])).values()];
    const batches = await Promise.all(current.map(async worker => {
      const key = sameWorker(worker);
      const progress = structuredClone(state.progress[key] ?? {});
      try {
        const managed = worker.managed;
        const first = managed?.reply;
        const replies = managed ?
          first && !progress.first ? [first] : [] :
          await observe(project, worker, progress, call, now, withEvidence);
        const results = await Promise.all(replies.map(async ({ evidenceInput, ...reply }) => {
          const hash = createHash('sha256').update(`${key}/${reply.key}`).digest('hex').slice(0, 20);
          const outcome = resultKind(reply);
          const { managed: _, ...row } = worker;
          const result = { ...row, ...reply, outcome, path: join(archive, `${worker.id}-${hash}.md`),
            ...(managed ? { waveKey: waveKey(worker) } : { inboxRecipients: inboxRoutes(worker.addr, reply) }) };
          if (withEvidence && evidenceInput !== false) {
            try {
              const { captureRelayTurn } = await import('../evidence/relay.mjs');
              const { card, data } = await captureRelayTurn(project, worker, reply, hash, evidenceInput, index);
              result.evidence = card;
              result.mismatch = data.claims.some(claim => claim.status === 'MISMATCH');
            } catch (error) { report(`${worker.id} ${worker.addr} evidence ${error.code ?? error.name}`); }
          }
          return result;
        }));
        if (managed && results.length) {
          progress.first = true;
          progress.result = { outcome: results[0].outcome, summary: terminalText(firstLine(first.body)).replaceAll('|', '\\|') };
        }
        if (managed?.superseded && progress.result) progress.result.superseded = true;
        state.progress[key] = progress;
        return results;
      } catch (error) {
        report(`${worker.id} ${worker.addr} ${error.message}`);
        return [];
      }
    }));
    state.queue.push(...batches.flat());
    if (before !== JSON.stringify(state)) save();
    for (const reply of state.queue.filter(reply => !reply.published)) {
      publish(project, work, reply, Boolean(reply.waveKey));
      reply.published = true;
      report(`${reply.id} ${reply.addr} ${reply.outcome} (${reply.source})`);
      save();
    }
    if (managedWorkers) {
      const view = managedView(rows, state);
      if (read(work) !== view) writeState(work, view);
    }
    const beforeDelivery = JSON.stringify(state);
    const currentByKey = new Map(rows.map(row => [sameWorker(row), row]));
    for (const [key, wave] of Object.entries(state.waves)) {
      if (wave.managed) {
        const waveReplies = state.queue.filter(reply => reply.waveKey === key);
        const currentResult = reply => !currentByKey.get(sameWorker(reply))?.managed.superseded;
        if (wave.deliver === 'stream') {
          const replies = new Map(waveReplies.map(reply => [sameWorker(reply), reply]));
          wave.timedOut ??= [];
          for (const member of wave.members.filter(member => !wave.delivered.includes(member))) {
            const worker = currentByKey.get(member)?.managed;
            const reply = replies.get(member);
            if (worker?.superseded) {
              wave.delivered.push(member);
            } else if (reply) {
              const late = wave.timedOut.includes(member);
              addManaged(key, wave, [reply], late ? wave.id + '（补投）' : wave.id, late ? 'late' : 'stream',
                [], { streamAt: reply.at, ...(late && { lateWorker: reply.addr }) });
              wave.delivered.push(member);
            } else if (worker && now >= worker.startedAt + window && !wave.timedOut.includes(member)) {
              const activity = Number.isFinite(worker.activityAt) ? new Date(worker.activityAt).toISOString() : '未知';
              addManaged(key, wave, [], wave.id, 'timeout', [member + ' STUCK（最近活动 ' + activity + '）'],
                { streamAt: worker.startedAt + window, forcedSeal: true });
              wave.timedOut.push(member);
            }
          }
          wave.closed = wave.members.every(member => wave.delivered.includes(member) || wave.timedOut.includes(member));
          continue;
        }
        if (wave.closed) {
          const late = waveReplies.filter(reply => !wave.delivered.includes(sameWorker(reply)));
          for (const reply of late) {
            if (currentResult(reply)) addManaged(key, wave, [reply], `${wave.id}（补投）`, 'late', [], { lateWorker: reply.addr });
            wave.delivered.push(sameWorker(reply));
          }
        } else if (wave.deadline !== null) {
          const settled = new Map(waveReplies.map(reply => [sameWorker(reply), reply]));
          if (partialWindow !== undefined && settled.size && wave.members.length > 1) {
            const earliest = Math.min(...waveReplies.map(reply => reply.at));
            wave.deadline = Math.min(wave.deadline, Math.max(wave.sealedAt ?? wave.deadline - window, earliest) + partialWindow);
          }
          const present = new Map([...settled].filter(([, reply]) => reply.at <= wave.deadline || wave.delivered.includes(sameWorker(reply))));
          const pending = wave.members.filter(member => !present.has(member));
          if (!pending.length || now >= wave.deadline) {
            const selected = wave.members.flatMap(member => !wave.delivered.includes(member) && present.has(member) ? [present.get(member)] : []);
            const missing = pending.map(member => {
              const current = currentByKey.get(member)?.managed;
              const at = current?.activityAt;
              return `${member.replace('/', ' ')} ${current?.superseded ? 'superseded' : 'STUCK'}（最近活动 ${Number.isFinite(at) ? new Date(at).toISOString() : '未知'}）`;
            });
            const available = selected.filter(currentResult);
            if (available.length || missing.length) addManaged(key, wave, available, wave.id, missing.length ? 'timeout' : 'merged', missing);
            wave.delivered.push(...selected.map(sameWorker));
            wave.closed = true;
            // Keep members already known to be late through the next durable step.
            continue;
          }
        }
        if (!wave.closed && !wave.blockedNotified) {
          const available = waveReplies.filter(reply => !wave.delivered.includes(sameWorker(reply)) && currentResult(reply));
          const blocked = available.filter(reply => reply.outcome === 'BLOCKED');
          if (blocked.length) {
            wave.blockedDeadline ??= Math.min(...blocked.map(reply => reply.at)) + blockedWindow;
            if (now >= wave.blockedDeadline) {
              const early = available.filter(reply => reply.at <= wave.blockedDeadline);
              if (early.some(reply => reply.outcome === 'BLOCKED')) {
                if (wave.deliver === 'barrier') {
                  enqueue(state, early.filter(reply => reply.outcome === 'BLOCKED'), wave.id + '（阻塞）', [], [], {
                    blocked: { project: wave.project, addr: wave.parent },
                  });
                } else {
                  addManaged(key, wave, early, `${wave.id}（阻塞）`, 'blocked');
                  wave.delivered.push(...early.map(sameWorker));
                }
                wave.blockedNotified = true;
              }
            }
          }
        }
        continue;
      }
      if (wave.closed) continue;
      const completed = new Map();
      for (const reply of state.queue) {
        if (reply.wave === wave.id && reply.at <= wave.deadline && !completed.has(sameWorker(reply))) {
          completed.set(sameWorker(reply), reply);
        }
      }
      const pending = wave.members.filter(member => !completed.has(member));
      if (pending.length && now < wave.deadline) continue;
      const selected = wave.members.flatMap(member => completed.get(member) ?? []);
      const destinations = selected.some(reply => reply.outcome === 'FAILED' || reply.mismatch && reply.outcome !== 'BLOCKED') ? targets : targets.slice(0, 1);
      if (selected.some(reply => destinations.some(target => reply.inboxRecipients?.includes(target)))) {
        for (const target of destinations) {
          const remainder = selected.filter(reply => !reply.inboxRecipients?.includes(target));
          if (remainder.length || pending.length) enqueue(state, remainder, wave.id, pending, [target]);
        }
      } else {
        enqueue(state, selected, wave.id, pending);
      }
      // Keep a closed named wave so a late result can be archived without another delivery.
      if (wave.id) wave.closed = true;
      else {
        state.queue = state.queue.filter(reply => !selected.includes(reply));
        delete state.waves[key];
      }
    }
    state.queue = state.queue.filter(reply => {
      const wave = waveForReply(state.waves, reply);
      if (!reply.wave && !wave && !reply.inboxRecipients) enqueue(state, [reply]);
      if (wave?.deliver === 'stream') return !wave.delivered.includes(sameWorker(reply));
      return wave && (!wave.closed || wave.managed && !wave.delivered.includes(sameWorker(reply)));
    });
    if (beforeDelivery !== JSON.stringify(state)) save();
    for (const batch of state.outbox) {
      if (batch.timeout || batch.blocked) await onBatch?.(batch);
      for (const target of recipients(batch)) {
        const attempt = batch.targets[`addr:${target}`];
        if (attempt === 'attempted' || attempt === 'sent' || attempt > now) continue;
        if (!deliver) batch.targets[`addr:${target}`] = 'attempted';
        batch.id ??= randomUUID();
        save();
        try {
          if (deliver) await deliver(target, batch);
          else await call('send', target, batch.message);
          batch.targets[`addr:${target}`] = 'sent';
          report(`sent ${batch.count} ${target}`);
        } catch (error) {
          if (deliver || refusals.has(error.kind)) batch.targets[`addr:${target}`] = now + 5000;
          report(`${error.message}${refusals.has(error.kind) ? ' · retry scheduled' : ' · delivery uncertain'}`);
        }
        save();
      }
    }
    const remaining = state.outbox.filter(batch => recipients(batch).some(target => batch.targets[`addr:${target}`] !== 'sent'));
    if (remaining.length !== state.outbox.length) {
      state.outbox = remaining;
      save();
    }
  };
  return Object.assign(step, {
    isSealed: (parent, name, wave, mode) => {
      const saved = state.waves[managedWaveKey(parent, name, wave, mode)];
      return Boolean(saved && (saved.closed || saved.deadline !== null));
    },
  });
}
