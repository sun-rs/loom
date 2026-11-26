import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { projectText } from '../cli/artifacts.mjs';
import { inDirectory, runtimeDirectory } from '../cli/project.mjs';
import { CommandError } from '../cli/sessions.mjs';
import { isCredentialPath, exclusions } from '../evidence/git.mjs';
import { plannedCardPaths } from '../evidence/facts.mjs';
import { deliveryFailed } from '../inbox/message.mjs';
import { rotatingRoles } from '../index/index.mjs';
import { rotationSettings } from '../lib/rotation-settings.mjs';
import { readText, writeState } from './io.mjs';

const day = 86400_000;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$/;
const text = value => typeof value === 'string' && Boolean(value.trim()) && value.length <= 1000 && !/[\x00-\x1f\x7f]/.test(value);
const key = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
const invalid = message => { throw new CommandError('invalid-arguments', message); };
const git = (cwd, args) => {
  try {
    return execFileSync('/usr/bin/git', ['--no-optional-locks', ...args],
      { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 3000, maxBuffer: 512 * 1024 }).trimEnd();
  } catch { return ''; }
};
const lines = (heading, items) => [heading, ...items.map(item => '- ' + item)].join('\n');
const reasonOrder = ['verified-error', 'authority-ruling', 'project-change', 'phase-change', 'switch-density'];
const sha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
export const rotationReasonText = code => ({
  'verified-error': '加严核查期间再次发现经原件证实的事实错误',
  'authority-ruling': 'Super 登记了角色或授权口径变更',
  'project-change': '项目工作目录或 Git 根已变更',
  'phase-change': '结构化事件登记了新的阶段或目标',
  'switch-density': '近 24 小时的卡片、子系统切换或压缩达到阈值',
  'high-water': '当前上下文达到该 CLI 的绝对高水位',
  'context-window': '最近调用达到已配置的窗口比例', 'context-limit': '达到手动配置的上下文上限',
  'post-compaction': '压缩后的剩余上下文再次低于已配置的比例', gate: '已登记配置中的门禁边界',
  overreach: '发生未经授权的越权操作', fabrication: '原件证明有造假',
  'phase-failed': '同一阶段的换班已失败，需 Super 处理',
  'same-phase': '该角色在本阶段已换班', stagger: '另一位高级角色在本阶段已换班',
  'passive-blocker': '原会话被原生弹窗或额度限制长时间阻塞',
  'protected-ref-moved': '受保护分支移动，且无对应候选的门禁授权',
  'first-report-mismatch': '继任首报与交接原件不符', 'first-report-timeout': '继任未在时限内提交首报',
  'verification-cancelled': 'Super 取消等待核实的交接',
  'first-report-rejected': '另一方核对首报后拒绝接任', 'verification-timeout': '首报核实超过 30 分钟',
  'first-turn-missing-acknowledgement': '继任首轮未返回正确的交接确认码', 'successor-exited': '继任会话提前退出',
}[code] ?? code);
const open = message => !deliveryFailed(message) && !message.completion;
export const rotationStatePath = project => join(runtimeDirectory(project), 'rotation-v2.json');
export const handoverFields = ['Status', 'Case ledger', 'Rejected options and reasons', 'Unresolved items', 'User preferences and trust', 'Next action', 'Rerouted messages'];
export const missingHandoverFields = note => {
  const fields = new Map(note.split(/^#{1,3}\s+/m).slice(1).map(section => {
    const [label, ...body] = section.trim().split(/\r?\n/);
    return [label.replace(/:$/, '').toLowerCase(), body.join('\n').trim()];
  }));
  return handoverFields.filter(field => !fields.get(field.toLowerCase()));
};

export function switchDensity(records, usage, config, cli, at) {
  const recent = records.filter(item => item.at > at - day && item.at <= at);
  const cards = new Set(recent.map(item => item.card));
  const mainlines = new Set(recent.map(item => item.mainline).filter(Boolean));
  const paths = recent.flatMap(item => item.paths).filter(path =>
    !/^(?:docs?|tasks|\.project|ledger)(?:\/|$)/i.test(path) && !/\.(?:md|mdx|rst|adoc)$/i.test(path));
  const subsystems = new Set(paths.map(path => {
    const match = Object.keys(config.subsystemPrefixes).filter(prefix => path === prefix || path.startsWith(prefix + '/'))
      .sort((a, b) => b.length - a.length)[0];
    return match ? config.subsystemPrefixes[match] : path.includes('/') ? path.split('/', 1)[0] : '(root)';
  }));
  const compact = usage.compactions === null ? null :
    usage.afterCompaction.filter(item => item.at > at - day && item.at <= at).length;
  const relaxed = mainlines.size === 1 && recent.every(item => item.mainline) && subsystems.size === 1;
  const switching = cards.size > (relaxed ? config.singleMainlineCards : config.cards) || subsystems.size > config.subsystems;
  const compacting = compact >= config.compactions;
  return { cards: cards.size, subsystems: subsystems.size, compact, relaxed, cli,
    hit: config.densityRequiresCompaction ? switching && compacting : switching || compacting };
}

function factLines(text) {
  return new Map(text.split(/\r?\n/).flatMap(line => {
    const match = /^\s*(?:- )?(HEAD|Branch|Base SHA|WIP|Rulings): (.+)$/.exec(line);
    return match ? [[match[1], match[2].trim()]] : [];
  }));
}

function primaryEvidence(project, reference) {
  if (!text(reference) || isAbsolute(reference)) invalid('Use a project-relative primary evidence file, optionally with :LINE');
  const [, name, line] = /^(.+?)(?::([1-9]\d*))?$/.exec(reference);
  try {
    const path = realpathSync(resolve(project, name));
    const file = relative(project, path);
    if (!inDirectory(project, path) || isCredentialPath(name) || isCredentialPath(file) ||
        !statSync(path).isFile() || /^(?:\.project\/(?:loomd|relay|index)|tasks\/[^/]+\/RESULT\.md$)/i.test(file)) throw new Error();
    return file + (line ? ':' + line : '');
  } catch { invalid('Primary evidence must be an existing, project-local source file'); }
}

export function rotationPolicy(project, { now, sessions, mail, notifications, policy, propose, emergency }) {
  const path = rotationStatePath(project);
  let data = JSON.parse(readText(path, '{"projects":{},"sessions":{},"handovers":{},"events":{}}'));
  const config = () => rotationSettings(policy());
  const enabled = () => config().mode === 'v2';
  const scope = name => data.projects[name] ??= { phase: 0, markers: {}, failures: {}, audits: {}, corrections: [] };
  const role = addr => data.sessions[addr] ??= { reasons: {}, work: {} };
  const checkpoint = update => {
    const before = structuredClone(data);
    try {
      const result = update();
      const next = JSON.stringify(data);
      if (next !== JSON.stringify(before)) writeState(path, next + '\n');
      return result;
    } catch (error) { data = before; throw error; }
  };
  const current = addr => data.sessions[addr] ?? {};
  const pending = successor => data.handovers[successor];
  const live = (name, nameRole) => sessions.rows().findLast(row => row.project === name && row.role === nameRole &&
    row.endedAt === null && sessions.jobs.has(row.addr) && !sessions.jobs.get(row.addr).stopping &&
    sessions.routeParent(row.addr)?.addr === row.addr && !pending(row.addr)?.waiting);
  const event = (id, kind, details = {}) => data.events[id] ??= { id, kind, at: now(), ...details };
  const notice = (row, reason, uid, details, logOnly) => notifications.add({
    id: 'rotation-v2:' + key(row.project, row.addr, reason, uid), type: logOnly ? 'senior-rotation-observation' : 'needs-decision',
    at: now(), project: row.project, role: row.role, addr: row.addr, reason, text: details, ...(logOnly && { logOnly }),
  });
  const mark = (row, reason, id) => role(row.addr).reasons[reason] ??= id;
  const seniors = name => rotatingRoles.map(nameRole => live(name, nameRole)).filter(Boolean);
  function marker(name, type, id, sourceAt = now()) {
    const entry = scope(name);
    if (entry.markers[type] === id) return;
    const baseline = entry.markers[type] === undefined;
    entry.markers[type] = id;
    if (type === 'gate') return;
    if (baseline && !entry.phase && type !== 'completion') {
      entry.phase = 1;
      return;
    }
    entry.phase++;
    for (const row of seniors(name)) if (row.startedAt <= sourceAt) mark(row, 'phase-change', id);
  }

  function syncMarkers(name) {
    scope(name).observedAt ??= now();
    for (const item of notifications.list(name, false, true)) {
      if (!['gate-completed', 'project-completed'].includes(item.type) || data.events[item.id]) continue;
      event(item.id, item.type, { project: name });
      if (item.type === 'gate-completed') marker(name, 'gate', item.gate);
      else if (item.phase) marker(name, 'phase', item.phase, item.at);
      else if (item.at >= scope(name).observedAt) marker(name, 'completion', item.id, item.at);
    }
  }

  function recordAudit(name, card, verdict, id, row, sourceAt = now()) {
    if (data.events[id]) return;
    event(id, 'audit-verdict', { project: name, card, verdict, actor: row.addr });
    const state = scope(name);
    const streak = state.audits[card] = { count: verdict === 'return' ? (state.audits[card]?.count ?? 0) + 1 : 0,
      at: sourceAt };
    if (streak.count === config().auditReturns) notice(row, 'audit-returns', id,
      `Loom: ${card} 连续 ${streak.count} 次审计退回。请 Super 评估换班或重设计。`);
  }

  function commitPaths(cwd, base, head) {
    return sha.test(base) && sha.test(head) && base !== head ?
      git(cwd, ['diff', '--name-only', '-z', base, head, '--', ...exclusions]).split('\0').filter(Boolean) : [];
  }

  function readWork(row, state, at) {
    for (const worker of sessions.rows().filter(item => item.role === 'worker' && item.project === row.project &&
        item.task && item.startedAt >= Math.max(row.startedAt, at - day) &&
        sessions.routeParent(item.parent)?.addr === row.addr)) {
      const job = sessions.jobs.get(worker.addr);
      if (!job) continue;
      const entry = state.work[worker.addr] ??= { at: worker.startedAt, card: worker.task, mainline: scope(row.project).markers.goal ?? worker.wave,
        paths: plannedCardPaths(job.prompt), commits: [] };
      const done = mail.messages.find(item => item.id === job.firstId)?.completion;
      const end = done?.git?.head ?? done?.head;
      const start = job.cardStart?.head ?? worker.baseCommit;
      if (end && start && end !== start && /^[a-f0-9]{7,64}$/i.test(start) && /^[a-f0-9]{7,64}$/i.test(end) &&
          !entry.commits.includes(end)) {
        entry.paths = [...new Set([...entry.paths, ...git(worker.cwd, ['diff', '--name-only', '-z', start, end, '--', ...exclusions])
          .split('\0').filter(Boolean)])];
        entry.commits.push(end);
        entry.at = Math.max(entry.at, done.at);
      }
    }
    for (const id of Object.keys(state.work)) if (state.work[id].at <= at - day) delete state.work[id];
  }

  function observe(row, usage, snapshot, safe) {
    if (!enabled() || !rotatingRoles.includes(row.role)) return;
    const at = now();
    const settings = config();
    const { reason, id } = checkpoint(() => {
      syncMarkers(row.project);
      const state = role(row.addr);
      const partition = scope(row.project);
      const nativeCwd = isAbsolute(usage.cwd ?? '') ? usage.cwd : row.cwd;
      const root = inDirectory(project, nativeCwd) ? git(nativeCwd, ['rev-parse', '--show-toplevel']) : '';
      const identity = [nativeCwd, root];
      const prior = partition[row.role];
      if (prior && (prior.cwd !== identity[0] || prior.git !== identity[1])) {
        if (partition.workspaceChangedAt !== at) partition.phase++;
        partition.workspaceChangedAt = at;
        mark(row, 'project-change', key(...identity, partition.phase));
      }
      partition[row.role] = { cwd: identity[0], git: identity[1] };
      if (usage.nativeVersion && usage.nativeVersion !== state.version) {
        if (state.version) {
          state.versionChange = usage.nativeVersion;
          event('version:' + key(row.addr, state.version, usage.nativeVersion), 'passive',
            { project: row.project, addr: row.addr, version: usage.nativeVersion, reason: 'version-change' });
        }
        const handover = pending(row.addr);
        const priorVersion = current(handover?.predecessor).version;
        if (handover?.completedAt && priorVersion && priorVersion !== usage.nativeVersion) {
          event('passive-rotation:' + row.addr, 'passive-rotation',
            { project: row.project, addr: row.addr, reason: 'cli-version-change', before: priorVersion, version: usage.nativeVersion });
        }
        state.version = usage.nativeVersion;
      }
      readWork(row, state, at);
      if (row.role === 'auditor') for (const message of mail.messages) {
        if (!message.gateId || message.target.addr !== row.addr || !message.received || !message.completion?.body ||
            message.completion.unconfirmed || message.completion.at <= at - day) continue;
        const verdict = /^(?:\*{0,2})(REJECT|APPROVE|PASS)\b/i.exec(message.completion.body.trimStart())?.[1].toUpperCase();
        if (verdict) recordAudit(row.project, message.gateId, verdict === 'REJECT' ? 'return' : 'pass', message.id, row, message.completion.at);
        state.work[message.id] ??= { at: message.completion.at, card: message.gateId,
          mainline: partition.markers.goal ?? message.gateProject,
          paths: [...new Set([...(message.gatePaths ?? []), ...commitPaths(project, message.gateBase, message.gateCandidate)])] };
      }
      const density = switchDensity(Object.values(state.work), usage, settings, row.cli, at);
      state.metrics = { ...density, cli: row.cli };
      if (density.hit) mark(row, 'switch-density', key(partition.phase, row.addr));
      const threshold = settings.highWaterTokens[row.cli];
      if (threshold && (usage.tokens ?? usage.inputTokens) >= threshold && !state.highWater) {
        state.highWater = { at, tokens: usage.tokens ?? usage.inputTokens, threshold };
        notice(row, 'high-water', row.addr, `Loom: ${row.role} 到达绝对上下文高水位，转为只读核对，等待干净边界。`, true);
      }
      if (snapshot?.userPrompt || snapshot?.reason === 'rate-limit' || snapshot?.runtimeStatus?.reason === 'rate-limit' || ['quota-wait', 'auth-expired'].includes(snapshot?.health)) {
        state.blockedSince ??= at;
        if (at - state.blockedSince >= settings.passiveBlockMs && state.blockedSince !== state.handledBlock) {
          state.handledBlock = state.blockedSince;
          const incident = event('passive:' + key(row.addr, state.blockedSince), 'passive',
            { addr: row.addr, project: row.project, reason: 'blocked' });
          notice(row, 'passive-blocker', incident.id, `Loom: ${row.role} 被弹窗或额度阻塞，请评估被动换班。`);
        }
      } else if (state.blockedSince !== undefined) delete state.blockedSince;
      const reason = reasonOrder.find(item => state.reasons[item]) ?? (state.highWater && 'high-water');
      return { reason, id: state.reasons[reason] ?? row.addr };
    });
    if (current(row.addr).frozen) {
      const incident = current(row.addr).frozen;
      if (current(row.addr).abortedIncident !== incident.id && !blocked(row, true)) emergency(row, emergencyNote(row, incident), incident);
      return;
    }
    if (!reason || !safe || snapshot?.state !== 'idle' || snapshot.active || snapshot.userPrompt) return;
    const lock = blocked(row, false);
    if (lock) {
      notice(row, 'rotation-deferred', scope(row.project).phase, `Loom: ${row.role} 暂缓换班（${rotationReasonText(lock)}），请 Super 复核。`);
      return;
    }
    if (propose(row, reason, { v2: true })) notice(row, reason, id, `Loom: ${row.role} 在干净边界建议换班，因为${rotationReasonText(reason)}。`, true);
  }

  function emergencyNote(row, incident) {
    return facts(row, handoverFields.flatMap(field => [`## ${field}`,
      field === 'Status' ? '紧急交接。' + incident.detail :
      field === 'Case ledger' ? `账本尚未由前任填写。先读 .project/rulings.md 全文，再核对事故原件 ${incident.evidence}。` :
      field === 'Next action' ? '收到核实确认后向 Super 报告事故处理状态及待裁决事项。' : '待另一方核对原件补齐。']));
  }

  function authorizeGate(name, gate, candidate) {
    if (!sha.test(candidate)) invalid('Provide the full candidate SHA');
    return checkpoint(() => event('gate-authorization:' + key(name, gate, candidate), 'gate-authorization',
      { project: name, gate, candidate }));
  }

  function checkProtectedRefs() {
    const configured = config().protectedRefs;
    if (!configured.length) return;
    const rows = sessions.rows().filter(row => row.role === 'leader');
    for (const name of new Set(rows.length ? rows.map(row => row.project) : [project])) {
      const row = live(name, 'leader');
      const incidents = checkpoint(() => {
        const partition = scope(name);
        const refs = partition.refs ??= {};
        const found = [];
        for (const ref of configured) {
          const head = git(project, ['for-each-ref', '--format=%(refname)%00%(objectname)', ref])
            .split('\n').map(line => line.split('\0')).find(([name]) => name === ref)?.[1] ?? '';
          if (!Object.hasOwn(refs, ref)) {
            if (sha.test(head)) refs[ref] = { head, at: now() };
            continue;
          }
          const before = refs[ref];
          if (before.head === head) continue;
          const authorization = head && Object.values(data.events).find(item => item.kind === 'gate-authorization' &&
            item.project === name && item.candidate === head && item.at >= before.at && !item.consumed);
          refs[ref] = { head, at: now() };
          if (authorization && git(project, ['merge-base', before.head, head]) === before.head) {
            authorization.consumed = ref;
            marker(name, 'gate', authorization.gate);
            continue;
          }
          const incident = event('protected-ref:' + key(name, ref, before.head, head, before.at), 'incident',
            { project: name, addr: row?.addr, verdict: 'protected-ref-moved', evidence: ref,
              detail: `${ref}: ${before.head || 'missing'} → ${head || 'missing'}` });
          if (row) role(row.addr).frozen ??= incident;
          found.push(incident);
        }
        return found;
      });
      for (const incident of incidents) {
        const recipient = row ?? { addr: 'leader', role: 'leader', project: name };
        notice(recipient, 'p0-incident', incident.id,
          `Loom: ${rotationReasonText(incident.verdict)}。 ${incident.detail}`);
        if (row && current(row.addr).abortedIncident !== incident.id && !blocked(row, true)) emergency(row, emergencyNote(row, incident), incident);
      }
    }
  }

  function attemptFailed(row, reason, id) {
    checkpoint(() => {
      const state = scope(row.project);
      if (state.failures[state.phase]) return;
      state.failures[state.phase] = id;
      notice(row, 'handover-failed', id, `Loom: ${row.role} 换班失败，同阶段暂停换班（${reason}）。`);
    });
  }

  function blocked(row, urgent) {
    const state = scope(row.project);
    if (state.failures[state.phase]) return 'phase-failed';
    if (urgent) return;
    if (state.last && state.last.phase >= state.phase) return state.last.role === row.role ? 'same-phase' : 'stagger';
  }

  function checkStart(row, handoff) {
    if (!enabled() && !handoff?.v2 || !rotatingRoles.includes(row.role)) return;
    const lock = blocked(row, handoff?.urgent);
    if (lock) {
      notice(row, 'rotation-deferred', scope(row.project).phase, `Loom: ${row.role} 暂缓换班（${lock}），请 Super 复核。`);
      throw new CommandError('rotation-phase-locked', rotationReasonText(lock));
    }
    if (!handoff?.v2) throw new CommandError('rotation-note-required', 'Use loom rotate with a structured v2 handover note.');
    if (!handoff.urgent && !live(row.project, row.role === 'leader' ? 'auditor' : 'leader')) {
      throw new CommandError('not-ready', 'Start the other senior role before rotating');
    }
    return { phase: scope(row.project).phase };
  }

  function begin(row, job, phase) {
    return checkpoint(() => {
      const record = data.handovers[job.row.addr] ??= { project: row.project, predecessor: row.addr, role: row.role,
        phase, waiting: true, at: now(), newProfile: [job.row.cli, job.row.model], oldProfile: [row.cli, row.model] };
      role(row.addr).holding = job.row.addr;
      role(job.row.addr).checking = true;
      return record;
    });
  }

  function ready(row, body, deliveryId) {
    return checkpoint(() => {
      const item = pending(row.addr);
      item.report ??= { deliveryId, digest: key(body), at: now() };
      return item;
    });
  }

  function verificationTimeout(row, item) {
    const timeout = item.report && !item.verification && now() - item.report.at >= config().verifyTimeoutMs;
    if (timeout && !item.verificationTimedOutAt) checkpoint(() => {
      item.verificationTimedOutAt = now();
      notice(row, 'verification-timeout', row.addr, `Loom: ${row.role} ${row.addr} 的首报等待另一方核实已达时限，请 Super 处理。交接继续待定。`);
    });
  }

  function fail(row, job, reason) {
    return checkpoint(() => {
      const record = pending(job.row.addr);
      if (!record || record.failed || record.completedAt) return;
      record.failed = { at: now(), reason };
      record.waiting = false;
      const predecessor = role(record.predecessor);
      delete predecessor.holding;
      if (reason === 'verification-cancelled' && predecessor.frozen) predecessor.abortedIncident = predecessor.frozen.id;
      delete role(job.row.addr).checking;
      if (reason !== 'verification-cancelled') scope(row.project).failures[record.phase] = job.row.addr;
      notice(row, 'handover-failed', job.row.addr,
        `Loom: ${row.role} 已回退前任（${rotationReasonText(reason)}）。`);
    });
  }

  function savePlan(row, messages) {
    checkpoint(() => { pending(row.addr).messages ??= messages; });
  }

  function finish(row, messages) {
    return checkpoint(() => {
      const record = pending(row.addr);
      record.completedAt ??= now();
      record.waiting = false;
      record.messages ??= messages;
      const state = scope(row.project);
      state.last = { phase: record.phase, role: row.role, successor: row.addr };
      delete role(row.addr).checking;
      delete role(record.predecessor).holding;
      role(record.predecessor).retired = row.addr;
      const predecessor = current(record.predecessor);
      if (predecessor.handledBlock || record.oldProfile.some((value, index) => value !== record.newProfile[index]) ||
          predecessor.versionChange) {
        event('passive-rotation:' + row.addr, 'passive-rotation', { project: row.project, addr: row.addr,
          reason: predecessor.handledBlock ? 'blocked' : 'profile-change' });
      }
    });
  }

  const restricted = addr => {
    const state = current(addr);
    return Boolean(state.frozen || state.holding || state.checking || state.retired || state.highWater);
  };

  function repositoryFacts(row) {
    const head = git(row.cwd, ['rev-parse', '--verify', 'HEAD']) || 'unavailable';
    const branch = git(row.cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']) || '(detached or unavailable)';
    const diff = git(row.cwd, ['diff', '--no-ext-diff', '--numstat', 'HEAD', '--', ...exclusions]);
    const wip = diff.split('\n').filter(Boolean).reduce((sum, line) => {
      const [added, deleted] = line.split('\t');
      return sum + (Number(added) || 0) + (Number(deleted) || 0);
    }, 0);
    const untracked = git(row.cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...exclusions]).split('\0').filter(Boolean).length;
    const rulings = (projectText(project, 'rulings.md') ?? '').match(/^#{1,3}\s+\S.*$/gm)?.map(line => line.replace(/^#+\s+/, '')) ?? [];
    return { HEAD: head, Branch: branch, 'Base SHA': row.baseCommit ?? 'unavailable', WIP: `${wip} lines, ${untracked} untracked files`,
      Rulings: rulings.length ? rulings.join(' | ') : 'none' };
  }

  function missingStatus(row, note) {
    const status = note.split(/^##\s+Status\s*$/im)[1]?.split(/^##\s+/m)[0] ?? '';
    const parsed = factLines(status);
    const expected = repositoryFacts(row);
    return ['Branch', 'Base SHA', 'WIP'].filter(label => parsed.get(label) !== expected[label]);
  }

  function reportMatches(job, body) {
    const observed = factLines(body);
    return Object.entries(job.rotationFacts ?? {}).every(([label, expected]) => observed.get(label) === expected);
  }

  function facts(row, extra = []) {
    const state = scope(row.project);
    const workers = sessions.rows().filter(item => item.project === row.project && item.role === 'worker' && item.endedAt === null);
    const waiting = mail.messages.filter(item => open(item) && !item.startup && item.target.addr === row.addr);
    const continuations = mail.messages.filter(item => (item.continuationMembers || item.replyTo) &&
      sessions.rowFor(item.target.addr)?.project === row.project && open(item));
    const ruling = Object.values(data.events).findLast(item => item.project === row.project && item.kind === 'ruling');
    return [
      '## 当前事实卡 / Current facts',
      ...Object.entries(repositoryFacts(row)).map(([label, value]) => `${label}: ${value}`),
      '裁决原件: .project/rulings.md（核对全部在力条目）',
      lines('在途波次', workers.map(item => [item.wave, item.task, item.addr].filter(Boolean).join(' '))),
      lines('在途续作', [...new Set([...waiting, ...continuations])].map(item => `${item.id} → ${item.target.addr}`)),
      `最新裁决: ${ruling ? ruling.detail + ' (' + ruling.evidence + ')' : '（无登记裁决）'}`,
      `阶段: ${state.markers.goal ?? state.markers.phase ?? state.markers.completion ?? state.markers.gate ?? 'initial'}`,
      ...extra,
    ].join('\n');
  }

  function decorate(message, row, usage) {
    if (!enabled() || !row || !rotatingRoles.includes(row.role) || message.startup) return [];
    const prior = mail.messages.filter(item => item.target.addr === row.addr && item.received && !deliveryFailed(item));
    const last = prior.findLast(item => item.completion)?.completion.at ?? row.startedAt;
    const shown = new Set(prior.flatMap(item => item.rotationNotices ?? []));
    const compact = usage?.afterCompaction.findLast(item => item.at != null && item.at <= now());
    const triggers = [
      ...(compact && compact.at >= last ? [key(row.addr, 'compact', compact.at)] : []),
      ...(now() - last >= config().longIdleMs ? [key(row.addr, 'idle', last)] : []),
    ].filter(id => !shown.has(id));
    const state = current(row.addr);
    const notes = triggers.map((id, i) => ({ id, text: i === 0 ? facts(row) : '' }));
    if (state.errors >= 1) notes.push({ id: key(row.addr, 'strict', message.id),
      text: '加严模式：每个结论现场核对原件，并注明原件路径与行号。' });
    if (state.highWater) notes.push({ id: key(row.addr, 'read-only', message.id),
      text: '只读核对：不作新决定。到干净边界后按换班提示处理。' });
    return notes;
  }

  function admin(args, actor, external = false) {
    actor ??= external ? { role: 'super', addr: 'super', project: args.project ?? project } : undefined;
    if (!enabled() || !actor || !['super', ...rotatingRoles].includes(actor.role)) {
      throw new CommandError('permission-denied', 'Rotation v2 registration requires an authenticated senior role and v2 policy');
    }
    const { action, target, id, detail, evidence, verdict, phase, goal, version } = args;
    const superOnly = ['scope', 'ruling', 'profile', 'abort'];
    if (superOnly.includes(action) && actor.role !== 'super') throw new CommandError('permission-denied', 'Only Super can register this event');
    const row = target && sessions.resolve(target, actor.addr);
    if (row && (row.project !== actor.project || !rotatingRoles.includes(row.role))) invalid('Choose a senior role in this project');
    const opposite = row && actor.role !== row.role && rotatingRoles.includes(actor.role);
    if (restricted(actor.addr) && !['spot-check', 'verify'].includes(action)) throw new CommandError('permission-denied', 'The role is in read-only verification');
    const record = checkpoint(() => {
      if (action === 'scope') {
        if (Boolean(phase) === Boolean(goal) || !idPattern.test(phase ?? goal)) invalid('Use exactly one of --phase or --goal');
        marker(actor.project, phase ? 'phase' : 'goal', phase ?? goal);
        return { phase: scope(actor.project).phase };
      }
      if (action === 'audit') {
        if (!idPattern.test(id ?? '') || !['return', 'pass'].includes(verdict) || actor.role !== 'auditor') {
          invalid('Auditor must supply --id CARD --verdict return|pass');
        }
        recordAudit(actor.project, id, verdict, 'audit:' + key(actor.addr, id, evidence, detail), actor);
        return scope(actor.project).audits[id];
      }
      if (!row || !text(detail)) invalid('Specify --target and --detail');
      const state = role(row.addr);
      if (action === 'abort') {
        const handover = pending(row.addr);
        if (!handover?.waiting || handover.verification || !handover.verificationTimedOutAt) invalid('Choose a handover whose verification timed out');
        handover.cancelled = true;
        return { successor: row.addr, cancelled: true };
      }
      if (action === 'correction') {
        if (actor.role !== 'super' && (actor.addr !== row.addr || !mail.messages.some(message => message.id === id &&
          message.target.addr === row.addr && message.received && (message.userWake || message.from?.role === 'super')))) {
          throw new CommandError('permission-denied', 'Self-registration requires --id of a received user or Super delivery');
        }
        const incident = event('correction:' + key(row.addr, id ?? detail), action, { addr: row.addr, project: row.project, detail });
        const corrections = scope(row.project).corrections;
        if (!corrections.some(item => item.id === incident.id)) corrections.push(incident);
        const count = corrections.filter(item => item.addr === row.addr && item.at > now() - day).length;
        if (count === config().corrections) notice(row, 'user-corrections', incident.id, `Loom: ${row.role} 在 24 小时内被用户纠正 ${count} 次。`);
        return { count };
      }
      if (action === 'profile') {
        if (!text(version)) invalid('Supply --version and a description of the runtime change');
        state.versionChange = version;
        return event('profile:' + key(row.addr, version), 'passive', { addr: row.addr, project: row.project, version, detail });
      }
      const source = primaryEvidence(project, evidence);
      const entry = 'registration:' + key(action, row.addr, id, source, detail, verdict);
      if (data.events[entry]) return data.events[entry];
      const registration = { actor: actor.addr, addr: row.addr, project: row.project, evidence: source, detail, verdict, ...(id && { subject: id }) };
      if (action === 'spot-check' && id && !mail.messages.some(message => message.id === id &&
          message.target.addr === actor.addr && message.gatePacket && message.received)) {
        invalid('Spot check ID must identify a gate packet received by this Auditor');
      }
      if (action === 'ruling') {
        mark(row, 'authority-ruling', entry);
      } else if (action === 'verify') {
        if (!opposite || !['pass', 'fail'].includes(verdict) || !pending(row.addr)?.report || !pending(row.addr)?.waiting || pending(row.addr)?.cancelled) {
          throw new CommandError('permission-denied', 'Only the current other senior may verify a received first report');
        }
        if (pending(row.addr).verification && pending(row.addr).verification.verdict !== verdict) invalid('The first report already has a verdict');
        pending(row.addr).verification = { ...registration, id: entry, at: now() };
      } else if (action === 'rule-change') {
        if (!opposite && actor.role !== 'super') invalid('The other senior or Super must approve a same-day rule change');
        if (!pending(row.addr)?.completedAt || !['merge', 'concurrency', 'budget'].includes(id)) invalid('Supply --id merge|concurrency|budget for the successor');
        (state.confirmations ??= {})[id] = entry;
      } else if (['error', 'incident', 'spot-check'].includes(action)) {
        if (action === 'spot-check' ? actor.role !== 'auditor' || !opposite || !['ok', 'error'].includes(verdict) :
            !opposite && actor.role !== 'super' && !(action === 'error' && actor.addr === row.addr)) {
          throw new CommandError('permission-denied', 'Super, the other senior or the affected role must attach original evidence');
        }
        if (action === 'incident') {
          if (!['overreach', 'fabrication'].includes(verdict)) invalid('Use --verdict overreach|fabrication for P0');
          state.frozen ??= { id: entry, at: now(), verdict, evidence: source, detail };
        } else if (action === 'error' || verdict === 'error') {
          const issue = key(source, detail.trim().toLowerCase());
          const evidence = state.errorEvidence ??= {};
          if (!evidence[issue]) {
            evidence[issue] = entry;
            state.errors = (state.errors ?? 0) + 1;
            if (state.errors >= 2) mark(row, 'verified-error', entry);
          }
        }
      } else invalid('Unknown rotation policy action');
      return event(entry, action, registration);
    });
    if (action === 'incident') {
      notice(row, 'p0-incident', record.id, `Loom: ${row.role} 写入已冻结（${verdict}）。原件 ${record.evidence}。`);
      const lock = blocked(row, true);
      if (!lock && current(row.addr).abortedIncident !== record.id) emergency(row, emergencyNote(row, record), record);
    }
    return { rotationPolicy: record };
  }

  function ruleChange(actor, kind) {
    const record = pending(actor?.addr);
    if (record?.completedAt && new Date(now()).toDateString() === new Date(record.completedAt).toDateString() && !current(actor.addr).confirmations?.[kind]) {
      throw new CommandError('permission-denied', `A same-day ${kind} change requires confirmation from the other senior or Super`);
    }
  }

  return { enabled, observe, admin, passiveEligible: addr => Boolean(current(addr).handledBlock || current(addr).versionChange), authorizeGate, checkProtectedRefs,
    verificationTimeout, repositoryFacts, missingStatus, reportMatches,
    firstReportExpired: record => !record.report && now() - record.at >= config().firstReportTimeoutMs,
    canRequest: addr => Boolean(current(addr).highWater && !current(addr).holding && !current(addr).frozen),
    checkStart, begin, ready, pending, fail, finish, savePlan, restricted, facts, decorate, ruleChange,
    deliverable: message => {
      const state = current(message.target.addr);
      if (state.holding || state.frozen || state.retired) return false;
      if (message.startup || message.rotationActivation) return true;
      if (!pending(message.target.addr)?.completedAt) return true;
      return mail.messages.some(item => item.target.addr === message.target.addr && item.rotationActivation &&
        item.received && !deliveryFailed(item));
    },
    checkAttempt: blocked, attemptFailed, snapshot: name => ({ project: name, phase: data.projects[name]?.phase ?? 0,
      spotChecks: Object.values(data.events).filter(item => item.project === name && item.kind === 'spot-check')
        .reduce((counts, item) => ({ ...counts, [item.verdict]: counts[item.verdict] + 1 }), { ok: 0, error: 0 }),
      handovers: Object.values(data.handovers).filter(item => item.project === name),
      passive: Object.values(data.events).filter(item => item.project === name && /^passive/.test(item.kind)),
      roles: seniors(name).map(row => ({ addr: row.addr, role: row.role, ...current(row.addr) })) }) };
}
