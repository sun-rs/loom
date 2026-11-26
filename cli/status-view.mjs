import { basename } from 'node:path';
import { pyramidSampleReady } from './cost.mjs';
import { accountRows, duration } from './status-accounts.mjs';
import { box, columns, inside, meter, pad, row, safe, table, theme, truncate, widthOf, wrap } from './status-layout.mjs';

export const pages = ['Board', 'Workers', 'Gates', 'Notices', 'Cost'];
export const footer = '↑↓ select  Enter detail  h hist  g grep  m mem  r refresh  q quit  ? help';
const show = value => value == null || value === '' ? '—' : safe(value);
const short = value => show(value).slice(0, 8);
const itemFor = (id, title, fields) => ({ id, title, fields });
const age = (at, now) => duration(at == null ? NaN : now - at);
const tones = new Map([
  ...['idle', 'ready', 'running', 'busy', 'completed', 'PASS', 'DONE'].map(state => [state, 'good']),
  ...['starting', 'stalled', 'awaiting-user', 'quota-wait', 'BLOCKED'].map(state => [state, 'warn']),
  ...['stuck', 'refused', 'auth-expired', 'silent-hang', 'REJECT', 'FAILED'].map(state => [state, 'bad']),
]);
const badge = (state, paint) => paint(tones.get(state) ?? 'muted', '[' + show(state) + ']');
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

export function boardView(project, { board, error } = {}, { width = 80, now = Date.now(),
  page = 0, selected, interactive = false, depth = 1 } = {}) {
  const paint = theme(depth);
  const marker = (item, text) => interactive && selected === item.id ? paint('selected', '› ' + text) : text;
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
  header.push(row(truncate(tabs.join('  '), width)), row());
  const tail = (error ? [row(paint('warn', truncate(safe(error), width))), row()] : []);
  const frame = body => ({ header, body: [...tail, ...body], footer: truncate(footer, width) });
  if (!board) return frame([]);

  const { roles = [], workers = [], delivery, gates = [], notifications, pyramids = [], layout } = board;
  const samplesReady = pyramids.some(pyramidSampleReady);
  const warmingTypes = new Set(['consumption-pyramid', 'senior-tool-output-share']);
  const notices = (notifications?.last ?? []).filter(notice => samplesReady || !warmingTypes.has(notice.type));

  function roleCard(w, kind) {
    const selectedRoles = roles.filter(record => record.role === kind);
    const title = kind[0].toUpperCase() + kind.slice(1);
    const cards = selectedRoles.flatMap(role => {
      const slot = layout?.tabs?.[kind];
      const tab = !slot?.addr || slot.addr === role.addr ? slot : undefined;
      const item = itemFor('role:' + role.addr, title + ' · ' + show(role.addr), [
        ['Role', role.role], ['CLI / model', [role.cli, role.model].filter(Boolean).join(' · ')],
        ['State', role.state], ['Herdr space ID', layout?.space?.id], ['Herdr tab ID', tab?.id],
        ['Terminal ID', tab?.terminal], ['Session UUID', role.sessionId], ['Working directory', role.cwd],
        ['Transcript path', role.transcriptPath],
      ]);
      const ctx = Number.isFinite(role.contextPercent) ? `${Math.round(role.contextPercent)}%` : '—';
      const context = row(`Context ${ctx} · activity ${age(role.activityAt, now)} · ${short(role.addr)}`);
      return [row(marker(item, [show(role.cli), role.model && show(role.model)].filter(Boolean).join('·')) +
        '  ' + badge(role.state, paint), item), context,
      ...(role.awaitingHandover ? [row(paint('warn', 'Awaiting handover'))] : [])];
    });
    if (!cards.length) cards.push(row(paint('muted', 'Vacant')));
    return panel(w, title, cards);
  }

  function deliveryStrip(w) {
    const labels = Object.entries(delivery?.counts ?? {}).map(([state, count]) =>
      [state + ' ' + count, count && tones.get(state) || 'muted']);
    if (delivery?.oldestAgeMs != null) labels.push(['oldest ' + duration(delivery.oldestAgeMs), 'text']);
    const content = [];
    let line = '';
    for (const [text, tone] of labels) {
      const label = paint(tone, '[' + safe(text) + ']');
      if (line && widthOf(line) + 2 + widthOf(label) > inside(w)) {
        content.push(row(line));
        line = '';
      }
      line += (line ? '  ' : '') + label;
    }
    if (line) content.push(row(line));
    return panel(w, 'Delivery', content);
  }

  function workerTable(w) {
    const columns = [
      { title: 'Task' }, { title: 'Wave', width: 5 }, { title: 'State', width: 12 },
      { title: 'CLI', width: 6 }, { title: 'Addr', width: 8 }, { title: 'Age', width: 6 },
    ];
    // Widths at the 100-column split leave space for a meaningful task prefix.
    if (w < 60) {
      columns[1].width = 4;
      columns[2].width = 8;
      columns[5].width = 4;
    }
    const entries = workers.map(worker => {
      const item = itemFor('worker:' + worker.addr, 'Worker · ' + show(worker.task), [
        ['Address', worker.addr], ['CLI / model', [worker.cli, worker.model].filter(Boolean).join(' · ')],
        ['Wave', worker.wave], ['State', worker.state], ['Session UUID', worker.sessionId],
        ['Working directory', worker.cwd], ['Transcript path', worker.transcriptPath],
      ]);
      return { item, cells: [marker(item, show(worker.task)), show(worker.wave),
        paint(tones.get(worker.state) ?? 'muted', show(worker.state)), show(worker.cli), short(worker.addr), age(worker.startedAt, now)] };
    });
    return panel(w, `Workers · ${workers.length}`, entries.length ? table(inside(w), columns, entries, paint) : []);
  }

  function gateList(w) {
    return panel(w, 'Gates', gates.map(gate => {
      const verdict = gate.verdict;
      const item = itemFor('gate:' + gate.id, 'Gate · ' + show(gate.id), [
        ['Gate ID', gate.id], ['Round', gate.round], ['Gate packet path', gate.packet],
        ['Verdict round', verdict?.round], ['Verdict', verdict?.text ?? verdict?.line],
      ]);
      return row([marker(item, short(gate.id)), gate.round != null && 'round ' + show(gate.round),
        badge(gate.completedAt != null ? 'completed' : gate.phase, paint),
        verdict && badge(verdict.tag ?? 'REPLY', paint), verdict?.line && safe(verdict.line),
      ].filter(Boolean).join(' · '), item);
    }));
  }

  function noticeList(w) {
    const visible = notices.map(notice => {
      const item = itemFor('notice:' + (notice.id ?? `${notice.type}:${notice.at}:${notice.text}`), 'Super notice', [
        ['Type', notice.type], ['Notice', notice.text],
      ]);
      return row(marker(item, show(notice.type)) + (notice.text ? ' · ' + safe(notice.text) : ''), item);
    });
    if (!samplesReady) visible.push(row(paint('muted', 'Pyramid / tool output share warming up')));
    const count = notifications?.count ?? 0;
    return panel(w, samplesReady ? `Super notices · ${count}` : 'Super notices', visible);
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

  const accounts = () => panel(width, 'Accounts', accountRows(board.accounts, width, now, paint));
  switch (pages[page]) {
    case 'Workers': return frame(workerTable(width));
    case 'Gates': return frame(gateList(width));
    case 'Notices': return frame(noticeList(width));
    case 'Cost': return frame([...costPyramid(width), ...accounts()]);
    default: return frame([
      ...columns(width, w => roleCard(w, 'leader'), w => roleCard(w, 'auditor')),
      ...deliveryStrip(width),
      ...columns(width, workerTable, gateList),
      ...columns(width, noticeList, costPyramid),
      ...accounts(),
      ...releaseLine(),
    ]);
  }
}

export function boardLines(project, snapshot, options) {
  const { header, body, footer: hints } = boardView(project, snapshot, options);
  return [...header.map(line => line.text), ...body.map(line => line.text), hints];
}
