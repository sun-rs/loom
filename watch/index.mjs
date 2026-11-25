import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { adapters, hasClosingHook, hookTiming, screenProgress, trustKeys } from './observation.mjs';
import { parseResetAt } from './reset.mjs';

const exec = promisify(execFile);
const localAddress = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const reasons = new Map([['trust-dialog', 'trust'], ['picker', 'picker'], ['rate-limit', 'rate-limit'], ['auth-fail', 'auth']]);
const closedKinds = new Set(['not_found', 'finished']);
const defaultLoom = fileURLToPath(new URL('../bin/loom', import.meta.url));
const trustWaitMs = 15_000;

async function hcRequest(command, ...args) {
  try {
    const { stdout } = await exec('hc', [command, '--json', ...args], {
      timeout: command === 'send' ? 75_000 : 5_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    let kind;
    try { kind = JSON.parse(error.stderr).error.kind; } catch { /* No structured hc error. */ }
    throw Object.assign(new Error(`hc ${command} failed`), { kind });
  }
}

export function loomQueue(command = defaultLoom, project) {
  return async ({ addr, cwd, mode, message }) => {
    const args = ['send', addr, '--mode', mode];
    if (project) args.push('--project', project);
    const { stdout } = await exec(command, [...args, message], { cwd: cwd ?? undefined, timeout: 5_000 });
    const receipt = JSON.parse(stdout);
    if (receipt?.ok === false || (receipt?.ok !== true &&
        !(typeof receipt?.id === 'string' && ['queued', 'delivered'].includes(receipt.status)))) {
      throw new Error('No Loom queue receipt');
    }
    return receipt;
  };
}

function bindingOf(session) {
  return { cli: session.cli, cwd: session.cwd ?? null, startedAt: session.startedAt ?? null, sessionId: session.sessionId ?? null };
}

function sameBinding(a, b) {
  return a.cli === b.cli && a.cwd === b.cwd && a.startedAt === b.startedAt &&
    (!a.sessionId || !b.sessionId || a.sessionId === b.sessionId);
}

function incidentFrom(event) {
  return {
    id: event.incidentId, reason: event.reason, since: event.since, evidence: event.evidence,
    at: event.at, resetAt: event.resetAt ?? null, alerted: event.type === 'stuck', resumeAttempted: false,
  };
}

function journalEntries(path) {
  let body;
  try { body = readFileSync(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
  if (body && !body.endsWith('\n')) throw new Error('Incomplete watcher event record');
  const entries = new Map();
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (!event.binding || !event.incidentId) continue;
    const current = entries.get(event.addr);
    const incident = current?.incident?.id === event.incidentId ? current.incident : null;
    if (event.type === 'stuck' || (event.type === 'trust-accept' && event.phase === 'attempt')) {
      if (incident) incident.alerted ||= event.type === 'stuck';
      else entries.set(event.addr, { addr: event.addr, binding: event.binding, incident: incidentFrom(event) });
    } else if (incident) {
      if (event.type === 'recovered') {
        if (event.awaitingReset) incident.recovered = true;
        else entries.delete(event.addr);
      }
      if (event.type === 'closed') entries.delete(event.addr);
      if (event.type === 'rate-limit-reset') incident.resetAt = event.resetAt;
      if (event.type === 'resume' && event.phase === 'attempt') {
        incident.resumeAttempted = true;
        if (incident.recovered) entries.delete(event.addr);
      }
    }
  }
  return entries;
}

function liveSessions(rows, includeHeadless) {
  return new Map(rows.filter(session => session && typeof session.addr === 'string' && localAddress.test(session.addr) &&
    adapters.has(session.cli) && (includeHeadless || session.backend == null || session.backend === 'tui') && session.endedAt == null &&
    session.live !== false && !['ended', 'exited', 'finished'].includes(session.state)).map(session => [session.addr, session]));
}

function isVisibleFrame(terminal, frame) {
  return terminal.screen !== 'inexact' && frame?.complete === true && frame.how === 'screen' && typeof frame.text === 'string';
}

function snapshot(entry, screen, state = screen) {
  const { addr, incident } = entry;
  if (!incident || incident.recovered) return { addr, screen, state };
  return { addr, screen, state: incident.alerted ? 'needs-you' : 'recovering', reason: incident.reason,
    ...(incident.resetAt == null ? {} : { resetAt: incident.resetAt }) };
}

export function createWatcher({
  listSessions, readHooks = async () => [], eventFile, trustedCwds = [], superAddr, hc = hcRequest,
  enqueue = loomQueue(), idleMs = 30_000, busyMs = 45_000, now = Date.now, inspectRuntime, report = () => {},
}) {
  if (!eventFile || typeof listSessions !== 'function') throw new TypeError('eventFile and listSessions are required');
  if (![idleMs, busyMs].every(value => Number.isFinite(value) && value > 0)) throw new RangeError('Invalid timeout');
  if (superAddr != null && (typeof superAddr !== 'string' || !localAddress.test(superAddr))) throw new TypeError('Invalid super address');
  const allowed = new Set(trustedCwds.map(path => {
    if (!isAbsolute(path)) throw new TypeError('Trusted directories must be absolute');
    return realpathSync(path);
  }));
  mkdirSync(dirname(eventFile), { recursive: true });
  const entries = journalEntries(eventFile);
  let notifications = Promise.resolve();
  let inFlight;

  function record(entry, incident, type, fields = {}) {
    const event = { eventId: randomUUID(), type, addr: entry.addr, at: now(), incidentId: incident.id,
      reason: incident.reason, binding: entry.binding, ...fields };
    appendFileSync(eventFile, `${JSON.stringify(event)}\n`, { flag: 'a', mode: 0o600, flush: true });
    return event;
  }

  function notify(entry, incident, event) {
    const action = event.type === 'stuck' ? 'needs-you' : 'recovered';
    const reset = event.resetAt == null ? '' : ` (reset ${new Date(event.resetAt).toISOString()})`;
    const message = `[loom watch] ${event.addr} ${action} ${event.reason}${reset}`;
    report(message);
    if (superAddr == null) return;
    notifications = notifications.catch(() => {}).then(async () => {
      try { await hc('send', superAddr, message); }
      catch { record(entry, incident, 'notification-failed', { notification: event.eventId }); }
    });
  }

  function alert(entry, incident) {
    const event = record(entry, incident, 'stuck', { state: 'needs-you', since: incident.since,
      evidence: incident.evidence, ...(incident.resetAt == null ? {} : { resetAt: incident.resetAt }) });
    incident.alerted = true;
    entry.incident = incident;
    notify(entry, incident, event);
  }

  function close(entry, type, fields) {
    const incident = entry.incident;
    if (!incident) return;
    const event = record(entry, incident, type, fields);
    if (fields.awaitingReset) incident.recovered = true;
    else entry.incident = null;
    if (type === 'recovered' && incident.alerted) notify(entry, incident, event);
  }

  async function resume(entry, session, incident) {
    const fields = { mode: 'queue', message: '继续', resetAt: incident.resetAt };
    const attempt = record(entry, incident, 'resume', { phase: 'attempt', ...fields });
    incident.resumeAttempted = true;
    let receipt;
    let phase = 'queued';
    try {
      receipt = await enqueue({ addr: entry.addr, cwd: session.cwd, project: session.project, ...fields, eventId: attempt.eventId });
    }
    catch { phase = 'failed'; }
    const deliveryId = receipt?.deliveryId ?? receipt?.id;
    record(entry, incident, 'resume', { phase, ...fields, ...(typeof deliveryId === 'string' ? { deliveryId } : {}) });
    if (incident.recovered) entry.incident = null;
  }

  function timedCondition(entry, screen, text, hooks, at) {
    if (screen !== 'busy' && !(screen === 'idle' && hooks.open)) {
      entry.timer = null;
      return null;
    }
    const idle = screen === 'idle';
    const reason = idle ? 'idle-without-stop' : 'busy-without-output';
    const work = idle ? [hooks.open.sessionId, hooks.open.turn, hooks.open.at] : screenProgress(text);
    const evidence = JSON.stringify([work, hooks.activityAt]);
    const previous = entry.timer ?? entry.incident;
    const since = previous?.reason === reason && previous.evidence === evidence ? previous.since : at;
    entry.timer = { reason, evidence, since };
    return at - since >= (idle ? idleMs : busyMs) ? entry.timer : null;
  }

  async function openIncident(entry, session, condition, terminal, text, at) {
    const incident = { ...condition, id: randomUUID(), at, alerted: false, resumeAttempted: false,
      resetAt: condition.reason === 'rate-limit' ? parseResetAt(text, at) : null };
    let keys = condition.reason === 'trust' ? trustKeys(session, terminal, text, allowed) : [];
    if (keys.length) {
      try {
        const latest = await hc('get', session.addr);
        if (latest?.state !== 'live' || latest.address !== session.addr || latest.pid !== terminal.pid ||
            latest.created_ms !== terminal.created_ms) return;
        const frame = await hc('read', session.addr, '--lines', '0');
        if (!isVisibleFrame(latest, frame)) keys = [];
        else {
          if (adapters.get(session.cli).screen.classify(frame.text) !== 'trust-dialog') return;
          keys = trustKeys(session, latest, frame.text, allowed);
        }
      } catch (error) {
        if (closedKinds.has(error.kind)) return;
        keys = [];
      }
    }
    if (!keys.length) {
      alert(entry, incident);
      return;
    }

    record(entry, incident, 'trust-accept', { phase: 'attempt', since: incident.since });
    entry.incident = incident;
    let phase = 'submitted';
    try { await hc('keys', session.addr, ...keys); }
    catch { phase = 'failed'; }
    record(entry, incident, 'trust-accept', { phase });
    if (phase === 'failed') alert(entry, incident);
  }

  const pendingReset = incident => incident?.reason === 'rate-limit' && incident.resetAt != null && !incident.resumeAttempted;

  async function updateRateLimit(entry, session, screen, frame, condition, hooks, at) {
    const incident = entry.incident;
    if (incident?.reason !== 'rate-limit') return;
    const newTurn = hooks?.startedAt > incident.at;
    if (incident.recovered && (newTurn || screen === 'busy' || condition)) {
      close(entry, 'closed', { cause: newTurn || screen === 'busy' ? 'work-resumed' : 'superseded' });
      return;
    }
    if (screen === 'rate-limit' && incident.resetAt == null) {
      const resetAt = parseResetAt(frame.text, at);
      if (resetAt != null) {
        record(entry, incident, 'rate-limit-reset', { resetAt });
        incident.resetAt = resetAt;
      }
    }
    if (hooks && !newTurn && pendingReset(incident) && at >= incident.resetAt &&
        (screen === 'rate-limit' || (screen === 'idle' && !condition))) {
      await resume(entry, session, incident);
    }
  }

  async function observe(entry, session) {
    if (session.backend === 'headless') {
      const { state, reason, lastEventAt } = await inspectRuntime(session);
      const at = now();
      const condition = reason ?? (state === 'busy' && at - lastEventAt >= busyMs ? 'busy-without-output' : null);
      if (state === 'unknown') return snapshot(entry, state);
      if (entry.incident && entry.incident.reason !== condition) close(entry, 'recovered', { state });
      if (condition && !entry.incident) {
        alert(entry, { id: randomUUID(), reason: condition, at, since: lastEventAt ?? at, alerted: false });
      }
      return snapshot(entry, state);
    }
    let terminal;
    let frame;
    try {
      terminal = await hc('get', session.addr);
      if (terminal?.address !== session.addr) return snapshot(entry, 'unknown');
      if (terminal.state === 'live') frame = await hc('read', session.addr, '--lines', '0');
    } catch (error) {
      if (!closedKinds.has(error.kind)) return snapshot(entry, 'unknown');
      terminal = { state: 'finished', cause: error.kind };
    }
    if (terminal.state === 'finished') {
      close(entry, 'closed', { cause: terminal.cause ?? 'finished' });
      entries.delete(entry.addr);
      return snapshot(entry, 'unknown', 'exited');
    }
    if (!isVisibleFrame(terminal, frame)) return snapshot(entry, 'unknown');
    const adapter = adapters.get(session.cli).screen;
    const screen = adapter.classify(frame.text);
    if (screen === 'unknown') return snapshot(entry, screen);
    let hooks;
    try {
      const rows = await readHooks(session);
      hooks = hookTiming(session, rows, now());
    } catch { /* Timing evidence is unavailable. */ }
    const at = now();
    const reason = reasons.get(screen);
    const background = screen === 'busy' && adapter.hasRunningBackgroundTask?.(frame.text);
    if (!reason && !hooks && !background) return snapshot(entry, 'unknown');
    const condition = reason ? { reason, since: at } : background ? null : timedCondition(entry, screen, frame.text, hooks, at);
    if (reason || background) entry.timer = null;

    await updateRateLimit(entry, session, screen, frame, condition, hooks, at);
    const incident = entry.incident;
    if (!condition) {
      if (incident?.reason === 'idle-without-stop' && screen === 'idle' && !hooks.open &&
          !hasClosingHook(incident.evidence, hooks)) return snapshot(entry, screen);
      if (incident && !incident.recovered) {
        const awaitingReset = pendingReset(incident) && screen === 'idle' && hooks.startedAt <= incident.at;
        close(entry, 'recovered', { state: screen, ...(awaitingReset ? { awaitingReset } : {}) });
      }
    } else if (condition.reason !== incident?.reason ||
        (condition.evidence && condition.evidence !== incident.evidence)) {
      close(entry, 'closed', { cause: 'superseded' });
      await openIncident(entry, session, condition, terminal, frame.text, at);
    } else if (incident.reason === 'trust' && !incident.alerted && at - incident.at >= trustWaitMs) {
      alert(entry, incident);
    }
    // A timestamp may already be due when this rate-limit screen first appears.
    const opened = entry.incident;
    if (opened !== incident && opened?.reason === 'rate-limit' && hooks && opened.resetAt != null && at >= opened.resetAt) {
      await resume(entry, session, opened);
    }
    return snapshot(entry, screen, reason ? 'unknown' : screen);
  }

  async function pollSessions() {
    const sessions = liveSessions(await listSessions(), Boolean(inspectRuntime));
    for (const [addr, entry] of entries) {
      const session = sessions.get(addr);
      if (session && sameBinding(entry.binding, bindingOf(session))) continue;
      close(entry, 'closed', { cause: session ? 'rebound' : 'no-longer-indexed' });
      entries.delete(addr);
    }
    const results = await Promise.allSettled([...sessions.values()].map(session => {
      const entry = entries.get(session.addr) ?? { addr: session.addr, binding: bindingOf(session) };
      if (session.sessionId) entry.binding.sessionId = session.sessionId;
      entries.set(session.addr, entry);
      return observe(entry, session);
    }));
    const errors = results.filter(result => result.status === 'rejected');
    if (errors.length) throw new AggregateError(errors.map(result => result.reason), 'Watcher poll failed');
    return results.map(result => result.value);
  }

  return {
    poll() {
      if (!inFlight) inFlight = pollSessions().finally(() => { inFlight = undefined; });
      return inFlight;
    },
    async flush() { await notifications; },
  };
}
