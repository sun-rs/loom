import { basename } from 'node:path';
import { attentionBoard, newestNoticeFirst, routineSuperReceipt } from '../daemon/status-board.mjs';
import { pyramidSampleReady } from './cost.mjs';
import { accountRows, duration } from './status-accounts.mjs';
import { memoryLabel, workerMetricsLabel } from './status.mjs';
import { box, columns, inside, meter, pad, row, safe, table, theme, truncate, widthOf, wrap } from './status-layout.mjs';

export const pages = ['Board', 'Workers', 'Gates', 'Notices', 'Cost'];
export const footer = '↑↓ select  Enter detail  h hist  g grep  m mem  r refresh  q quit  ? help';
const show = value => value == null || value === '' ? '—' : safe(value);
const short = value => show(value).slice(0, 8);
const shortAddress = value => {
  const addr = show(value);
  const uuidStart = /^(?:(?:loom|oar)-)?([\da-f]{8})(?=-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$)/i.exec(addr);
  return uuidStart ? uuidStart[1] : short(addr);
};
const tokenCount = new Intl.NumberFormat('en-US');
const itemFor = (id, title, fields) => ({ id, title, fields });
const age = (at, now) => duration(at == null ? NaN : now - at);
const tones = new Map([
  ...['idle', 'idle-warm', 'working', 'ready', 'running', 'busy', 'completed', 'PASS', 'DONE'].map(state => [state, 'good']),
  ...['starting', 'stalled', 'awaiting-user', 'quota-wait', 'BLOCKED'].map(state => [state, 'warn']),
  ...['stuck', 'refused', 'auth-expired', 'silent-hang', 'REJECT', 'FAILED'].map(state => [state, 'bad']),
]);
const badge = (state, paint) => paint(tones.get(state) ?? 'muted', '[' + show(state) + ']');
const roleName = value => ({ leader: 'Leader', auditor: 'Auditor', super: 'Super', worker: 'Worker' })[value] ?? show(value);
const clickLine = (text, item) => ({ ...row(text), hits: [{ from: 1, to: widthOf(text), item }] });
const attentionLabels = {
  stalled: '投递停滞', refused: '投递被拒', 'awaiting-user': '等待用户', 'needs-decision': '需要决定',
  'quota-wait': '额度受限', 'auth-expired': '认证过期', 'rotation-overdue': '换班逾期', 'gate-wait': '门禁待处理',
};
const noticeLabels = {
  'needs-decision': '需要决定', 'session-liveness': '会话异常', 'session-exited': '会话结束',
  'leader-exited': 'Leader 退出', 'target-awaiting-user': '等待用户', 'delivery-stalled': '投递停滞',
  'super-delivery-receipt': '投递失败', 'super-delivery-reply': '投递回复',
  'consumption-pyramid': '成本金字塔', 'senior-tool-output-share': '工具输出占比',
  'senior-override-budget': '工具预算', 'project-completed': '项目完成',
  'leader-rotation-completed': '换班完成', 'auditor-rotation-completed': '换班完成',
  'audit-escalation': '审核升级', 'blocked-escalation': '阻塞升级', 'wave-timeout': '波次超时',
};
const alerts = new Set(['session-liveness', 'session-exited', 'leader-exited', 'target-awaiting-user', 'delivery-stalled',
  'super-delivery-receipt', 'consumption-pyramid', 'senior-tool-output-share', 'senior-override-budget',
  'audit-escalation', 'blocked-escalation', 'wave-timeout']);
const details = fields => fields.filter(([, value]) => value != null && value !== '');

export function overlayRows(view, width, height, paint) {
  const panelWidth = Math.min(width, 88, Math.max(38, width - 4));
  const text = view.fields ? details(view.fields).flatMap(([label, value]) =>
    [paint('accent', label), ...wrap(value, inside(panelWidth))]) :
    view.lines.flatMap(line => wrap(line, inside(panelWidth)));
  const maxContent = Math.max(1, height - (panelWidth < 5 ? 1 : 2));
  const offset = Math.min(view.offset ?? 0, Math.max(0, text.length - maxContent));
  const title = view.title + (text.length > maxContent ? ` · ${offset + 1}–${Math.min(text.length, offset + maxContent)}/${text.length}` : '');
  const block = box(title, text.slice(offset, offset + maxContent).map(line => row(line)), panelWidth, paint);
  if (!view.modal) return { rows: block, offset };
  const x = ' '.repeat(Math.floor((width - panelWidth) / 2));
  return { offset, rows: [...Array.from({ length: Math.max(0, Math.floor((height - block.length) / 2)) }, () => row()),
    ...block.map(line => row(x + line.text))] };
}

export function boardView(project, { board, error, offlineAccounts } = {}, { width = 80, now = Date.now(),
  page = 0, selected, showEnded = false, interactive = false, depth = 1 } = {}) {
  const paint = theme(depth);
  const marker = (item, text) => interactive && selected === item.id ? paint('selected', '› ' + text) : text;
  const tableLabel = (item, text) => interactive && selected !== item.id ? '  ' + text : marker(item, text);
  const panel = (w, title, lines) => box(title, lines.length ? lines : [row(paint('muted', 'None'))], w, paint);
  const connection = error ? 'disconnected' : board ? 'online' : 'connecting';
  const release = board?.release;
  const time = new Date(now).toISOString().slice(11, 19) + 'Z';
  const right = [release && 'loomd ' + short(release.id), time].filter(Boolean).join(' · ');
  const headerWidth = inside(width);
  const showClock = headerWidth >= widthOf(right) + widthOf(connection) + 15;
  const room = showClock ? headerWidth - widthOf(right) - 2 : headerWidth;
  const name = truncate('Loom · ' + safe(basename(project) || project), Math.max(0, room - widthOf(connection) - 3));
  const left = [name, connection].filter(Boolean).join(' · ');
  const header = box('', [row(pad(paint(error ? 'warn' : board ? 'good' : 'muted', left), room) +
    (showClock ? '  ' + paint('muted', right) : ''))], width, paint);
  const tabs = pages.map((title, i) => i === page ? paint('selected', `[${i + 1} ${title}]`) : paint('muted', `${i + 1} ${title}`));
  let x = 1;
  const tabHits = tabs.map((tab, page) => {
    const hit = { from: x, to: x + widthOf(tab) - 1, item: { page } };
    x = hit.to + 3;
    return hit;
  });
  header.push({ ...row(truncate(tabs.join('  '), width)), hits: tabHits }, row());
  const tail = (error ? [row(paint('warn', truncate(safe(error), width))), row()] : []);
  const frame = body => ({ header, body: [...tail, ...body], footer: truncate(footer, width) });
  const accounts = () => panel(width, 'Accounts', accountRows(offlineAccounts ?? board?.accounts, width, now, paint));
  if (!board) return frame(pages[page] === 'Cost' ? accounts() : []);

  const { roles = [], workers = [], delivery, gates = [], notifications, pyramids = [], layout, memory, workerMetrics = [] } = board;
  const samplesReady = pyramids.some(pyramidSampleReady);
  const warmingTypes = new Set(['consumption-pyramid', 'senior-tool-output-share']);
  const notices = (notifications?.last ?? [])
    .filter(notice => !routineSuperReceipt(notice) && (samplesReady || !warmingTypes.has(notice.type)))
    .sort(newestNoticeFirst);

  function roleCard(w, kind) {
    const selectedRoles = roles.filter(record => record.role === kind);
    const title = kind[0].toUpperCase() + kind.slice(1);
    const cards = selectedRoles.flatMap(role => {
      const slot = layout?.tabs?.[kind];
      const tab = !slot?.addr || slot.addr === role.addr ? slot : undefined;
      const item = itemFor('role:' + role.addr, title + ' · ' + show(role.addr), [
        ['Role', role.role], ['CLI / model', [role.cli, role.model].filter(Boolean).join(' · ')],
        ['State', role.state], ['Herdr space ID', layout?.space?.id], ['Herdr tab ID', tab?.id],
        ['Compactions', role.compactions], ['Rotation', role.rotationDue ? 'Rotate at card boundary' : undefined],
        ['Terminal ID', tab?.terminal], ['Session UUID', role.sessionId], ['Working directory', role.cwd],
        ['Transcript path', role.transcriptPath], ['Context input tokens', role.contextTokens],
        ['Model window', role.contextWindow != null && role.contextWindow > 0 ?
          (role.contextEstimated ? '≈' : '') + tokenCount.format(role.contextWindow) + ' tokens' : undefined],
      ]);
      let ctx = '—';
      if (Number.isFinite(role.contextPercent)) ctx = `${role.contextEstimated ? '≈' : ''}${Math.round(role.contextPercent)}%`;
      else if (Number.isFinite(role.contextTokens)) ctx = `${tokenCount.format(role.contextTokens)} tokens`;
      const context = clickLine(`Context ${ctx} · activity ${age(role.activityAt, now)} · ${shortAddress(role.addr)}`, item);
      return [row(marker(item, [show(role.cli), role.model && show(role.model)].filter(Boolean).join('·')) +
        '  ' + badge(role.state, paint), item), context,
      ...(role.rotationDue ? [row(paint('warn', 'Rotate at card boundary'))] : []),
      ...(role.awaitingHandover ? [row(paint('warn', 'Awaiting handover'))] : [])];
    });
    if (!cards.length) cards.push(row(paint('muted', 'Vacant')));
    return panel(w, title, cards);
  }

  const deliveryTotals = delivery?.allTime ?? delivery;
  const deliveryDetails = [
    ...[['Last hour', delivery], ['All-time', deliveryTotals]].flatMap(([label, group]) =>
      [[label, Object.entries(group?.counts ?? {}).map(([state, count]) => state + ' ' + count).join(' · ')],
        ['Oldest pending', group?.oldestAgeMs == null ? undefined : duration(group.oldestAgeMs)]]),
  ];
  const deliveryItem = itemFor('delivery', 'Delivery counts', deliveryDetails);
  const liveWorkers = workers.filter(worker => worker.endedAt == null && !['ended', 'released', 'offline', 'closed'].includes(worker.state));
  const openGates = gates.filter(gate => !gate.superseded && gate.completedAt == null && gate.waitingOn !== null)
    .map(gate => gate.waitingOn ? gate : { ...gate, waitingOn: 'auditor' });
  const attention = board.attention ?? attentionBoard({ counts: delivery?.counts ?? {}, allTime: deliveryTotals ?? { counts: {} } },
    roles, liveWorkers, openGates, notices, () => undefined);

  function boardSummary() {
    const severity = attention.length ? 'warn' : 'good';
    const health = paint(severity, 'Health · ' + (attention.length ? `${attention.length} 项待处理` : '正常'));
    const issues = attention.length ? attention.map(issue => {
      const label = attentionLabels[issue.kind] ?? show(issue.kind);
      const subject = issue.area === 'roles' ? roleName(issue.subject) : issue.subject && show(issue.subject);
      const waiting = issue.waitingOn && `Round ${issue.round} · ${roleName(issue.waitingOn)}`;
      const body = [label, issue.count, subject, waiting, issue.text && safe(issue.text)].filter(Boolean).join(' · ');
      const item = itemFor('attention:' + issue.id, label, [
        ['Subject', issue.subject], ['Address', issue.addr], ['Waiting on', waiting], ['Summary', issue.text],
        ...(issue.area === 'delivery' ? deliveryDetails : []),
      ]);
      return row(marker(item, paint(severity, body)), item);
    }) : [row(paint('good', '一切正常'))];
    const labels = Object.entries(delivery?.counts ?? {}).map(([state, count]) =>
      paint(count && ['refused', 'stalled'].includes(state) ? 'warn' : 'muted', state + ' ' + count));
    const idle = liveWorkers.filter(worker => worker.state === 'idle').length;
    const released = workers.filter(worker => ['released', 'offline'].includes(worker.state) || worker.releasedAt != null).length;
    const ended = workers.length - liveWorkers.length - released;
    const links = [
      [1, 'Workers', `${liveWorkers.length - idle} active · ${idle} idle · ${released} released${ended ? ' · ' + ended + ' ended' : ''}`],
      [2, 'Gates', `${openGates.length} open`],
      [3, 'Notices', `${notifications?.count ?? 0} unread`],
    ].map(([page, title, counts]) => {
      const item = { id: 'area:' + page, page };
      return row(marker(item, paint('accent', title) + ' · ' + counts), item);
    });
    return [row(health), ...panel(width, 'Needs attention', issues),
      ...columns(width, w => roleCard(w, 'leader'), w => roleCard(w, 'auditor')),
      ...panel(width, 'Areas', links),
      ...panel(width, 'Delivery · last hour', labels.length ? [row(marker(deliveryItem, labels.join(' · ')), deliveryItem)] : []),
      ...releaseLine()];
  }

  function workerTable(w) {
    const showRetention = workers.some(worker => worker.retention);
    const columns = [
      { title: 'Task', min: 8, priority: 0 }, { title: 'Wave', min: 8, priority: 3 }, { title: 'State', min: 5, priority: 2 },
      { title: 'CLI·model', priority: 1 }, { title: 'Addr', min: 8, priority: 3 },  { title: showRetention ? 'Warm' : 'Age' },
      ...(showRetention ? [{ title: 'Ctx', priority: 3 }] : []), { title: 'Result', priority: 3 },
      ...(showRetention ? [{ title: 'Cmp', priority: 5 }, { title: 'Reuse', priority: 6 }] : []),
    ];
    const records = showEnded ? workers : liveWorkers;
    const entries = records.map(worker => {
      const retention = worker.retention;
      const countdown = retention?.keep || retention?.keepWarm ? 'keep' : retention?.remainingMs != null ?
        Math.ceil(retention.remainingMs / 1000) + 's' : '—';
      const context = worker.contextPercent == null ? '—' : `${Math.round(worker.contextPercent)}%`;
      const reuse = worker.reuse === 'same-card-only' ? 'same card' : worker.reuse;
      const item = itemFor('worker:' + worker.addr, 'Worker · ' + show(worker.task), [
        ['Address', worker.addr], ['CLI / model', [worker.cli, worker.model].filter(Boolean).join(' · ')],
        ['Wave', worker.wave], ['State', worker.state], ['Tier', worker.workerTier], ['Result', worker.lastResult], ['Session UUID', worker.sessionId],
        ['Working directory', worker.cwd], ['Transcript path', worker.transcriptPath],
        ['Warm countdown', countdown], ['Context', context], ['Last result', worker.lastResultTag],
        ['Compactions', worker.compactions], ['Reuse', reuse === 'same card' ? 'Same card only' : reuse],
        ['Reuse limit', worker.retirementReason],
        ['Context after compaction', worker.contextAfterCompactionPercent == null ? undefined :
          `${Math.round(worker.contextAfterCompactionPercent)}%`],
        ['First report check', worker.firstReportCheck?.status],
        ['Check mismatch', worker.firstReportCheck?.mismatches?.join(', ')],
        ['Handoff reason', worker.handoff?.reason], ['Handoff sheet', worker.handoff?.path],
        ['Closure', retention?.closeReason], ['Release', retention?.releasedBy],
      ]);
      let state = show(worker.state);
      if (state === 'idle' && Number.isFinite(worker.releaseAt)) {
        state += worker.releaseAt > now ? ` · 释放于 ${duration(worker.releaseAt - now, Math.ceil)}` : ' · 待释放';
      }
      const tier = worker.workerTier && worker.workerTier !== 'sandbox' ? `[${show(worker.workerTier)}] ` : '';
      return { item, cells: [tableLabel(item, paint(worker.workerTier === 'host' ? 'warn' : 'text', tier) + show(worker.task)), show(worker.wave),
        paint(tones.get(worker.state) ?? 'muted', state), [show(worker.cli), worker.model && show(worker.model)].filter(Boolean).join('·'),
        shortAddress(worker.addr), showRetention ? countdown : age(worker.startedAt, now),
        ...(showRetention ? [context] : []), (worker.lastResultTag ?? worker.lastResult) ? badge(worker.lastResultTag ?? worker.lastResult, paint) : '—',
        ...(showRetention ? [show(worker.compactions), show(reuse)] : [])] };
    });
    const toggle = { id: 'workers:filter', toggle: true };
    const label = showEnded ? 'All workers · a Show live only' : `Live workers · a Show all (${workers.length - liveWorkers.length} inactive)`;
    return panel(w, `Workers · ${records.length}`, [row(marker(toggle, paint('accent', label)), toggle),
      ...entries.length ? table(inside(w), columns, entries, paint) : [row(paint('muted', 'No workers in this view'))]]);
  }

  const metrics = () => workerMetrics.length ? panel(width, 'Worker metrics by gate', workerMetrics.flatMap(entry =>
    wrap(workerMetricsLabel(entry), inside(width)).map(line => row(line)))) : [];

  function gateList(w) {
    const columns = [{ title: 'Gate', min: 12, priority: 2 }, { title: 'Round' }, { title: 'Verdict', min: 9 },
      { title: 'Waiting on', min: 10 }, { title: 'Age' }];
    const entries = gates.map(gate => {
      const verdict = gate.verdict;
      const status = gate.completedAt != null ? 'Closed' : gate.superseded ? 'Superseded' : 'Pending';
      const waiting = gate.waitingOn || (gate.waitingOn === undefined && status === 'Pending' ? 'auditor' : undefined);
      const item = itemFor(`gate:${gate.project ?? ''}:${gate.id}:${gate.round}`, 'Gate · ' + show(gate.id), [
        ['Gate ID', gate.id], ['Round', gate.round], ['Status', status], ['Waiting on', waiting && roleName(waiting)],
        ['Gate packet path', gate.packet], ['Full packet path', gate.fullPath], ['Verdict', verdict?.text ?? verdict?.line],
      ]);
      return { item, cells: [tableLabel(item, show(gate.id)), show(gate.round),
        verdict ? badge(verdict.tag ?? 'REPLY', paint) : paint('muted', status), roleName(waiting), age(gate.at ?? gate.verdict?.at, now)],
      below: verdict?.line && safe(verdict.line) };
    });
    return panel(w, 'Gates', entries.length ? table(inside(w), columns, entries, paint) : []);
  }

  function noticeList(w) {
    const columns = [{ title: 'Time', min: 8 }, { title: 'Severity' }, { title: 'Kind', min: 8 }, { title: 'Role' },
      { title: 'Read' }, { title: 'Summary', min: 9, priority: 0 }];
    const entries = notices.map(notice => {
      const type = notice.type;
      const kind = noticeLabels[type] ?? show(type).replaceAll('-', ' ');
      const severity = type === 'needs-decision' ? 'Decision' : alerts.has(type) ? 'Alert' : 'Info';
      const unread = notice.unread ?? Number(notice.takenAt == null);
      const count = notice.count ?? 1;
      const summary = [count > 1 && `×${count}`, safe(notice.text)].filter(Boolean).join(' ') || '—';
      const item = itemFor('notice:' + (notice.key ?? notice.id ?? `${type}:${notice.at}:${notice.text}`), kind, [
        ['Type', type], ['Role', roleName(notice.role)], ['Severity', severity], ['Occurrences', count], ['Unread', unread],
        ['Time', notice.at == null ? undefined : new Date(notice.at).toISOString()], ['Notice', notice.text],
      ]);
      return { item, cells: [tableLabel(item, notice.at == null ? '—' : age(notice.at, now) + ' ago'),
        paint(severity === 'Info' ? 'muted' : 'warn', severity), kind, roleName(notice.role),
        unread ? paint('accent', 'Unread') : paint('muted', 'Read'), summary] };
    });
    const lines = entries.length ? table(inside(w), columns, entries, paint) : [];
    if (notifications?.routineReceipts) lines.push(row(paint('muted', `${notifications.routineReceipts} routine delivery receipts`)));
    if (!samplesReady) lines.push(row(paint('muted', 'Pyramid / tool output share warming up')));
    return panel(w, `Super notices · ${notifications?.count ?? 0} unread`, lines);
  }

  function costPyramid(w) {
    const lines = pyramids.flatMap(pyramid => {
      const ready = pyramidSampleReady(pyramid);
      const label = ready ? pyramid.state : 'warming up';
      const totals = ['auditor', 'leader', 'worker'].map(role => {
        const { rawTokens, modelCalls } = pyramid.byRole?.[role] ?? {};
        return { role, rawTokens, caption: `${show(rawTokens)} tokens · ${show(modelCalls)} calls` };
      });
      const peak = Math.max(1, ...totals.map(total => total.rawTokens ?? 0));
      const size = Math.max(3, Math.min(20, inside(w) - 12 - Math.max(...totals.map(total => widthOf(total.caption)))));
      const item = itemFor('cost:' + pyramid.project, 'Cost pyramid · ' + show(pyramid.project), [
        ['Window', '1 hour'], ['State', label],
        ['Sampled at', pyramid.sampledAt == null ? undefined : new Date(pyramid.sampledAt).toISOString()],
        ['Inversions', ready ? pyramid.inversions?.map(({ higher, lower, metric }) =>
          `${higher} > ${lower} (${metric})`).join('\n') : undefined],
      ]);
      return [row(marker(item, (pyramids.length > 1 ? safe(basename(pyramid.project)) + ' · ' : '') +
        paint(ready ? label === 'inverted' ? 'warn' : 'good' : 'muted', label)), item),
      ...totals.map(({ role, rawTokens, caption }) => row(pad(role, 7) + ' ' +
        meter(100 * (rawTokens ?? 0) / peak, size, paint) + '  ' + caption))];
    });
    for (const entry of memory ?? []) {
      lines.push(row([(memory.length > 1 ? safe(basename(entry.project)) : 'Session memory'), memoryLabel(entry)].join(' · ')));
    }
    return panel(w, 'Cost pyramid · 1h', lines.length ? lines : [row(paint('muted', 'warming up'))]);
  }

  function releaseLine() {
    if (!release) return [];
    const warnings = release.warnings ?? [];
    const item = itemFor('release', 'Release · ' + show(release.id), [
      ['Project directory', project], ['loomd release ID', release.id], ['Release root', release.root],
      ['Managed CLI path', release.cli], ['Active release', release.active],
      ...warnings.map(warning => [show(warning.role), [warning.reason, warning.path].filter(Boolean).join('\n')]),
    ]);
    return [row(marker(item, 'Release · loomd ' + short(release.id)) +
      (warnings.length ? ' · ' + paint('warn', warnings.length + ' path warnings') : ''), item)];
  }

  switch (pages[page]) {
    case 'Workers': return frame([...workerTable(width), ...metrics()]);
    case 'Gates': return frame(gateList(width));
    case 'Notices': return frame(noticeList(width));
    case 'Cost': return frame([...costPyramid(width), ...accounts()]);
    default: return frame(boardSummary());
  }
}

export function boardLines(project, snapshot, options) {
  const { header, body, footer: hints } = boardView(project, snapshot, options);
  return [...header.map(line => line.text), ...body.map(line => line.text), hints];
}
