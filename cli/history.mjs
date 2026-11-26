import { compareClaims } from '../evidence/claims.mjs';
import { deliveryFailed, deliveryId } from '../inbox/message.mjs';
import { agyTurnPrompt } from '../adapters/agy/lib/parse-agy.mjs';
import { readArtifacts, sessionProject } from './artifacts.mjs';
import { changeReader } from './changes.mjs';
import { activitySummary, adapterFor, CommandError, parentOrder, readTranscript, transcriptFor, turnActivityFacts } from './sessions.mjs';
import { nativeRanges, timestamp, transcriptRows, turnTools } from './turns.mjs';
import { managedWaveKey } from '../relay/project.mjs';
import { oarTurnEndHead } from '../daemon/turn-heads.mjs';
import { seniorToolEvents } from '../daemon/senior-tools.mjs';
import { workerCardId } from '../daemon/worker-retention.mjs';

const at = value => Number.isFinite(timestamp(value)) ? timestamp(value) : null;
const iso = time => at(time) === null ? null : new Date(at(time)).toISOString();
const firstLine = value => typeof value === 'string' ? value.trimStart().split(/\r?\n/, 1)[0].trimEnd() : '';
const duration = (start, end) => at(start) !== null && at(end) !== null ? Math.max(0, at(end) - at(start)) : null;
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const declared = turn => /^\**(DONE|FAILED|BLOCKED|UNCONFIRMED)\b/i.exec(firstLine(turn.reply))?.[1]?.toLowerCase();

function journalTurns(source) {
  const grouped = new Map();
  if (!source) return grouped;
  for (const entry of transcriptRows(source.text)) {
    const { row } = entry;
    if (!row.turnId && !row.turn_id) continue;
    const key = `${row.streamId ?? ''}/${row.turnId ?? row.turn_id}`;
    if (row.type === 'turn-start') grouped.set(key, { start: row, rows: [] });
    const current = grouped.get(key);
    if (!current) continue;
    current.rows.push(entry);
    if (row.type === 'turn-end') current.end = row;
    if (row.type === 'turn-unconfirmed') current.unconfirmed = true;
  }
  return grouped;
}

function cardsFor(cards, turn, observation, completion) {
  return cards.filter(card => {
    const { data } = card;
    if (sameId(data.verification?.turnId, turn.id) ||
        sameId(data.verification?.turnId, observation?.end?.nativeTurnId)) return true;
    if (data.endedAt != null) return data.endedAt === (observation?.end?.at ?? completion?.at ?? at(turn.endedAt));
    return typeof data.turn === 'number' && data.turn === turn.index;
  });
}

function matchingCards(session, turns, artifacts) {
  const journal = artifacts?.journalSource(session.addr);
  const observations = [...journalTurns(journal).values()];
  const hooks = artifacts?.turnHeads(session.addr) ?? [];
  const messages = artifacts?.messages().filter(message => message.target?.addr === session.addr) ?? [];
  const firstId = session.role === 'worker' ? artifacts?.job(session.addr)?.firstId : undefined;
  const completions = messages.flatMap(message => message.completion ? [message.completion] : []);
  const interrupts = messages.filter(message => message.requestedMode === 'interrupt' && message.stoppedAt != null);
  const used = new Set();
  const entries = turns.map(turn => {
    const markers = new Set((turn.prompts ?? [agyTurnPrompt.get(turn)]).map(deliveryId).filter(Boolean));
    const observation = observations.find(item => !used.has(item) &&
      (sameId(item.end?.nativeTurnId ?? item.start.turnId, turn.id) ||
        item.end?.inputIds?.some(id => markers.has(id)) ||
        at(turn.startedAt) === item.start.at || at(turn.endedAt) === item.end?.at && item.end != null));
    if (observation) used.add(observation);
    const completion = completions.find(done => sameId(done.nativeTurnId ?? done.turnId, turn.id) ||
      at(turn.endedAt) === done.at) ?? (observation && completions.find(done =>
        done.streamId === observation.start.streamId && done.turnId === observation.start.turnId));
    const hook = hooks.find(item => sameId(item.turnId, turn.id) || item.startedAt === at(turn.startedAt) ||
      completion != null && item.endedAt === completion.at) ??
      hooks.find(item => Math.abs(item.startedAt - (at(turn.startedAt) ?? Infinity)) <= 1000 &&
        hooks.filter(other => Math.abs(other.startedAt - (at(turn.startedAt) ?? Infinity)) <= 1000).length === 1);
    const loomInterrupt = interrupts.some(message => sameId(message.active?.turnId, turn.id) ||
      message.active?.inputId != null && message.active.inputId === hook?.deliveryId);
    return { turn, observation, completion, hook, loomInterrupt };
  });

  for (const item of observations) {
    if (used.has(item)) continue;
    // A unique close start time can join journals whose runtime IDs differ
    // from native transcript IDs, including shared ACP process streams.
    const near = entries.filter(entry => !entry.observation &&
      Math.abs(item.start.at - (at(entry.turn.startedAt) ?? Infinity)) <= 1000);
    if (near.length === 1 &&
        observations.filter(other => Math.abs(other.start.at - at(near[0].turn.startedAt)) <= 1000).length === 1) {
      near[0].observation = item;
      near[0].completion ??= completions.find(done => done.streamId === item.start.streamId && done.turnId === item.start.turnId);
      continue;
    }
    const { start, end } = item;
    // Keep journal-only turns that are outside the native timeline or have an
    // authoritative terminal failure for which no native transcript exists.
    const withinNative = entries.some(entry => at(entry.turn.startedAt) != null && at(entry.turn.endedAt) != null &&
      at(entry.turn.startedAt) <= start.at && at(entry.turn.endedAt) >= start.at);
    if (withinNative) continue;
    const status = end?.outcome?.kind === 'aborted' ? 'interrupted' : end?.outcome?.kind ?? 'incomplete';
    entries.push({ turn: { index: start.turn, id: end?.nativeTurnId ?? start.turnId, startedAt: iso(start.at),
      endedAt: iso(end?.at), status, reply: end?.finalReply ?? end?.unconfirmedBody ?? null, calls: [] },
    observation: item, journalOnly: true });
  }

  return entries.map(entry => {
    const { turn, observation, completion, hook } = entry;
    const cards = artifacts ? cardsFor(artifacts.cards(session.addr), turn, observation, completion) : [];
    const nextCard = observation?.end && firstId && workerCardId(messages, firstId, observation.end) !== firstId;
    return { ...entry, turn: !turn.reply && completion?.body ? { ...turn, reply: completion.body } : turn,
      cards, journalPath: journal?.path, heads: {
      start: observation?.start.observedAt ? { head: observation.start.head, observedAt: observation.start.observedAt } : hook?.start ?? null,
      end: oarTurnEndHead(artifacts?.project, session, observation?.start, observation?.end, { nextCard }) ?? hook?.end ?? null,
    } };
  });
}

function enrich(entry) {
  const { session, turn, rows, observation, completion, cards, heads } = entry;
  const nativeTools = turnTools(session.cli, turn, rows);
  const journalTools = observation && turnTools(session.cli, turn, observation.rows);
  const tools = session.cli === 'agy' && journalTools?.length ? journalTools : nativeTools.length ? nativeTools : journalTools ?? [];
  const git = heads.end?.git ?? cards.find(card => card.data.git?.source === 'git-worktree')?.data.git;
  const activity = turnActivityFacts({ ...entry, tools, git, cwd: session.cwd });
  const claims = compareClaims(turn.reply ?? observation?.end?.finalReply, git ?? {}, {
    status: rows.length || journalTools?.length ? 'ok' : 'missing-transcript', turnStatus: activity.lifecycle,
    commands: activity.tests, expectRed: cards.some(card => card.data.verification?.expectRed === true),
  }, activity.lifecycle === 'failed' || activity.lifecycle === 'quota');
  const { tags } = activity;
  if (!tags.includes('unverified') && (claims.some(claim => claim.status === 'UNVERIFIED') ||
      activity.lifecycle === 'incomplete' && session.endedAt !== null && !tags.length)) tags.push('unverified');
  return { ...entry, tools, git, claims, activity, errors: activity.errors, tags };
}

export function historyReader(directory) {
  const projects = new Map();
  const changes = new Map();
  const read = new Map();
  function projectData(project) {
    if (!projects.has(project)) projects.set(project, readArtifacts(project));
    return projects.get(project);
  }
  function sessionHistory(session) {
    if (read.has(session.addr)) return read.get(session.addr);
    const project = sessionProject(directory, session);
    const artifacts = project && projectData(project);
    const { transcript } = adapterFor(session);
    let path;
    let parsed = { turns: [] };
    let raw = [];
    let missing;
    try {
      path = transcriptFor(session);
      const text = readTranscript(path);
      parsed = transcript.parse(text);
      raw = transcriptRows(text);
    } catch (error) { missing = error; }
    const ranges = nativeRanges(raw, parsed.turns, session.cli);
    const items = matchingCards(session, parsed.turns, artifacts).map((entry, i) => ({
      ...entry, session, project, transcript, parsed,
      path: entry.journalOnly ? entry.journalPath : path,
      rows: entry.journalOnly ? entry.observation.rows : ranges[i] ?? [],
    }));
    if (items.some(item => item.journalOnly)) {
      items.sort((a, b) => {
        const timeA = at(a.turn.startedAt) ?? at(a.turn.endedAt);
        const timeB = at(b.turn.startedAt) ?? at(b.turn.endedAt);
        return timeA != null && timeB != null && timeA !== timeB ? timeA - timeB : a.turn.index - b.turn.index;
      });
    }
    for (const [i, item] of items.entries()) item.index = i + 1;
    const result = { path, items, missing, project, raw };
    read.set(session.addr, result);
    return result;
  }
  function changesFor(project) {
    if (!changes.has(project)) changes.set(project, changeReader(project ?? directory));
    return changes.get(project);
  }
  async function diff(entry) {
    const { project, session, heads } = entry;
    const changes = changesFor(project);
    const [turn, task] = await Promise.all([
      heads.end?.git ?? changes.diff(session.cwd, heads.start?.head, heads.end?.head),
      changes.diff(session.cwd, session.baseCommit, heads.end?.head),
    ]);
    return { turn, task };
  }
  function changedFiles({ project, session, heads }) {
    if (heads.end?.git) return heads.end.git.status === 'ok' ? heads.end.git.files.length : null;
    return changesFor(project).count(session.cwd, heads.start?.head, heads.end?.head);
  }
  return { sessionHistory, projectData, diff, changedFiles };
}

const exitCodes = tools => tools.filter(tool => Number.isSafeInteger(tool.exitCode))
  .map(tool => tool.exitCode);
const verdict = claims => ['MISMATCH', 'UNVERIFIED', 'MATCH'].filter(status => claims.some(claim => claim.status === status));
const publicCards = cards => cards.map(({ path, summary }) => ({ path, summary }));

function matchesKeyword(entry, kw) {
  const haystack = [entry.turn.reply, ...entry.errors,
    ...entry.tools.flatMap(tool => [tool.command, tool.output, ...tool.paths]),
    ...entry.cards.flatMap(card => card.data.git?.files?.map(file => file.path) ?? []),
    ...entry.rows.map(row => row.line),
  ];
  return haystack.some(value => typeof value === 'string' && value.toLowerCase().includes(kw));
}

export async function history(sessions, reader, options) {
  const { level, count, since, exact, exactAddr, timeline, outcome, grep, tool, command, tail, showDiff, evidence, withCalls, onlyFailed } = options;
  const entries = [];
  const missing = [];
  const seen = new Set();
  const sources = timeline && !grep ? parentOrder(sessions) : sessions;
  for (const [order, session] of sources.entries()) {
    try {
      const { items, path, missing: gap } = reader.sessionHistory(session);
      const key = path && `${session.cli}\0${path}`;
      if (!exactAddr && key && seen.has(key)) continue;
      if (key) seen.add(key);
      if (gap) missing.push({ addr: session.addr, code: gap.code ?? 'unavailable', message: gap.message });
      let lastAt = session.startedAt;
      for (const item of items) {
        const time = at(item.turn.startedAt) ?? at(item.turn.endedAt);
        lastAt = time ?? lastAt;
        entries.push({ ...item, at: time, orderAt: lastAt ?? Infinity, order });
      }
    } catch (error) {
      missing.push({ addr: session.addr, code: error.code ?? 'unavailable', message: error.message });
    }
  }
  if (!entries.length && missing.length && !grep) throw new CommandError(missing[0].code, missing[0].message);
  if (timeline) entries.sort((a, b) => (a.orderAt - b.orderAt) || (a.order - b.order) || (a.index - b.index));
  let from = 0;
  if (since?.addr !== undefined) {
    from = entries.findIndex(({ session, index }) => session.addr === since.addr && index === since.index);
    if (from < 0) throw new CommandError('not-found', `No turn ${since.index} at ${since.addr}`);
  } else if (since?.index !== undefined) from = since.index - 1;
  const matched = [];
  for (const [i, item] of entries.entries()) {
    if (i < from || since?.at !== undefined && (item.at === null || item.at < since.at) ||
        exact && (exactAddr ? item.session.addr !== exactAddr || item.index !== exact : timeline ? i + 1 !== exact : item.index !== exact)) continue;
    const entry = enrich(item);
    if (outcome && !entry.tags.includes(outcome) || grep && !matchesKeyword(entry, grep)) continue;
    matched.push({ ...entry, timelineIndex: i + 1 });
  }
  if (exact && !matched.length && !outcome && !grep) throw new CommandError('not-found', `No turn ${exact}`);
  const selected = since ? matched.slice(0, count) : matched.slice(-count);
  const seniorLogs = new Map();
  const turns = await Promise.all(selected.map(async entry => {
    const { session, turn, rows, path, cards, tools, heads, claims, git, activity, tags } = entry;
    const origin = timeline ? { addr: session.addr, timelineIndex: entry.timelineIndex } : {};
    const source = { transcriptPath: path ?? null, lineOffset: rows.length ? rows[0].number - 1 : null,
      ...(rows.length && { startLine: rows[0].number, endLine: rows.at(-1).number }) };
    const diffs = showDiff ? await reader.diff(entry) : null;
    if (['leader', 'auditor'].includes(session.role) && !seniorLogs.has(session.addr)) {
      seniorLogs.set(session.addr, seniorToolEvents(entry.project, session.addr));
    }
    const started = entry.observation?.start?.at ?? at(turn.startedAt) ?? Infinity;
    const ended = entry.observation?.end?.at ?? at(turn.endedAt) ?? Infinity;
    const seniorTools = (seniorLogs.get(session.addr) ?? []).filter(event => event.at >= started && event.at <= ended)
      .map(({ type, category, reason, at }) => ({ type, category, reason, at }));
    const facts = { exitCodes: exitCodes(tools), status: activity.lifecycle,
      ...(activity.openCalls && { openCalls: activity.openCalls }),
      changedFiles: git ? git.status === 'ok' ? git.files.length : null : await reader.changedFiles(entry), claims: verdict(claims) };
    const headInfo = value => value ? { head: value.head, observedAt: value.observedAt } : null;
    const extra = { ...source, facts, outcomes: tags, heads: { start: headInfo(heads.start), end: headInfo(heads.end) },
      ...(diffs && { diff: diffs }), ...(evidence && { evidence: publicCards(cards) }), ...(seniorTools.length && { seniorTools }) };
    if (level === 'L2') {
      const selectedTools = tools.filter(item => (!tool || tool === item.tool) && (!command || command.test(item.command ?? '')) &&
        (!onlyFailed || item.status === 'failed'))
        .map(item => {
          const lines = item.output?.trimEnd().split(/\r?\n/);
          const output = lines?.length > tail + 3 ? [...lines.slice(0, 3), '…', ...lines.slice(-tail)].join('\n') : lines?.join('\n') ?? null;
          return { ...item, output };
        });
      const details = { ...turn, index: entry.index };
      delete details.tools;
      if (!withCalls) delete details.calls;
      return { ...origin, ...details, status: activity.lifecycle,
        reply: turn.reply ?? entry.observation?.end?.unconfirmedBody ?? null,
        ...extra, tools: selectedTools, errors: entry.errors, claims,
        tests: activity.tests.map(({ tail, tailSha256, ...test }) => test),
        midTurnInputs: activity.midTurnInputs, interruptedBy: activity.interruptedBy };
    }
    const summary = activitySummary({ index: entry.index, task: session.task, turn, tools, facts, activity, source, git, heads });
    return { ...origin, index: entry.index, startedAt: turn.startedAt, endedAt: turn.endedAt, summary,
      status: activity.lifecycle, ...extra };

  }));
  return { turns, ...(missing.length ? { missing } : {}) };
}

export async function waveHistory(sessions, reader, project, wave, { evidence, showDiff }) {
  const artifacts = reader.projectData(project);
  const relay = artifacts.relay();
  const messages = artifacts.messages();
  const groups = new Map();
  for (const session of sessions.filter(session => session.role === 'worker')) {
    const job = artifacts.job(session.addr);
    if (session.wave !== wave && job?.barrier !== wave) continue;
    const key = managedWaveKey(session.parent, session.project, job?.barrier ?? session.wave, job?.deliver);
    const list = groups.get(key) ?? [];
    list.push(session);
    groups.set(key, list);
  }
  for (const [key, saved] of Object.entries(relay.waves ?? {})) {
    if ((saved.id === wave || key === `wave:${wave}`) && !groups.has(key)) groups.set(key, []);
  }
  if (!groups.size) throw new CommandError('not-found', `No wave ${wave}`);
  return Promise.all([...groups].map(async ([key, group]) => {
    const saved = relay.waves?.[key];
    const members = await Promise.all(group.map(async session => {
      const first = messages.find(message => message.id === artifacts.job(session.addr)?.firstId);
      const progress = relay.progress?.[`${session.task}/${session.addr}`]?.result;
      const done = first?.completion;
      let entry;
      try {
        const { items } = reader.sessionHistory(session);
        const matched = done && items.find(item => sameId(done.nativeTurnId ?? done.turnId, item.turn.id) ||
          item.observation?.end?.at === done.at || at(item.turn.endedAt) === done.at);
        if (matched || items[0]) entry = enrich(matched || items[0]);
      } catch (error) {
        if (error.code !== 'not-ready' && error.code !== 'unsupported') throw error;
      }
      const cards = entry?.cards?.length ? entry.cards : artifacts.cards(session.addr)
        .filter(card => card.data.endedAt === done?.at || !done && card.data.endedAt != null).slice(0, 1);
      const card = cards[0]?.data;
      const fixed = showDiff && entry ? await reader.diff(entry) : null;
      const observed = entry?.git ?? card?.git;
      const files = observed?.source === 'git-worktree' ? observed.files :
        fixed?.task.status === 'ok' ? fixed.task.files : observed?.files ?? null;
      const ended = done?.at ?? at(entry?.turn.endedAt) ?? session.endedAt;
      const outcome = progress?.outcome?.toLowerCase() ?? (done?.unconfirmed ? 'unconfirmed' :
        done?.body ? (declared({ reply: done.body }) ?? 'done') :
          done?.noReply || deliveryFailed(first) ? 'failed' :
            declared(entry?.turn ?? {}) ?? (entry?.turn.status === 'completed' ? 'done' :
              session.endedAt !== null ? 'failed' : saved?.closed ? 'unfinished' : 'pending'));
      return { addr: session.addr, task: session.task, outcome, elapsedMs: duration(session.startedAt, ended),
        netLines: files && files.some(file => Number.isFinite(file.added)) ?
          files.reduce((net, file) => net + (file.added ?? 0) - (file.deleted ?? 0), 0) : files?.length === 0 ? 0 : null,
        files: files?.map(({ path, added, deleted, previousPath }) => ({ path, added, deleted, previousPath })) ?? null,
        changesSource: files ? observed?.source ?? (fixed?.task.status === 'ok' ? 'commits' : 'evidence-card') : null,
        late: saved?.deliver === 'stream' ? saved.timedOut?.includes(session.task + '/' + session.addr) ?? false :
          Number.isFinite(ended) && Number.isFinite(saved?.deadline) ? ended > saved.deadline : null,
        superseded: sessions.some(other => other.project === session.project && other.task === session.task &&
          other.startedAt > session.startedAt),
        testExitCodes: (entry?.activity.tests ?? card?.verification?.commands ?? [])
          .map(check => ({ command: check.command, exitCode: check.exitCode })),
        ...(fixed && { diff: fixed }), ...(evidence && { evidence: publicCards(cards) }) };
    }));
    for (const id of saved?.deliver === 'barrier' && saved.id !== wave ? [] : saved?.members ?? []) {
      const [task, addr] = id.split('/');
      if (!members.some(member => member.addr === addr)) members.push({
        task, addr, outcome: relay.progress?.[id]?.result?.outcome?.toLowerCase() ?? 'unknown',
        elapsedMs: null, netLines: null, files: null, changesSource: null, testExitCodes: [],
      });
    }
    function legacyWave(message) {
      if (message.waveKey || !message.waveBatch || typeof message.text !== 'string') return false;
      const header = firstLine(message.text);
      if (![wave, `${wave}（超时）`, `${wave}（补投）`, `${wave}（阻塞）`].some(label => header === `波次 ${label}`)) return false;
      const parent = saved?.parent ?? group[0]?.parent;
      return groups.size === 1 || parent && messages.some(other =>
        other.waveBatch === message.waveBatch && other.target?.addr === parent);
    }
    const destinations = messages.filter(message => message.waveKey === key || legacyWave(message))
      .map(message => ({ batch: message.waveBatch, kind: message.waveKind ?? null, to: message.target.addr,
        deliveryId: message.id, phase: message.phase, status: message.received ? 'delivered' :
          deliveryFailed(message) ? 'failed' : message.issue?.startsWith('uncertain') ? 'uncertain' : 'pending' }));
    for (const batch of relay.outbox ?? []) {
      if (batch.waveKey !== key) continue;
      for (const target of batch.recipients ?? []) {
        if (!destinations.some(item => item.batch === batch.id && item.to === target)) {
          destinations.push({ batch: batch.id, kind: batch.waveKind, to: target, deliveryId: null, status: 'awaiting-inbox' });
        }
      }
    }
    return { wave, parent: saved?.parent ?? group[0]?.parent ?? null,
      ...(saved?.deliver && { deliver: saved.deliver, ...(saved.deliver === 'barrier' && { barrier: saved.id }) }),
      state: saved?.closed ? 'closed' : saved?.deadline != null ? 'sealed' : 'unsealed',
      sealedAt: saved?.sealedAt ?? null, deadline: saved?.deadline ?? null, members, destinations,
      ...(!destinations.length && { deliveryObserved: false }) };
  }));
}
