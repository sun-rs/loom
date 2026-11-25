import { appendFileSync } from 'node:fs';
import { jsonRows, prepareJournal, readText } from '../daemon/io.mjs';

function entries(text) {
  const requests = new Map();
  for (const { id, entry } of jsonRows(text)) {
    if (entry) requests.set(id, entry);
    else requests.delete(id);
  }
  return requests;
}

export function readRequestBook(path) {
  return entries(readText(path));
}

export function openRequestBook(path) {
  const requests = path ? entries(prepareJournal(path)) : new Map();
  return {
    requests,
    put(id, entry) {
      if (path) appendFileSync(path, JSON.stringify({ id, entry }) + '\n', { flush: true });
      if (entry) requests.set(id, entry);
      else requests.delete(id);
    },
  };
}
