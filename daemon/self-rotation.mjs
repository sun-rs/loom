import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { runtimeDirectory } from '../cli/project.mjs';
import { CommandError } from '../cli/sessions.mjs';
import { spawnProfile } from '../cli/policy.mjs';
import { rotatingRoles } from '../index/index.mjs';
import { deliveryFailed } from '../inbox/message.mjs';
import { clip, oneLine } from '../handover/sources.mjs';
import { missingHandoverFields, rotationReasonText } from './rotation-policy.mjs';
import { readText, writeState } from './io.mjs';

const timeLimit = 15 * 60_000;
const turnLimit = 3;
const maxNoteBytes = 12_000;
const validText = text => typeof text === 'string' && text.trim() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text);

export function selfRotation(project, { sessions, index, mail, notifications, now, spawn, failHandover, inFlight, report, v2, cleanBoundary }) {
  const directory = join(runtimeDirectory(project), 'rotation-notes');
  const stateFile = join(runtimeDirectory(project), 'self-rotation.json');
  const state = JSON.parse(readText(stateFile, '{}'));
  const save = () => writeState(stateFile, JSON.stringify(state) + '\n');
  const legacySignals = Object.values(state).filter(entry => entry.signal?.reason === 'budget' &&
    !entry.request && !entry.completed);
  if (legacySignals.length) {
    for (const entry of legacySignals) delete entry.signal;
    save();
  }
  const notePath = row => join(directory, row.addr + '.md');
  const active = row => row?.endedAt === null && rotatingRoles.includes(row.role) &&
    sessions.jobs.has(row.addr) && !sessions.jobs.get(row.addr).stopping && !sessions.jobs.get(row.addr).handoverFailure &&
    (!sessions.jobs.get(row.addr).handoverAck || sessions.jobs.get(row.addr).handoverBound) &&
    sessions.routeParent(row.addr)?.addr === row.addr;
  const progress = addr => state[addr] ??= {};
  const pendingRotation = name => index.rotations().some(row => row.project === name && row.failedAt == null && row.verifiedAt == null);
  const ensureNotes = () => {
    mkdirSync(directory, { mode: 0o700, recursive: true });
    if (realpathSync(directory) !== directory) throw new CommandError('invalid-arguments', 'Rotation notes directory must be project-local');
  };
  const missingWork = (row, note) => {
    const listed = new Set(note.match(/[A-Za-z0-9_.-]+/g));
    return inFlight(row).filter(item => ![item.addr, item.task].some(id => id && (listed.has(id) || listed.has(id + '.'))));
  };
  const describe = row => ({ addr: row.addr, role: row.role, notePath: notePath(row),
    inFlight: inFlight(row).map(({ addr, task, wave }) => ({ addr, task, wave })) });

  function request(args, caller, external = false) {
    const actor = sessions.rows().find(row => row.addr === caller || row.pane === caller) ??
      (external && { addr: 'super', role: 'super', endedAt: null, project: args.project ?? project });
    const overrides = Object.fromEntries(['cli', 'model', 'effort'].filter(key => args[key] !== undefined)
      .map(key => [key, args[key]]));
    const override = Object.keys(overrides).length > 0;
    if (!actor || actor.endedAt !== null || !external && !sessions.jobs.has(actor.addr) ||
        (args.self === true) === (typeof args.target === 'string') ||
        (args.target !== undefined || override) && actor.role !== 'super') {
      throw new CommandError('invalid-arguments', 'A managed Leader or Auditor can rotate itself. Only a managed Super may select a target or override its profile.');
    }
    const row = args.self === true ? actor : sessions.resolve(args.target, caller);
    if (!active(row) || row.project !== actor.project) throw new CommandError('not-ready', 'Choose an active Leader or Auditor in this project');
    if (args.reason !== undefined && (!validText(args.reason) || Buffer.byteLength(args.reason) > 512 || /[\r\n]/.test(args.reason)) ||
        Object.values(overrides).some(value => !validText(value))) throw new CommandError('invalid-arguments', 'Invalid rotation reason or runtime override');
    const version2 = v2().enabled();
    if (args.passive && (!version2 || actor.role !== 'super' || !v2().passiveEligible(row.addr))) {
      throw new CommandError('permission-denied', 'Only Super can rotate a recorded blocked or changed senior profile with --passive');
    }
    if (version2) {
      const lock = v2().checkAttempt(row, false);
      if (lock) throw new CommandError('rotation-phase-locked', rotationReasonText(lock));
    }
    ensureNotes();
    const details = { ...describe(row), ...(version2 && { requiredFields: missingHandoverFields(''),
      repository: v2().repositoryFacts(row) }) };
    if (args.prepare) return { rotation: { ...details, status: 'write-note' } };
    const entry = progress(row.addr);
    if (entry.request) return { rotation: { ...details, status: 'scheduled', requestId: entry.request.id,
      profile: entry.request.profile } };
    if ((entry.failures?.length ?? 0) >= 2 && actor.role !== 'super') {
      throw new CommandError('rotation-retry-exhausted', 'Two handovers failed. Loom has notified the supervising role.');
    }
    const info = lstatSync(details.notePath, { throwIfNoEntry: false });
    const note = info?.isFile() && info.size <= maxNoteBytes ? readText(details.notePath, '') : '';
    if (!validText(note) || note.trimEnd().split(/\r?\n/).length > 60) {
      throw new CommandError('rotation-note-required', `Write your handoff judgment in ${details.notePath} (up to 60 lines and 12 KB)`);
    }
    const missingFields = version2 && missingHandoverFields(note);
    if (missingFields?.length) throw new CommandError('rotation-note-required', `Add these note headings: ${missingFields.join(', ')}`);
    if (version2) {
      const missingFacts = v2().missingStatus(row, note);
      if (missingFacts.length) throw new CommandError('rotation-note-required',
        `Provide current Status values for: ${missingFacts.join(', ')}`);
    }
    const missing = missingWork(row, note);
    if (missing.length) throw new CommandError('rotation-work-unlisted', `List in-flight work in ${details.notePath}: ${missing.map(item => item.task ?? item.addr).join(', ')}`);
    const profile = { cli: row.cli, model: row.model, effort: row.effort, mode: row.backend, ...overrides };
    spawnProfile(project, { ...profile, role: row.role });
    entry.request = { id: randomUUID(), at: now(), note, notePath: details.notePath, reason: args.reason ?? (args.passive ? 'passive-blocker' : entry.signal?.reason ?? 'handoff'),
      profile, inheritFast: !override, ...(version2 && { v2: true }), ...(args.passive && { passive: true }) };
    delete entry.noteChanged;
    save();
    return { rotation: { ...details, status: 'scheduled', requestId: entry.request.id, profile } };
  }

  function propose(row, reason, { v2: version2 } = {}) {
    if (!active(row)) return;
    const entry = progress(row.addr);
    if (entry.signal || entry.request || entry.completed) return;
    ensureNotes();
    entry.signal = { id: randomUUID(), at: now(), reason, ...(version2 && { v2: true }) };
    save();
    return true;
  }

  function emergency(row, note, incident) {
    if (!active(row)) return;
    const entry = progress(row.addr);
    if (entry.request?.urgent || entry.request && [...sessions.jobs.values()].some(job => job.selfRotationId === entry.request.id)) return;
    const profile = { cli: row.cli, model: row.model, effort: row.effort, mode: row.backend };
    entry.request = { id: incident.id, at: now(), note, notePath: notePath(row), reason: incident.verdict,
      profile, inheritFast: true, v2: true, urgent: true };
    save();
  }

  function escalate(row, entry, reason, type = 'overdue') {
    if (entry.escalated === type) return;
    const toAuditor = row.role === 'leader';
    notifications.add({ id: `self-rotation:${row.addr}:${type}`, type: 'needs-decision', project: row.project,
      addr: row.addr, reason, at: now(), ...(toAuditor && { auditor: true, batch: 'leader-self-rotation' }),
      text: `Loom ${row.role} ${row.addr} 换班需要处理（${reason}）。` });
    entry.escalated = type;
  }

  function fail(row, entry, reason, handoverRecorded = false) {
    const { id } = entry.request;
    const detail = clip(oneLine(reason), 160) || 'handover-failed';
    const version2 = entry.request.v2;
    if (version2 && !handoverRecorded && reason !== 'verification-cancelled') v2().attemptFailed(row, reason, id);
    delete entry.request;
    (entry.failures ??= []).push({ id, at: now(), reason: detail });
    if (!version2 && entry.failures.length >= 2) escalate(row, entry, detail, 'retry-exhausted');
    save();
  }

  async function advance() {
    for (const [addr, entry] of Object.entries(state)) {
      const row = sessions.rowFor(addr);
      if (!row || entry.completed) continue;
      const pending = entry.request;
      if (!pending) {
        const started = entry.failures?.at(-1)?.at ?? entry.signal?.at;
        if (!active(row) || started === undefined || entry.escalated || entry.signal?.v2) continue;
        const further = new Set(mail.messages.filter(message => message.target.addr === addr &&
          !message.startup && message.completion?.at > started).map(message => message.completion.turnId ?? message.id));
        if (further.size >= turnLimit || now() - started >= timeLimit) {
          escalate(row, entry, 'self-rotation-overdue');
          save();
        }
        continue;
      }
      const job = [...sessions.jobs.values()].find(candidate => candidate.selfRotationId === pending.id);
      const rotation = job && index.rotations().find(item => item.successor === job.row.addr);
      if (pending.v2 && !job && v2().checkAttempt(row, pending.urgent)) {
        delete entry.request;
        save();
        continue;
      }
      if (rotation?.failedAt != null || job?.error && !rotation?.boundAt) {
        const reason = rotation?.failure ?? job.error;
        if (pending.v2) v2().fail(row, job, reason);
        fail(row, entry, reason, Boolean(pending.v2 && v2().pending(job.row.addr)));
      } else if (rotation?.boundAt != null && (!pending.v2 || rotation.verifiedAt != null)) {
        notifications.add({ id: `self-rotation:${pending.id}:complete`, type: `${row.role}-rotation-completed`,
          addr: rotation.successor, project: row.project, at: now(), ...(row.role === 'leader' && { logOnly: true }),
          text: `Loom ${row.role} 换班完成：${row.addr} → ${rotation.successor}。` });
        delete entry.request;
        entry.completed = true;
        save();
      } else if (!pending.v2 && now() - pending.at >= timeLimit) {
        if (job) {
          failHandover(job, 'self-rotation-overdue');
          fail(row, entry, 'self-rotation-overdue');
        } else {
          delete entry.request;
        }
        if (!pending.v2 && entry.escalated !== 'retry-exhausted') escalate(row, entry, 'self-rotation-overdue');
        save();
      } else if (!job && active(row) && !pendingRotation(row.project)) {
        if (!pending.urgent) {
          if (pending.v2 && !cleanBoundary(row.project)) continue;
          if (!pending.passive) {
            const view = await sessions.transport.inspect(sessions.targetBinding(row)).catch(() => undefined);
            if (view?.state !== 'idle' || view.active || view.userPrompt) continue;
          }
        }
        if (!pending.urgent && (missingWork(row, pending.note).length || pending.v2 && v2().missingStatus(row, pending.note).length)) {
          delete entry.request;
          entry.noteChanged = { id: pending.id, at: now(), reason: 'rotation-work-changed' };
          save();
          continue;
        }
        try {
          await spawn({ ...pending.profile, role: row.role, cwd: row.cwd, 'handover-from': row.addr,
            'trust-workspace': sessions.jobs.get(row.addr)?.autoTrustWorkspace,
            prompt: pending.v2 ? '首轮只核对原件。收到另一方确认后，执行交接单的首个动作。' : 'Complete the handover verification.' }, undefined, pending);
        } catch (error) {
          report(`Self rotation ${addr}: ${error.message}`);
          const recorded = [...sessions.jobs.values()].some(candidate => candidate.selfRotationId === pending.id);
          if (!recorded) fail(row, entry, error.code ?? 'spawn-failed');
        }
      }
    }
  }

  function decorate(message, row) {
    if (!row || !active(row) || message.startup) return [];
    const entry = state[row.addr];
    const shown = new Set(mail.messages.filter(item => item.target.addr === row.addr && !deliveryFailed(item))
      .flatMap(item => item.rotationNotices ?? []));
    const notices = [];
    if (entry && !entry.request && (!entry.signal?.v2 || !v2().checkAttempt(row, false))) {
      const failure = entry.noteChanged ?? entry.failures?.at(-1);
      const notice = failure ?? entry.signal;
      if (notice && !shown.has(notice.id)) {
        const action = entry.signal?.v2 ?
          `当前卡结算后，将结构化交接单写入 ${notePath(row)}，运行 "$LOOM_BIN" rotate --self，结束本轮。` :
          (entry.failures?.length ?? 0) >= 2 ? '已升级到监督者。' :
          `在安全点将当前判断写入 ${notePath(row)}，运行 "$LOOM_BIN" rotate --self，结束本轮。`;
        notices.push({ id: notice.id, text: failure ? `换班失败（${failure.reason}）。前任继续工作。${action}` :
          `换班提示：${rotationReasonText(notice.reason)}。${action}` });
      }
    }
    if (row.role === 'auditor') notices.push(...notifications.list(row.project, false, true)
      .filter(event => event.type === 'leader-rotation-completed' && event.at >= row.startedAt && !shown.has(event.id)));
    return notices;
  }

  return { request, propose, emergency, advance, decorate, holds: addr => Boolean(state[addr]?.request) };
}
