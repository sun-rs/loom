import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { readText } from '../daemon/io.mjs';
import { oneLine } from './sources.mjs';
import { regularPath } from './transcript.mjs';

const charterTopics = [
  ['目标', /^(?:目标|goals?)$/i],
  ['非目标', /^(?:非目标|non[- ]goals?)$/i],
  ['红线', /^(?:红线|red lines?)$/i],
  ['验收', /^(?:验收(?:标准|要点)?|acceptance(?: criteria)?)$/i],
];

export async function projectDocument(root, name) {
  const path = '.project/' + name + '.md';
  if (!root) return { path, status: '不可读（项目目录不可用）' };
  const file = join(root, path);
  try {
    if ((await lstat(file)).isFile() && await regularPath(file) === file) {
      const text = readText(file, null);
      return text === null ? { path, status: '缺失' } : { path, text };
    }
    return { path, status: '不可读' };
  } catch (error) {
    return { path, status: ['ENOENT', 'ENOTDIR'].includes(error.code) ? '缺失' : '不可读' };
  }
}

const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/;

export function charterLines(text) {
  const points = new Map();
  let topic;
  for (const line of text.split(/\r?\n/)) {
    const title = heading.exec(line)?.[1];
    if (title !== undefined) topic = charterTopics.find(([, names]) => names.test(title))?.[0];
    else if (topic && line.trim()) {
      const list = points.get(topic) ?? [];
      list.push(oneLine(line.replace(/^\s*[-*+]\s+/, '')));
      points.set(topic, list);
    }
  }
  return charterTopics.map(([label]) => [label + ' ·', points.get(label)?.join(' / ') || '未记录']);
}

const references = text => new Set(text.toLowerCase().match(/[a-z0-9]+(?:[._/-][a-z0-9_-]+)+/g) ?? []);

export function numberedRulings(text) {
  const entries = [];
  let current;
  for (const line of text.split(/\r?\n/)) {
    const title = heading.exec(line)?.[1];
    const ledger = /^ {0,3}R(\d+)\.\s+(\S.*)$/i.exec(line);
    if (ledger) {
      current = { number: ledger[1], title: 'R' + ledger[1], quote: ['> ' + ledger[2].replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')] };
      entries.push(current);
    } else if (title !== undefined) {
      const number = /^(?:(?:裁决|ruling)\s*)?#?(\d+)(?=\s|[.·、:：)]|$)/i.exec(title)?.[1];
      current = number === undefined ? undefined : { number, title, quote: [] };
      if (current) entries.push(current);
    } else if (current && /^ {0,3}>/.test(line)) {
      current.quote.push(line.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ''));
    }
  }
  return entries.filter(entry => entry.quote.some(line => !/^ {0,3}>\s*$/.test(line)));
}

export function rulingLines(text, context) {
  const active = references(context);
  const cited = new Set([...context.matchAll(/(?:裁决|\bruling)\s*#?(\d+)|\bR(\d+)\b/gi)]
    .map(match => match[1] ?? match[2]));
  const ranked = numberedRulings(text).toReversed().map(entry => ({
    ...entry, score: 10 * Number(cited.has(entry.number)) +
      [...references(entry.title + '\n' + entry.quote.join('\n'))].filter(ref => active.has(ref)).length,
  })).sort((a, b) => b.score - a.score);
  const selected = ranked[0]?.score ? ranked.filter(entry => entry.score) : ranked;
  return selected.length ? selected.slice(0, 3).map(entry =>
    ['裁决 ' + entry.number, ...entry.quote].join('\n')) : ['未找到可摘录的编号裁决，请查阅上方账本路径。'];
}
