import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { defaultReplyBytes } from '../cli/policy.mjs';
import { readText, writeState } from '../daemon/io.mjs';
import { payloadDigest } from './message.mjs';

export function replyForDelivery(project, text, limit = defaultReplyBytes, { attachFile = false } = {}) {
  const safe = text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
  const inline = Buffer.byteLength(safe) <= limit;
  if (inline && !attachFile) return safe;
  const digest = payloadDigest(text);
  const base = join(project, '.project');
  if (realpathSync(base) !== base) throw new Error('Reply directory must be project-local');
  const directory = join(base, 'replies');
  try { mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (realpathSync(directory) !== directory) throw new Error('Reply directory must be project-local');
  const relative = `.project/replies/${digest}.txt`;
  const path = join(project, relative);
  const stored = readText(path, null);
  if (stored === null) writeState(path, text);
  else if (stored !== text) throw new Error('Stored Loom reply does not match its digest');
  // The content-addressed filename is also the SHA-256 of the saved UTF-8 bytes.
  const pointer = `Read ${relative} (SHA-256)`;
  return inline && Buffer.byteLength(safe + '\n\n' + pointer) <= limit ? `${safe}\n\n${pointer}` : pointer;
}
