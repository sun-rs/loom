import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { runtimeDirectory } from '../cli/project.mjs';
import { CommandError } from '../cli/sessions.mjs';
import { spawnProfile } from '../cli/policy.mjs';
import { rotatingRoles } from '../index/index.mjs';
import { deliveryFailed } from '../inbox/message.mjs';
import { clip, oneLine } from '../handover/sources.mjs';
import { readText, writeState } from './io.mjs';

const timeLimit = 15 * 60_000;
const turnLimit = 3;
const maxNoteBytes = 12_000;
const validText = text => typeof text === 'string' && text.trim() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text);

export function selfRotation(project, { sessions, index, mail, notifications, now, spawn, inFlight, report }) {
  const directory = join(runtimeDirectory(project), 'rotation-notes');
  const stateFile = join(runtimeDirectory(project), 'self-rotation.json');
  const state = JSON.parse(readText(stateFile, '{}'));
  const save = () => writeState(stateFile, JSON.stringify(state) + '\n');
  const notePath = row => join(directory, row.addr + '.md');
  const active = row => row?.endedAt === null && rotatingRoles.includes(row.role) &&
    sessions.jobs.has(row.addr) && !sessions.jobs.get(row.addr).stopping &&
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

  function request(args, caller, external) {
    const actor = sessions.rows().find(row => row.addr === caller || row.pane === caller);
    const overrides = Object.fromEntries(['cli', 'model', 'effort'].filter(key => args[key] !== undefined)
      .map(key => [key, args[key]]));
    const override = Object.keys(overrides).length > 0;
    if (external ? args.self === true || typeof args.target !== 'string' :
        !actor || actor.endedAt !== null || !sessions.jobs.has(actor.addr) ||
        (args.self === true) === (typeof args.target === 'string') ||
        (args.target !== undefined || override) && actor.role !== 'super') {
      throw new CommandError('invalid-arguments', 'A managed Leader or Auditor can rotate itself. Only Super may select a target or override its profile.');
    }
    const row = args.self === true ? actor : sessions.resolve(args.target, caller);
    if (!active(row) || actor && row.project !== actor.project) throw new CommandError('not-ready', 'Choose an active Leader or Auditor in this project');
    if (args.reason !== undefined && (!validText(args.reason) || Buffer.byteLength(args.reason) > 512 || /[\r\n]/.test(args.reason)) ||
        Object.values(overrides).some(value => !validText(value))) throw new CommandError('invalid-arguments', 'Invalid rotation reason or runtime override');
    ensureNotes();
    const details = describe(row);
    if (args.prepare) return { rotation: { ...details, status: 'write-note' } };
    const entry = progress(row.addr);
    if (entry.request) return { rotation: { ...details, status: 'scheduled', requestId: entry.request.id,
      profile: entry.request.profile } };
    if ((entry.failures?.length ?? 0) >= 2 && !external && actor.role !== 'super') {
      throw new CommandError('rotation-retry-exhausted', 'Two handovers failed. Loom has notified the supervising role.');
    }
    const info = lstatSync(details.notePath, { throwIfNoEntry: false });
    const note = info?.isFile() && info.size <= maxNoteBytes ? readText(details.notePath, '') : '';
    if (!validText(note) || note.trimEnd().split(/\r?\n/).length > 60) {
      throw new CommandError('rotation-note-required', `Write your handoff judgment in ${details.notePath} (up to 60 lines and 12 KB)`);
    }
    const missing = missingWork(row, note);
    if (missing.length) throw new CommandError('rotation-work-unlisted', `List in-flight work in ${details.notePath}: ${missing.map(item => item.task ?? item.addr).join(', ')}`);
    const profile = { cli: row.cli, model: row.model, effort: row.effort, mode: row.backend, ...overrides };
    spawnProfile(project, { ...profile, role: row.role });
    entry.request = { id: randomUUID(), at: now(), note, notePath: details.notePath, reason: args.reason ?? entry.signal?.reason ?? 'handoff',
      profile, inheritFast: !override };
    delete entry.noteChanged;
    save();
    return { rotation: { ...details, status: 'scheduled', requestId: entry.request.id, profile } };
  }

  function propose(row, reason) {
    if (!active(row)) return;
    const entry = progress(row.addr);
    if (entry.signal || entry.request || entry.completed) return;
    ensureNotes();
    entry.signal = { id: randomUUID(), at: now(), reason };
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

  function fail(row, entry, reason) {
    const { id } = entry.request;
    const detail = clip(oneLine(reason), 160) || 'handover-failed';
    delete entry.request;
    (entry.failures ??= []).push({ id, at: now(), reason: detail });
    if (entry.failures.length >= 2) escalate(row, entry, detail, 'retry-exhausted');
    save();
  }

  async function advance() {
    for (const [addr, entry] of Object.entries(state)) {
      const row = sessions.rowFor(addr);
      if (!row || entry.completed) continue;
      const pending = entry.request;
      if (!pending) {
        const started = entry.failures?.at(-1)?.at ?? entry.signal?.at;
        if (!active(row) || started === undefined || entry.escalated) continue;
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
      if (rotation?.failedAt != null || job?.error && !rotation?.boundAt) {
        fail(row, entry, rotation?.failure ?? job.error);
      } else if (rotation?.boundAt != null) {
        notifications.add({ id: `self-rotation:${pending.id}:complete`, type: `${row.role}-rotation-completed`,
          addr: rotation.successor, project: row.project, at: now(), ...(row.role === 'leader' && { logOnly: true }),
          text: `Loom ${row.role} 换班完成：${row.addr} → ${rotation.successor}。` });
        delete entry.request;
        entry.completed = true;
        save();
      } else if (now() - pending.at >= timeLimit) {
        if (job) {
          await sessions.failSpawn(job, new Error('self-rotation-overdue'));
          fail(row, entry, 'self-rotation-overdue');
        } else {
          delete entry.request;
        }
        if (entry.escalated !== 'retry-exhausted') escalate(row, entry, 'self-rotation-overdue');
        save();
      } else if (!job && active(row) && !pendingRotation(row.project)) {
        const view = await sessions.transport.inspect(sessions.targetBinding(row)).catch(() => undefined);
        if (view?.state !== 'idle' || view.active || view.userPrompt) continue;
        if (missingWork(row, pending.note).length) {
          delete entry.request;
          entry.noteChanged = { id: pending.id, at: now(), reason: 'rotation-work-changed' };
          save();
          continue;
        }
        try {
          await spawn({ ...pending.profile, role: row.role, cwd: row.cwd, 'handover-from': row.addr,
            'trust-workspace': sessions.jobs.get(row.addr)?.autoTrustWorkspace,
            prompt: 'Take over this role at the recorded safe point.' }, undefined, pending);
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
    if (entry && !entry.request) {
      const failure = entry.noteChanged ?? entry.failures?.at(-1);
      const notice = failure ?? entry.signal;
      if (notice && !shown.has(notice.id)) {
        const action = (entry.failures?.length ?? 0) >= 2 ? '已升级到监督者。' :
          `在安全点将当前判断写入 ${notePath(row)}，运行 "$LOOM_BIN" rotate --self，结束本轮。`;
        notices.push({ id: notice.id, text: failure ? `换班失败（${failure.reason}）。前任继续工作。${action}` :
          `换班提示（${notice.reason}）。${action}` });
      }
    }
    if (row.role === 'auditor') notices.push(...notifications.list(row.project, false, true)
      .filter(event => event.type === 'leader-rotation-completed' && event.at >= row.startedAt && !shown.has(event.id)));
    return notices;
  }

  return { request, propose, advance, decorate, holds: addr => Boolean(state[addr]?.request) };
}
