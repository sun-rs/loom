import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { readRetained } from './retention.mjs';
import { clip, evidenceLines, gitLines, inboxLines, oneLine, time, unavailable, watchLines, waveLines, workerLines } from './sources.mjs';
import { adapterFor, openNative, roles } from './transcript.mjs';
import { clipTokens, estimateTokens as size } from '../lib/token-budget.mjs';
import { charterLines, projectDocument, rulingLines } from './organization.mjs';

export const maxBriefTokens = 1500;

function sourceSession(sessions, role, to) {
  const items = sessions.filter(row => row.role === role && row.addr !== to);
  const parent = sessions.find(row => row.addr === to)?.parent;
  return items.find(row => row.addr === parent) ?? items.sort((a, b) =>
    time(b.startedAt ?? b.endedAt) - time(a.startedAt ?? a.endedAt) || b.addr.localeCompare(a.addr))[0];
}

function parentChain(session, sessions) {
  const byAddr = new Map(sessions.map(row => [row.addr, row]));
  const seen = new Set();
  const chain = [];
  let row = session;
  let problem;
  while (row) {
    if (seen.has(row.addr)) { problem = `${unavailable}（parent 循环 ${oneLine(row.addr)}）`; break; }
    chain.push(row);
    seen.add(row.addr);
    if (row.parent == null) break;
    row = byAddr.get(row.parent);
    if (!row) problem = `${unavailable}（parent ${oneLine(chain.at(-1).parent)} 缺失）`;
  }
  return { chain, problem };
}

async function transcriptText(projectDir, session, locate) {
  const native = await openNative(session, { locate }).catch(() => null);
  if (native) {
    try {
      const text = await native.file.readFile('utf8');
      if (text.trim()) return { path: native.path, text };
    } catch { /* An archived snapshot can still be read. */ }
    finally { await native.file.close(); }
  }
  return readRetained(projectDir, session);
}

async function l1Lines(projectDir, chain, count, locate) {
  if (!chain.length) return [unavailable];
  const gaps = [];
  const seen = new Set();
  const turns = [];
  for (const [order, session] of chain.entries()) {
    const adapter = adapterFor(session);
    const source = adapter && await transcriptText(projectDir, session, locate).catch(() => null);
    if (!source || !source.text.trim()) { gaps.push(`${unavailable}（${oneLine(session.addr)} 原生记录缺失）`); continue; }
    const key = `${adapter.id}\0${session.sessionId ?? source.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const parsed = adapter.transcript.parse(source.text);
    for (const turn of parsed.turns.slice(-count)) {
      const at = time(turn.startedAt ?? turn.endedAt ?? session.startedAt);
      turns.push({ at, order, turn, addr: session.addr, adapter, parsed });
    }
  }
  turns.sort((a, b) => b.at - a.at || a.order - b.order || b.turn.index - a.turn.index);
  const lines = turns.slice(0, count).map(({ addr, adapter, parsed, turn }) => {
    const summary = adapter.transcript.turnSummary(parsed, turn.index) ?? unavailable;
    return [`${oneLine(addr)}#${turn.index}`, ...summary.split(/\r?\n/).map(oneLine).filter(Boolean)];
  });
  if (gaps.length) lines.unshift(`${gaps[0]}${gaps.length > 1 ? ` 等 ${gaps.length} 个会话` : ''}`);
  return lines.length ? lines : ['无可摘要轮次'];
}

function formatLine(line, limit = Infinity) {
  if (!Array.isArray(line)) return clipTokens(line, limit);
  const text = line.join(' ');
  if (size(text) <= limit) return text;
  const [label, ...facts] = line;
  const available = limit - size(label) - facts.length;
  if (available < facts.length * 12) return clipTokens(text, limit);
  const budgets = facts.map(fact => Math.min(size(fact), Math.floor(available / facts.length)));
  let spare = available - budgets.reduce((sum, tokens) => sum + tokens, 0);
  for (let i = facts.length - 1; i >= 0; i--) {
    const extra = Math.min(spare, size(facts[i]) - budgets[i]);
    budgets[i] += extra;
    spare -= extra;
  }
  return [label, ...facts.map((fact, i) => clipTokens(fact, budgets[i]))].join(' ');
}

function render(role, project, sections) {
  const title = `# ${role} · ${clipTokens(oneLine(project), 100)}`;
  const headings = sections.map(({ title, fixed }) => `## ${title}\n` + (fixed ? fixed + '\n' : ''));
  const available = maxBriefTokens - size([title, ...headings].join('\n\n') + '\n');
  const weight = sections.reduce((sum, part) => sum + (part.weight ?? 1), 0);
  const bodies = sections.map(({ lines }) => lines.map(line => formatLine(line)).join('\n'));
  const desired = bodies.map(size);
  const budgets = sections.map((part, i) => Math.min(desired[i], Math.floor(available * (part.weight ?? 1) / weight)));
  let spare = available - budgets.reduce((sum, tokens) => sum + tokens, 0);
  for (const [i, tokens] of desired.entries()) {
    const extra = Math.min(spare, tokens - budgets[i]);
    budgets[i] += extra;
    spare -= extra;
  }
  const blocks = sections.map(({ lines, balance }, i) => {
    const budget = budgets[i];
    let body = bodies[i];
    if (balance && desired[i] > budget) {
      const perLine = Math.floor((budget - lines.length + 1) / lines.length);
      if (perLine >= 16) body = lines.map(line => formatLine(line, perLine)).join('\n');
    }
    return headings[i] + clipTokens(body, budget);
  });
  return [title, ...blocks].join('\n\n') + '\n';
}

async function sample(read, ...args) {
  try { return await read(...args); }
  catch { return unavailable; }
}

async function projectSessions(project, index) {
  index ??= (await import('../index/index.mjs')).index;
  return (await index.query({ project })).filter(row => row.project === project && row.addr);
}

export async function generateBrief({ role, project, projectDir, from, to, turns = 3, index, locate = true }) {
  if (!roles.includes(role) || typeof project !== 'string' || !project.trim() || !Number.isSafeInteger(turns) || turns <= 0) {
    throw new TypeError('需要 leader、auditor 或 super 角色、项目和正整数轮数');
  }
  const sessions = await projectSessions(project, index).catch(() => null);
  const session = from ? sessions?.find(row => row.addr === from && row.role === role) : sourceSession(sessions ?? [], role, to);
  const { chain, problem } = parentChain(session, sessions ?? []);
  const history = chain.filter(row => row.role === role);
  const addresses = new Set(history.map(row => row.addr));
  const root = await realpath(projectDir).catch(() => null);
  const meta = root && join(root, '.project');
  const [[l1, workers, waves, inbox, watch, evidence, git], charter, rulings] = await Promise.all([
    root ? Promise.all([
      sample(l1Lines, root, history, turns, locate), sample(workerLines, meta), sample(waveLines, meta),
      sample(inboxLines, meta, addresses), sample(watchLines, meta), sample(evidenceLines, meta), sample(gitLines, root),
    ]) : Array(7).fill(unavailable),
    projectDocument(root, 'charter'), projectDocument(root, 'rulings'),
  ]);
  const chainText = chain.map(row => oneLine(row.addr)).join(' ← ');
  const indexStatus = sessions ? '未登记该角色' : '会话索引读取失败';
  const document = (title, { path, status, text }, summarize) => ({
    title, fixed: [path, status].filter(Boolean).join(' · '),
    lines: status ? [] : summarize(text), weight: 2, balance: true,
  });
  const context = [workers, waves, inbox, git, ...(Array.isArray(l1) ? l1.map(line => formatLine(line, 160)) : [])].join('\n');
  const sections = [
    { title: '会话链', lines: chainText ? [...(problem ? [clip(problem, 100)] : []), chainText] : [`${unavailable}（${indexStatus}）`], weight: 2 },
    document('项目章程', charter, charterLines),
    document('裁决账本', rulings, text => rulingLines(text, context)),
    { title: '最近 L1', lines: Array.isArray(l1) ? l1 : [l1], weight: 4, balance: true },
    { title: '在途 worker', lines: [workers] },
    { title: 'relay 波次', lines: [waves] },
    { title: '收件箱', lines: [inbox] },
    { title: '卡死告警', lines: [watch] },
    { title: 'MISMATCH', lines: [evidence] },
    { title: '未提交改动', lines: [git] },
  ];
  return { addr: session?.addr ?? null, brief: render(role, project, sections) };
}
